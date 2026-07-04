const cloud = require("wx-server-sdk");
const { getOpenidOrThrow } = require("./auth");
const { assertTextsSafe } = require("./sec");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function now() {
  return new Date();
}

/** 干饭日历用时间：优先 completedAt，旧数据无该字段时用 updateTime / createTime */
function pickOrderCalendarTime(o) {
  const candidates = [o.completedAt, o.updateTime, o.createTime];
  for (const c of candidates) {
    if (c == null) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return c;
  }
  return null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 时段展示为东八区（中国标准时间），避免云函数默认时区按 UTC 解析 */
function formatHHmm(d) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(x);
    const hPart = parts.find((p) => p.type === "hour");
    const mPart = parts.find((p) => p.type === "minute");
    const h = hPart ? parseInt(hPart.value, 10) : 0;
    const m = mPart ? parseInt(mPart.value, 10) : 0;
    return `${pad2(h)}:${pad2(m)}`;
  } catch (e) {
    const t = new Date(x.getTime() + 8 * 60 * 60 * 1000);
    return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
  }
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}小时${m}分钟`;
  return `${m}分钟`;
}

/** 优先用步骤 doneTime；无步骤时间时用下单→完成时段（与「一键完成」等场景兼容） */
function computeCookingDisplay(steps, completedAtFallback, createTimeFallback) {
  const doneTimes = (steps || [])
    .filter((s) => s && s.done && s.doneTime)
    .map((s) => new Date(s.doneTime).getTime())
    .filter((t) => !Number.isNaN(t));

  const end = completedAtFallback && new Date(completedAtFallback);
  const startOrder = createTimeFallback && new Date(createTimeFallback);
  const orderSpanMs =
    end && startOrder && !Number.isNaN(end.getTime()) && !Number.isNaN(startOrder.getTime()) && end > startOrder
      ? end - startOrder
      : 0;

  if (doneTimes.length >= 1) {
    const startMs = Math.min(...doneTimes);
    const endMs = Math.max(...doneTimes);
    const range = `${formatHHmm(new Date(startMs))}-${formatHHmm(new Date(endMs))}`;
    const durMs = endMs - startMs;
    const durationText =
      durMs > 0 ? formatDurationMs(durMs) : orderSpanMs > 0 ? formatDurationMs(orderSpanMs) : "—";
    return { timeRangeText: range, durationText };
  }

  if (end && !Number.isNaN(end.getTime()) && startOrder && !Number.isNaN(startOrder.getTime()) && end > startOrder) {
    return {
      timeRangeText: `${formatHHmm(startOrder)}-${formatHHmm(end)}`,
      durationText: formatDurationMs(end - startOrder),
    };
  }
  if (end && !Number.isNaN(end.getTime())) {
    return { timeRangeText: formatHHmm(end), durationText: "—" };
  }
  return { timeRangeText: "—", durationText: "—" };
}

async function enrichOrdersForCalendarDetail(monthOrders, familyId) {
  if (!monthOrders.length) return [];

  const _ = db.command;
  const orderIds = monthOrders.map((o) => o._id);
  let allSteps = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const slice = orderIds.slice(i, i + 100);
    const res = await db.collection("order_cooking_steps").where({ familyId, orderId: _.in(slice) }).get();
    allSteps = allSteps.concat(res.data || []);
  }
  const stepsByOrder = {};
  for (const s of allSteps) {
    const oid = s.orderId;
    if (!stepsByOrder[oid]) stepsByOrder[oid] = [];
    stepsByOrder[oid].push(s);
  }

  const results = await Promise.all(
    monthOrders.map(async (o) => {
      const t = pickOrderCalendarTime(o);
      const mapped = await mapOrderRecipesWithNames(o.recipes, o.creatorId);
      const recipeNames = mapped.map((x) => (x.recipeName || "").trim()).filter(Boolean);
      const stats = computeCookingDisplay(stepsByOrder[o._id] || [], t, o.createTime);
      return {
        _id: o._id,
        orderName: o.orderName || "",
        completedAt: t,
        recipeNames,
        durationText: stats.durationText,
        timeRangeText: stats.timeRangeText,
      };
    })
  );
  return results;
}

function getWXContext() {
  return cloud.getWXContext();
}

async function assertFamilyMember({ openid, familyId }) {
  const famRes = await db.collection("families").where({ _id: familyId }).get();
  const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
  if (!fam) throw new Error("家庭不存在");
  if (!Array.isArray(fam.memberIds) || !fam.memberIds.includes(openid)) {
    throw new Error("没有家庭访问权限");
  }
  return fam;
}

async function getPendingOrderId({ openid, familyId }) {
  const orderRes = await db
    .collection("orders")
    .where({ familyId, status: "pending_shopping" })
    .orderBy("createTime", "asc")
    .limit(1)
    .get();
  const order = orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
  if (order) return order._id;
  return null;
}

/** 合并并发创建的重复待买菜订单：保留最早一条，其余空单删除、有菜品的合并进 keeper */
async function dedupePendingShoppingOrders({ familyId }) {
  const dupRes = await db
    .collection("orders")
    .where({ familyId, status: "pending_shopping" })
    .orderBy("createTime", "asc")
    .get();
  const dups = dupRes.data || [];
  if (dups.length <= 1) return dups[0] ? dups[0]._id : null;

  const keeper = dups[0];
  let keeperId = keeper._id;

  for (let i = 1; i < dups.length; i++) {
    const extra = dups[i];
    const extraRecipes = Array.isArray(extra.recipes) ? extra.recipes : [];
    const keeperRecipes = Array.isArray(keeper.recipes) ? keeper.recipes : [];

    if (extraRecipes.length === 0) {
      await db.collection("orders").where({ _id: extra._id }).remove();
      await db.collection("order_shopping_items").where({ orderId: extra._id, familyId }).remove();
      await db.collection("order_cooking_steps").where({ orderId: extra._id, familyId }).remove();
      continue;
    }

    const keeperIds = new Set(keeperRecipes.map((r) => r && r.recipeId).filter(Boolean));
    for (const r of extraRecipes) {
      if (!r || !r.recipeId || keeperIds.has(r.recipeId)) continue;
      keeperRecipes.push(r);
      keeperIds.add(r.recipeId);
      await rebuildChecklistForRecipe({
        openid: extra.creatorId || keeper.creatorId,
        orderId: keeperId,
        familyId,
        recipeId: r.recipeId,
      });
    }

    await db.collection("orders").where({ _id: keeperId }).update({
      data: { recipes: keeperRecipes, updateTime: now() },
    });
    keeper.recipes = keeperRecipes;

    await db.collection("order_shopping_items").where({ orderId: extra._id, familyId }).remove();
    await db.collection("order_cooking_steps").where({ orderId: extra._id, familyId }).remove();
    await db.collection("orders").where({ _id: extra._id }).remove();
  }

  return keeperId;
}

async function getOrCreatePendingOrderId({ openid, familyId, orderName }) {
  let pendingId = await getPendingOrderId({ openid, familyId });
  if (pendingId) return pendingId;

  await db.collection("orders").add({
    data: {
      familyId,
      orderName,
      status: "pending_shopping",
      recipes: [],
      creatorId: openid,
      createTime: now(),
    },
  });

  pendingId = await dedupePendingShoppingOrders({ familyId });
  if (pendingId) return pendingId;

  return getPendingOrderId({ openid, familyId });
}

async function getOrderById(orderId) {
  const orderRes = await db.collection("orders").where({ _id: orderId }).get();
  return orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
}

async function mapOrderRecipesWithNames(recipes, orderCreatorId) {
  const list = Array.isArray(recipes) ? recipes : [];
  const recipeIds = list.map((r) => r && (r.recipeId || r.id)).filter(Boolean);

  let recipeNameMap = {};
  if (recipeIds.length) {
    const _ = db.command;
    for (let i = 0; i < recipeIds.length; i += 100) {
      const slice = recipeIds.slice(i, i + 100);
      const recipeRes = await db.collection("recipes").where({ _id: _.in(slice) }).get();
      for (const r of recipeRes.data || []) {
        recipeNameMap[r._id] = r.recipeName;
      }
    }
  }

  const creatorOpenids = list
    .map((r) => (r && (r.creatorId || orderCreatorId)) || "")
    .filter(Boolean);
  let nickNameMap = {};
  if (creatorOpenids.length) {
    const unique = [...new Set(creatorOpenids)];
    const usersRes = await db.collection("users").where({ _id: db.command.in(unique) }).get();
    for (const u of usersRes.data || []) {
      nickNameMap[u._id] = u.nickName || "";
    }
  }

  return list.map((r) => {
    const rid = (r && (r.recipeId || r.id)) || "";
    const creatorId = (r && (r.creatorId || orderCreatorId)) || "";
    return {
      recipeId: rid,
      recipeName: recipeNameMap[rid] || "",
      note: r.note || "",
      creatorId,
      creatorNickName: nickNameMap[creatorId] || "未知用户",
    };
  });
}

async function removeRecipeFromOrder({ openid, orderId, recipeId }) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("点菜单不存在");
  await assertFamilyMember({ openid, familyId: order.familyId });

  if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
    throw new Error("当前点菜单已不可删菜");
  }

  const recipes = Array.isArray(order.recipes) ? order.recipes : [];
  const nextRecipes = recipes.filter((r) => r && r.recipeId !== recipeId);
  if (nextRecipes.length === recipes.length) {
    return { success: true, removed: false, isEmpty: nextRecipes.length === 0 };
  }

  await db.collection("orders").where({ _id: orderId }).update({
    data: {
      recipes: nextRecipes,
      updateTime: now(),
    },
  });

  await db
    .collection("order_shopping_items")
    .where({ orderId, familyId: order.familyId, recipeId })
    .remove();
  await db
    .collection("order_cooking_steps")
    .where({ orderId, familyId: order.familyId, recipeId })
    .remove();

  const manualRes = await db
    .collection("order_shopping_items")
    .where({ orderId, familyId: order.familyId, itemSource: "manual" })
    .limit(1)
    .get();
  const hasManual = !!(manualRes && manualRes.data && manualRes.data[0]);

  return {
    success: true,
    removed: true,
    isEmpty: nextRecipes.length === 0 && !hasManual,
  };
}

async function deleteOrderWithDetailsIfEmpty({ openid, orderId }) {
  const order = await getOrderById(orderId);
  if (!order) return { success: true, deleted: false };
  await assertFamilyMember({ openid, familyId: order.familyId });
  if (order.status !== "pending_shopping") {
    throw new Error("当前点菜单不可删除");
  }

  const recipes = Array.isArray(order.recipes) ? order.recipes : [];
  const manualRes = await db
    .collection("order_shopping_items")
    .where({ orderId, familyId: order.familyId, itemSource: "manual" })
    .limit(1)
    .get();
  const hasManual = !!(manualRes && manualRes.data && manualRes.data[0]);
  if (recipes.length || hasManual) {
    throw new Error("点菜单不为空，无法删除");
  }

  await db.collection("orders").where({ _id: orderId }).remove();
  await db.collection("order_shopping_items").where({ orderId, familyId: order.familyId }).remove();
  await db.collection("order_cooking_steps").where({ orderId, familyId: order.familyId }).remove();

  return { success: true, deleted: true };
}

/** 强制删除点菜单（含已点菜品、买菜/做菜清单），家庭成员均可触发，由业务确认框约束 */
async function deleteOrderCompletely({ openid, orderId }) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("点菜单不存在");
  await assertFamilyMember({ openid, familyId: order.familyId });
  const familyId = order.familyId;
  await db.collection("order_shopping_items").where({ orderId, familyId }).remove();
  await db.collection("order_cooking_steps").where({ orderId, familyId }).remove();
  await db.collection("orders").where({ _id: orderId }).remove();
  return { success: true, deleted: true };
}

async function rebuildChecklistForRecipe({ openid, orderId, familyId, recipeId }) {
  // 删除该菜谱对应的 recipe 自动生成条目，保留 manual extra 条目（recipeId = null）
  await db.collection("order_shopping_items").where({ orderId, familyId, recipeId }).remove();
  await db.collection("order_cooking_steps").where({ orderId, familyId, recipeId }).remove();

  const recipeRes = await db.collection("recipes").where({ _id: recipeId }).get();
  const recipe = recipeRes && recipeRes.data && recipeRes.data[0] ? recipeRes.data[0] : null;
  if (!recipe) throw new Error("菜谱不存在");

  // ingredients -> shopping items
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  for (const ing of ingredients) {
    await db.collection("order_shopping_items").add({
      data: {
        familyId,
        orderId,
        recipeId,
        itemSource: "ingredient",
        name: ing.name,
        amount: ing.amount || "",
        done: false,
        createdAt: now(),
      },
    });
  }

  // seasonings -> shopping items
  const seasonings = Array.isArray(recipe.seasonings) ? recipe.seasonings : [];
  for (const s of seasonings) {
    await db.collection("order_shopping_items").add({
      data: {
        familyId,
        orderId,
        recipeId,
        itemSource: "seasoning",
        name: s.name,
        amount: s.amount || "",
        done: false,
        createdAt: now(),
      },
    });
  }

  // prepareSteps -> cooking steps
  const prepareSteps = Array.isArray(recipe.prepareSteps) ? recipe.prepareSteps : [];
  for (let idx = 0; idx < prepareSteps.length; idx++) {
    await db.collection("order_cooking_steps").add({
      data: {
        familyId,
        orderId,
        recipeId,
        phase: "prepare",
        stepIndex: idx,
        stepText: prepareSteps[idx],
        done: false,
        createdAt: now(),
      },
    });
  }

  // cookingSteps -> cooking steps
  const cookingSteps = Array.isArray(recipe.cookingSteps) ? recipe.cookingSteps : [];
  for (let idx = 0; idx < cookingSteps.length; idx++) {
    await db.collection("order_cooking_steps").add({
      data: {
        familyId,
        orderId,
        recipeId,
        phase: "cooking",
        stepIndex: idx,
        stepText: cookingSteps[idx],
        done: false,
        createdAt: now(),
      },
    });
  }
}

async function addRecipeToOrder({ openid, orderId, recipeId, note }) {
  if (note && String(note).trim()) {
    await assertTextsSafe(cloud, { openid, texts: [note], scene: 3 });
  }

  const orderRes = await db.collection("orders").where({ _id: orderId }).get();
  const order = orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
  if (!order) throw new Error("点菜单不存在");
  const familyId = order.familyId;
  await assertFamilyMember({ openid, familyId });

  // 确保该菜谱属于同一家庭
  const recipeRes = await db.collection("recipes").where({ _id: recipeId }).get();
  const recipe = recipeRes && recipeRes.data && recipeRes.data[0] ? recipeRes.data[0] : null;
  if (!recipe) throw new Error("菜谱不存在");
  if (recipe.familyId !== familyId) throw new Error("菜谱不属于当前家庭");

  if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
    throw new Error("当前点菜单已不可加菜");
  }

  const recipes = Array.isArray(order.recipes) ? order.recipes : [];
  const existingIdx = recipes.findIndex((r) => r.recipeId === recipeId);
  if (existingIdx >= 0) {
    throw new Error("该菜品已在点菜单中");
  }
  recipes.push({ recipeId, note: note || "", creatorId: openid });

  await db.collection("orders").where({ _id: orderId }).update({
    data: {
      recipes,
    },
  });

  await rebuildChecklistForRecipe({ openid, orderId, familyId, recipeId });
}

async function syncOrderRecipes({ openid, orderId, recipes }) {
  const order = await getOrderById(orderId);
  if (!order) throw new Error("点菜单不存在");
  const familyId = order.familyId;
  await assertFamilyMember({ openid, familyId });

  if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
    throw new Error("当前点菜单已不可修改");
  }

  const incoming = Array.isArray(recipes) ? recipes : [];
  const notes = incoming.map((r) => (r && r.note) || "").filter((t) => String(t).trim());
  if (notes.length) {
    await assertTextsSafe(cloud, { openid, texts: notes, scene: 3 });
  }

  const normalized = [];
  const seen = new Set();
  for (const r of incoming) {
    const recipeId = r && (r.recipeId || r.id);
    if (!recipeId || seen.has(recipeId)) continue;
    seen.add(recipeId);
    normalized.push({
      recipeId,
      note: (r && r.note) || "",
      creatorId: (r && r.creatorId) || openid,
    });
  }

  for (const r of normalized) {
    const recipeRes = await db.collection("recipes").where({ _id: r.recipeId }).get();
    const recipe = recipeRes && recipeRes.data && recipeRes.data[0] ? recipeRes.data[0] : null;
    if (!recipe) throw new Error("菜谱不存在");
    if (recipe.familyId !== familyId) throw new Error("菜谱不属于当前家庭");
  }

  const current = Array.isArray(order.recipes) ? order.recipes : [];
  const currentIds = new Set(current.map((r) => r && r.recipeId).filter(Boolean));
  const nextIds = new Set(normalized.map((r) => r.recipeId));

  const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
  const toAdd = normalized.filter((r) => !currentIds.has(r.recipeId));

  for (const recipeId of toRemove) {
    await db
      .collection("order_shopping_items")
      .where({ orderId, familyId, recipeId })
      .remove();
    await db
      .collection("order_cooking_steps")
      .where({ orderId, familyId, recipeId })
      .remove();
  }

  await db.collection("orders").where({ _id: orderId }).update({
    data: {
      recipes: normalized,
      updateTime: now(),
    },
  });

  for (const r of toAdd) {
    await rebuildChecklistForRecipe({ openid, orderId, familyId, recipeId: r.recipeId });
  }

  const manualRes = await db
    .collection("order_shopping_items")
    .where({ orderId, familyId, itemSource: "manual" })
    .limit(1)
    .get();
  const hasManual = !!(manualRes && manualRes.data && manualRes.data[0]);
  const isEmpty = normalized.length === 0 && !hasManual;

  return { success: true, isEmpty };
}

function randOrderInviteToken(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function getOrCreateOrderInviteToken({ openid, orderId, familyId, inviteCode }) {
  const existing = await db.collection("order_invite_tokens").where({ orderId }).limit(1).get();
  const row = existing && existing.data && existing.data[0] ? existing.data[0] : null;
  if (row && row.token) return row.token;

  let token = randOrderInviteToken(12);
  for (let i = 0; i < 5; i++) {
    const hit = await db.collection("order_invite_tokens").where({ token }).limit(1).get();
    if (!hit || !hit.data || hit.data.length === 0) break;
    token = randOrderInviteToken(12);
  }

  await db.collection("order_invite_tokens").add({
    data: {
      token,
      orderId,
      familyId,
      inviteCode,
      createdAt: now(),
      createdBy: openid,
    },
  });
  return token;
}

exports.main = async (event) => {
  const ctx = getWXContext();
  if (!event || !event.type) throw new Error("缺少 type");

  const publicTypes = new Set(["getOrderInvitePreview"]);
  const openid = publicTypes.has(event.type) ? ctx.OPENID : getOpenidOrThrow(ctx);

  switch (event.type) {
    case "ensurePendingShoppingOrder": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const pendingOrderId = await getPendingOrderId({ openid, familyId });
      if (pendingOrderId) return { success: true, orderId: pendingOrderId };

      const famRes = await db.collection("families").where({ _id: familyId }).get();
      const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
      const orderName = fam && fam.familyName ? `${fam.familyName}的点菜单` : "新的点菜单";

      const orderId = await getOrCreatePendingOrderId({ openid, familyId, orderName });
      if (!orderId) throw new Error("未能创建待买菜点菜单");

      return { success: true, orderId };
    }

    case "createOrder": {
      const { familyId, orderName } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const name = orderName || "新的点菜单";
      await assertTextsSafe(cloud, { openid, texts: [name], scene: 3 });

      const created = await db.collection("orders").add({
        data: {
          familyId,
          orderName: name,
          status: "pending_shopping",
          recipes: [],
          creatorId: openid,
          createTime: now(),
        },
      });
      return { success: true, orderId: created._id };
    }

    case "addRecipeToPendingShoppingOrder": {
      const { familyId, recipeId, note } = event;
      if (!familyId || !recipeId) throw new Error("缺少 familyId/recipeId");
      await assertFamilyMember({ openid, familyId });

      let orderId = await getPendingOrderId({ openid, familyId });
      if (!orderId) {
        const famRes = await db.collection("families").where({ _id: familyId }).get();
        const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
        const orderName = fam && fam.familyName ? `${fam.familyName}的点菜单` : "新的点菜单";
        orderId = await getOrCreatePendingOrderId({ openid, familyId, orderName });
      }

      if (!orderId) throw new Error("未能获取待买菜点菜单");

      await addRecipeToOrder({ openid, orderId, recipeId, note });
      return { success: true, orderId };
    }

    case "addRecipeToOrder": {
      const { orderId, recipeId, note } = event;
      if (!orderId || !recipeId) throw new Error("缺少 orderId/recipeId");
      await addRecipeToOrder({ openid, orderId, recipeId, note });
      return { success: true };
    }

    /** 原子同步点菜单内全部菜品（增删一次性提交） */
    case "syncOrderRecipes": {
      const { orderId, recipes } = event;
      if (!orderId) throw new Error("缺少 orderId");
      return await syncOrderRecipes({ openid, orderId, recipes });
    }

    case "getPendingShoppingOrderDetail": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const pendingOrderId = await getPendingOrderId({ openid, familyId });
      if (!pendingOrderId) return { success: true, order: null };

      const order = await getOrderById(pendingOrderId);
      if (!order) return { success: true, order: null };

      const recipes = await mapOrderRecipesWithNames(order.recipes, order.creatorId);
      return {
        success: true,
        order: {
          _id: order._id,
          orderName: order.orderName,
          status: order.status,
          createTime: order.createTime,
          recipes,
        },
      };
    }

    case "removeRecipeFromPendingShoppingOrder": {
      const { orderId, familyId, recipeId } = event;
      if (!recipeId) throw new Error("缺少 recipeId");

      let oid = orderId || "";
      if (!oid) {
        if (!familyId) throw new Error("缺少 orderId/familyId");
        await assertFamilyMember({ openid, familyId });
        oid = await getPendingOrderId({ openid, familyId });
      }
      if (!oid) throw new Error("未找到待买菜点菜单");

      return await removeRecipeFromOrder({ openid, orderId: oid, recipeId });
    }

    case "deleteOrderIfEmpty": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");
      return await deleteOrderWithDetailsIfEmpty({ openid, orderId });
    }

    case "deleteOrder": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");
      return await deleteOrderCompletely({ openid, orderId });
    }

    case "listOrders": {
      const { familyId, status } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const res = await db
        .collection("orders")
        .where(status ? { familyId, status } : { familyId })
        .orderBy("createTime", "desc")
        .get();

      return {
        success: true,
        orders: (res.data || []).map((o) => ({
          _id: o._id,
          orderName: o.orderName,
          status: o.status,
          createTime: o.createTime,
          recipeCount: Array.isArray(o.recipes) ? o.recipes.length : 0,
        })),
      };
    }

    /** 首页「点菜单」：列出进行中（待买菜 + 待制作）的全部点菜单 */
    case "listActiveOrders": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const [shopRes, cookRes] = await Promise.all([
        db.collection("orders").where({ familyId, status: "pending_shopping" }).orderBy("createTime", "desc").get(),
        db.collection("orders").where({ familyId, status: "pending_cooking" }).orderBy("createTime", "desc").get(),
      ]);

      const mapOne = (o) => ({
        _id: o._id,
        orderName: o.orderName,
        status: o.status,
        createTime: o.createTime,
        recipeCount: Array.isArray(o.recipes) ? o.recipes.length : 0,
      });

      const merged = [...(shopRes.data || []), ...(cookRes.data || [])].map(mapOne);
      merged.sort((a, b) => {
        const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
        const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
        return tb - ta;
      });

      return { success: true, orders: merged };
    }

    /** 首页等场景：云函数内并行查各状态最新一条点菜单，减少客户端往返次数 */
    case "listFirstOrdersByStatuses": {
      const { familyId, statuses } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const want =
        Array.isArray(statuses) && statuses.length > 0
          ? statuses
          : ["pending_shopping", "pending_cooking"];

      const mapOne = (o) =>
        o
          ? {
              _id: o._id,
              orderName: o.orderName,
              status: o.status,
              createTime: o.createTime,
            }
          : null;

      const q = (status) =>
        db
          .collection("orders")
          .where({ familyId, status })
          .orderBy("createTime", "desc")
          .limit(1)
          .get()
          .then((r) => (r && r.data && r.data[0] ? r.data[0] : null));

      const results = await Promise.all(want.map((s) => q(s)));
      const byStatus = {};
      want.forEach((s, i) => {
        byStatus[s] = results[i];
      });

      return {
        success: true,
        pendingShopping: mapOne(byStatus.pending_shopping),
        pendingCooking: mapOne(byStatus.pending_cooking),
      };
    }

    case "getOrderDetail": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const order = await getOrderById(orderId);
      if (!order) throw new Error("点菜单不存在");

      await assertFamilyMember({ openid, familyId: order.familyId });

      const recipes = await mapOrderRecipesWithNames(order.recipes, order.creatorId);

      return {
        success: true,
        order: {
          _id: order._id,
          orderName: order.orderName,
          status: order.status,
          createTime: order.createTime,
          recipes,
        },
      };
    }

    /** 家庭内各菜谱在历史点菜单中的出现次数（用于 TOP 排序） */
    case "countRecipeOrdersInFamily": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const ordersRes = await db.collection("orders").where({ familyId }).get();
      const counts = {};
      for (const o of ordersRes.data || []) {
        const list = Array.isArray(o.recipes) ? o.recipes : [];
        for (const r of list) {
          const id = r && r.recipeId;
          if (!id) continue;
          counts[id] = (counts[id] || 0) + 1;
        }
      }
      return { success: true, counts };
    }

    /** 某月内已完成的点菜单（用于家庭页干饭日历） */
    case "listCompletedOrdersInMonth": {
      const { familyId, year, month } = event;
      if (!familyId) throw new Error("缺少 familyId");
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      if (!y || !m || m < 1 || m > 12) throw new Error("缺少 year/month");
      await assertFamilyMember({ openid, familyId });

      const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const end = new Date(y, m, 0, 23, 59, 59, 999);

      const ordersRes = await db
        .collection("orders")
        .where({ familyId, status: "completed" })
        .limit(1000)
        .get();
      const monthOrders = (ordersRes.data || [])
        .map((o) => {
          const t = pickOrderCalendarTime(o);
          if (!t) return null;
          const d = new Date(t);
          if (Number.isNaN(d.getTime())) return null;
          if (d < start || d > end) return null;
          return o;
        })
        .filter(Boolean);

      const orders = await enrichOrdersForCalendarDetail(monthOrders, familyId);

      return { success: true, orders };
    }

    case "prepareOrderInvite": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const order = await getOrderById(orderId);
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
        throw new Error("当前点菜单已不可邀请点餐");
      }

      const famRes = await db.collection("families").where({ _id: order.familyId }).get();
      const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
      if (!fam || !fam.inviteCode) throw new Error("家庭邀请码不可用");

      const token = await getOrCreateOrderInviteToken({
        openid,
        orderId,
        familyId: order.familyId,
        inviteCode: fam.inviteCode,
      });

      return { success: true, token };
    }

    case "getOrderInvitePreview": {
      const { token } = event;
      const t = String(token || "").trim();
      if (!t) return { success: false, errMsg: "缺少 token" };

      const tr = await db.collection("order_invite_tokens").where({ token: t }).limit(1).get();
      const row = tr && tr.data && tr.data[0] ? tr.data[0] : null;
      if (!row) return { success: false, errMsg: "邀请已失效或不存在" };

      const order = await getOrderById(row.orderId);
      if (!order) return { success: false, errMsg: "点菜单不存在" };
      if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
        return { success: false, errMsg: "点菜单已结束，无法继续点餐" };
      }

      const famRes = await db.collection("families").where({ _id: row.familyId }).get();
      const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;

      return {
        success: true,
        preview: {
          orderId: row.orderId,
          familyId: row.familyId,
          orderName: order.orderName || "点菜单",
          familyName: (fam && fam.familyName) || "家庭",
          inviteCode: row.inviteCode || (fam && fam.inviteCode) || "",
          status: order.status,
        },
      };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

