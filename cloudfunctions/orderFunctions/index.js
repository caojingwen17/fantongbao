const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function now() {
  return new Date();
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
    .limit(1)
    .get();
  const order = orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
  if (order) return order._id;
  return null;
}

async function getOrderById(orderId) {
  const orderRes = await db.collection("orders").where({ _id: orderId }).get();
  return orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
}

async function mapOrderRecipesWithNames(recipes, orderCreatorId) {
  const list = Array.isArray(recipes) ? recipes : [];
  const recipeIds = list.map((r) => r && r.recipeId).filter(Boolean);

  let recipeNameMap = {};
  if (recipeIds.length) {
    const recipeRes = await db.collection("recipes").where({ _id: db.command.in(recipeIds) }).get();
    for (const r of recipeRes.data || []) {
      recipeNameMap[r._id] = r.recipeName;
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
    const creatorId = (r && (r.creatorId || orderCreatorId)) || "";
    return {
      recipeId: r.recipeId,
      recipeName: recipeNameMap[r.recipeId] || "",
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

  if (order.status !== "pending_shopping") {
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

  // 更新 orders.recipes：若存在则覆盖 note；否则追加
  const recipes = Array.isArray(order.recipes) ? order.recipes : [];
  const existingIdx = recipes.findIndex((r) => r.recipeId === recipeId);
  if (existingIdx >= 0) {
    recipes[existingIdx].note = note || "";
    // 记录“这道菜由谁点的”（同一 recipeId 会覆盖为最新点菜用户）
    recipes[existingIdx].creatorId = openid;
  } else {
    recipes.push({ recipeId, note: note || "", creatorId: openid });
  }

  await db.collection("orders").where({ _id: orderId }).update({
    data: {
      recipes,
    },
  });

  await rebuildChecklistForRecipe({ openid, orderId, familyId, recipeId });
}

exports.main = async (event) => {
  const ctx = getWXContext();
  const openid = ctx.OPENID;

  if (!event || !event.type) throw new Error("缺少 type");

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

      const created = await db.collection("orders").add({
        data: {
          familyId,
          orderName,
          status: "pending_shopping",
          recipes: [],
          creatorId: openid,
          createTime: now(),
        },
      });

      return { success: true, orderId: created._id };
    }

    case "createOrder": {
      const { familyId, orderName } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const created = await db.collection("orders").add({
        data: {
          familyId,
          orderName: orderName || "新的点菜单",
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

        const created = await db.collection("orders").add({
          data: {
            familyId,
            orderName,
            status: "pending_shopping",
            recipes: [],
            creatorId: openid,
            createTime: now(),
          },
        });
        orderId = created._id;
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
        })),
      };
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

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

