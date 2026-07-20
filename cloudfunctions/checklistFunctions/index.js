const cloud = require("wx-server-sdk");
const { getOpenidOrThrow } = require("./auth");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function now() {
  return new Date();
}

function parseShoppingExpense(val) {
  if (val == null || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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

async function getOrder({ orderId }) {
  const res = await db.collection("orders").where({ _id: orderId }).get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，,。\.、;；:：!！\?？\(\)（）【】\[\]'"“”‘’]/g, "")
    .toLowerCase();
}

function normalizeUnit(unit) {
  const u = String(unit || "").trim().toLowerCase();
  if (!u) return "";
  if (["g", "克"].includes(u)) return "g";
  if (["kg", "千克", "公斤"].includes(u)) return "kg";
  if (["ml", "毫升"].includes(u)) return "ml";
  if (["l", "升"].includes(u)) return "l";
  if (["个", "只", "颗"].includes(u)) return "个";
  if (["勺", "汤匙", "茶匙"].includes(u)) return "勺";
  return u;
}

function parseAmountToQtyUnit(amount) {
  const raw = String(amount || "").trim();
  if (!raw) return null;
  // 支持：500g / 2个 / 1.5kg / 3 盒
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*([^\d\s].*)$/);
  if (!m) return null;
  const qty = Number(m[1]);
  const unit = normalizeUnit(String(m[2] || "").trim());
  if (!Number.isFinite(qty) || qty <= 0 || !unit) return null;
  return { qty, unit };
}

function buildMergedItems({ items, recipeNameMap }) {
  const map = {};
  for (const it of items || []) {
    if (!it) continue;
    const name = String(it.name || "").trim();
    if (!name) continue;

    const parsed = parseAmountToQtyUnit(it.amount);
    const key = normalizeName(name);

    if (!map[key]) {
      map[key] = {
        key,
        name,
        qtyByUnit: {},
        rawAmountsSet: {},
        totalAmountText: "",
        itemIds: [],
        manualItemIds: [],
        allDone: true,
        sourcesSet: {},
        sourcesText: "",
      };
    }
    const g = map[key];
    g.itemIds.push(it._id);
    if (it.itemSource === "manual") g.manualItemIds.push(it._id);
    g.allDone = g.allDone && !!it.done;

    if (parsed) {
      g.qtyByUnit[parsed.unit] = (g.qtyByUnit[parsed.unit] || 0) + parsed.qty;
    } else {
      const rawAmount = String(it.amount || "").trim();
      if (rawAmount) g.rawAmountsSet[rawAmount] = true;
    }

    if (it.itemSource === "manual" || !it.recipeId) {
      g.sourcesSet.__manual__ = "手动添加";
    } else if (it.recipeId) {
      const rn = recipeNameMap && recipeNameMap[it.recipeId] ? recipeNameMap[it.recipeId] : "";
      g.sourcesSet[it.recipeId] = rn || it.recipeId;
    }
  }

  const merged = Object.values(map);
  for (const g of merged) {
    const amountParts = [];
    const units = Object.keys(g.qtyByUnit || {});
    units.forEach((u) => {
      const qty = Number(g.qtyByUnit[u] || 0);
      if (!Number.isFinite(qty) || qty <= 0) return;
      amountParts.push(`${qty}${u}`);
    });
    const rawAmounts = Object.keys(g.rawAmountsSet || {});
    rawAmounts.forEach((a) => {
      if (a) amountParts.push(a);
    });
    g.totalAmountText = amountParts.join(" + ");
    const sources = Object.values(g.sourcesSet).filter(Boolean);
    g.sourcesText = sources.length ? `来自：${sources.join("、")}` : "";
  }

  // 让展示更稳定：按 name 排序
  merged.sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hans-CN"));
  return merged;
}

function normalizeStepText(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，,。\.、;；:：!！\?？\(\)（）【】\[\]'"“”‘’]/g, "")
    .toLowerCase();
}

exports.main = async (event) => {
  const ctx = getWXContext();
  const openid = getOpenidOrThrow(ctx);

  if (!event || !event.type) throw new Error("缺少 type");

  switch (event.type) {
    case "getShoppingChecklist": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      const itemsRes = await db.collection("order_shopping_items").where({ orderId, familyId: order.familyId }).get();
      const items = itemsRes.data || [];

      const recipes = Array.isArray(order.recipes) ? order.recipes : [];
      const recipeIds = recipes.map((r) => r.recipeId);
      let recipeNameMap = {};
      if (recipeIds.length) {
        const recipeRes = await db.collection("recipes").where({ _id: db.command.in(recipeIds) }).get();
        for (const r of recipeRes.data || []) recipeNameMap[r._id] = r.recipeName;
      }

      const recipeToNote = {};
      for (const r of recipes) recipeToNote[r.recipeId] = r.note || "";

      const mergedItems = buildMergedItems({ items, recipeNameMap });

      // groups：按 recipeId 聚合，manual extra（recipeId=null）放到一个“额外采购”组
      const groupsMap = {};
      for (const it of items) {
        const rid = it.recipeId || "__manual__";
        if (!groupsMap[rid]) {
          groupsMap[rid] = {
            recipeId: it.recipeId || "",
            recipeName: it.recipeId ? (recipeNameMap[it.recipeId] || "") : "额外采购",
            note: it.recipeId ? (recipeToNote[it.recipeId] || "") : "",
            items: [],
          };
        }
        groupsMap[rid].items.push({
          _id: it._id,
          name: it.name,
          amount: it.amount,
          done: !!it.done,
          itemSource: it.itemSource,
          recipeId: it.recipeId || "",
          note: it.note || "",
        });
      }

      const groups = Object.values(groupsMap);

      const totalCount = items.length;
      const doneCount = items.filter((x) => x.done).length;

      return {
        success: true,
        order: {
          _id: order._id,
          orderName: order.orderName,
          status: order.status,
        },
        mergedItems,
        groups,
        totalCount,
        doneCount,
      };
    }

    case "markMergedItemsDone": {
      const { orderId, itemIds } = event;
      if (!orderId) throw new Error("缺少 orderId");
      const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
      if (!ids.length) return { success: true };

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });
      if (order.status !== "pending_shopping") {
        return { success: true, newOrderStatus: order.status };
      }

      await db
        .collection("order_shopping_items")
        .where({ _id: db.command.in(ids), orderId, familyId: order.familyId })
        .update({
          data: {
            done: true,
            doneTime: now(),
          },
        });

      return { success: true };
    }

    case "markMergedItemsUndone": {
      const { orderId, itemIds } = event;
      if (!orderId) throw new Error("缺少 orderId");
      const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
      if (!ids.length) return { success: true };

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });
      if (order.status !== "pending_shopping") {
        return { success: true, newOrderStatus: order.status };
      }

      await db
        .collection("order_shopping_items")
        .where({ _id: db.command.in(ids), orderId, familyId: order.familyId })
        .update({
          data: {
            done: false,
            doneTime: null,
          },
        });

      return { success: true };
    }

    case "removeManualShoppingItems": {
      const { orderId, itemIds } = event;
      if (!orderId) throw new Error("缺少 orderId");
      const ids = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
      if (!ids.length) return { success: true, removed: 0 };

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });
      if (order.status !== "pending_shopping") {
        throw new Error("当前订单不允许删除额外采购项");
      }

      // 仅允许删除 manual 且未完成
      const res = await db
        .collection("order_shopping_items")
        .where({
          _id: db.command.in(ids),
          orderId,
          familyId: order.familyId,
          itemSource: "manual",
          done: false,
        })
        .remove();
      return { success: true, removed: (res && res.stats && res.stats.removed) || 0 };
    }

    case "markShoppingItemDone": {
      const { itemId } = event;
      if (!itemId) throw new Error("缺少 itemId");

      const itemRes = await db.collection("order_shopping_items").where({ _id: itemId }).get();
      const item = itemRes && itemRes.data && itemRes.data[0] ? itemRes.data[0] : null;
      if (!item) throw new Error("采购项不存在");

      const order = await getOrder({ orderId: item.orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_shopping") {
        return { success: true, newOrderStatus: order.status };
      }

      if (!item.done) {
        await db.collection("order_shopping_items").where({ _id: itemId }).update({
          data: {
            done: true,
            doneTime: now(),
          },
        });
      }

      // V3：勾选仅用于采购核对，不自动切换订单状态；由 completeShoppingOrder 显式完成买菜
      return { success: true, newOrderStatus: order.status };
    }

    case "completeShoppingOrder": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_shopping") {
        return { success: true, newOrderStatus: order.status };
      }

      const newOrderStatus = "pending_cooking";
      await db.collection("orders").doc(orderId).update({
        data: {
          status: newOrderStatus,
          shoppingCompletedAt: now(),
        },
      });

      return { success: true, newOrderStatus };
    }

    case "setShoppingExpense": {
      const { orderId, shoppingExpense } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const expense = parseShoppingExpense(shoppingExpense);
      if (expense == null) throw new Error("消费金额需大于 0");

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_cooking" && order.status !== "completed") {
        throw new Error("当前订单不可记录买菜消费");
      }

      await db.collection("orders").doc(orderId).update({
        data: { shoppingExpense: expense },
      });

      return { success: true, shoppingExpense: expense };
    }

    case "addExtraShoppingItem": {
      const { orderId, name, amount } = event;
      if (!orderId) throw new Error("缺少 orderId");
      if (!name) throw new Error("缺少 name");

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_shopping") {
        throw new Error("当前订单不允许添加额外采购项");
      }

      await db.collection("order_shopping_items").add({
        data: {
          familyId: order.familyId,
          orderId: order._id,
          recipeId: "",
          itemSource: "manual",
          name,
          amount: amount || "",
          done: false,
          createdAt: now(),
        },
      });

      return { success: true };
    }

    case "removeExtraShoppingItem": {
      const { itemId } = event;
      if (!itemId) throw new Error("缺少 itemId");

      const itemRes = await db.collection("order_shopping_items").where({ _id: itemId }).get();
      const item = itemRes && itemRes.data && itemRes.data[0] ? itemRes.data[0] : null;
      if (!item) throw new Error("采购项不存在");
      if (item.itemSource !== "manual") throw new Error("仅可删除额外采购项");
      if (item.done) throw new Error("已完成的采购项不可删除");

      const order = await getOrder({ orderId: item.orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_shopping") {
        throw new Error("当前订单不允许删除额外采购项");
      }

      await db.collection("order_shopping_items").where({ _id: itemId }).remove();
      return { success: true };
    }

    case "getCookingChecklist": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      const stepsRes = await db.collection("order_cooking_steps").where({ orderId, familyId: order.familyId }).get();
      const steps = stepsRes.data || [];

      const recipes = Array.isArray(order.recipes) ? order.recipes : [];
      const recipeIds = recipes.map((r) => r.recipeId);
      let recipeNameMap = {};
      if (recipeIds.length) {
        const recipeRes = await db.collection("recipes").where({ _id: db.command.in(recipeIds) }).get();
        for (const r of recipeRes.data || []) recipeNameMap[r._id] = r.recipeName;
      }

      const recipeToNote = {};
      for (const r of recipes) recipeToNote[r.recipeId] = r.note || "";

      const groupsMap = {};
      for (const s of steps) {
        const rid = s.recipeId || "";
        if (!groupsMap[rid]) {
          groupsMap[rid] = {
            recipeId: rid,
            recipeName: recipeNameMap[rid] || "",
            note: recipeToNote[rid] || "",
            prepareSteps: [],
            cookingSteps: [],
            _prepareSeen: {},
            _cookingSeen: {},
          };
        }
        const key = normalizeStepText(s.stepText);
        if (!key) continue;
        if (s.phase === "prepare") {
          if (groupsMap[rid]._prepareSeen[key]) continue;
          groupsMap[rid]._prepareSeen[key] = true;
          groupsMap[rid].prepareSteps.push({
            _id: s._id,
            stepText: s.stepText,
            done: !!s.done,
            stepIndex: s.stepIndex || 0,
          });
        } else {
          if (groupsMap[rid]._cookingSeen[key]) continue;
          groupsMap[rid]._cookingSeen[key] = true;
          groupsMap[rid].cookingSteps.push({
            _id: s._id,
            stepText: s.stepText,
            done: !!s.done,
            stepIndex: s.stepIndex || 0,
          });
        }
      }

      const groups = Object.values(groupsMap).map((g) => {
        g.prepareSteps.sort((a, b) => a.stepIndex - b.stepIndex);
        g.cookingSteps.sort((a, b) => a.stepIndex - b.stepIndex);
        delete g._prepareSeen;
        delete g._cookingSeen;
        return g;
      });

      const totalCount = steps.length;
      const doneCount = steps.filter((x) => x.done).length;

      return {
        success: true,
        order: {
          _id: order._id,
          orderName: order.orderName,
          status: order.status,
        },
        groups,
        totalCount,
        doneCount,
      };
    }

    case "markCookingStepDone": {
      const { stepId } = event;
      if (!stepId) throw new Error("缺少 stepId");

      const stepRes = await db.collection("order_cooking_steps").where({ _id: stepId }).get();
      const step = stepRes && stepRes.data && stepRes.data[0] ? stepRes.data[0] : null;
      if (!step) throw new Error("步骤不存在");

      const order = await getOrder({ orderId: step.orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_cooking") {
        return { success: true, newOrderStatus: order.status };
      }

      if (!step.done) {
        await db.collection("order_cooking_steps").where({ _id: stepId }).update({
          data: {
            done: true,
            doneTime: now(),
          },
        });
      }

      const allRes = await db.collection("order_cooking_steps").where({ orderId: order._id, familyId: order.familyId }).get();
      const allSteps = allRes.data || [];
      const allDone = allSteps.length > 0 && allSteps.every((x) => !!x.done);

      let newOrderStatus = order.status;
      if (allDone) {
        newOrderStatus = "completed";
        await db.collection("orders").where({ _id: order._id }).update({
          data: {
            status: newOrderStatus,
            completedAt: now(),
            updateTime: now(),
          },
        });
      }

      return { success: true, newOrderStatus };
    }

    case "markCookingStepUndone": {
      const { stepId } = event;
      if (!stepId) throw new Error("缺少 stepId");

      const stepRes = await db.collection("order_cooking_steps").where({ _id: stepId }).get();
      const step = stepRes && stepRes.data && stepRes.data[0] ? stepRes.data[0] : null;
      if (!step) throw new Error("步骤不存在");

      const order = await getOrder({ orderId: step.orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_cooking") {
        return { success: true, newOrderStatus: order.status };
      }

      await db.collection("order_cooking_steps").where({ _id: stepId }).update({
        data: {
          done: false,
          doneTime: null,
        },
      });

      return { success: true, newOrderStatus: order.status };
    }

    case "completeCookingOrder": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const order = await getOrder({ orderId });
      if (!order) throw new Error("点菜单不存在");
      await assertFamilyMember({ openid, familyId: order.familyId });

      if (order.status !== "pending_cooking") {
        return { success: true, newOrderStatus: order.status };
      }

      const newOrderStatus = "completed";
      await db.collection("orders").where({ _id: order._id }).update({
        data: {
          status: newOrderStatus,
          completedAt: now(),
          updateTime: now(),
        },
      });

      return { success: true, newOrderStatus };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

