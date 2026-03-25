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
  } else {
    recipes.push({ recipeId, note: note || "" });
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

    case "getOrderDetail": {
      const { orderId } = event;
      if (!orderId) throw new Error("缺少 orderId");

      const orderRes = await db.collection("orders").where({ _id: orderId }).get();
      const order = orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
      if (!order) throw new Error("点菜单不存在");

      await assertFamilyMember({ openid, familyId: order.familyId });

      const recipes = Array.isArray(order.recipes) ? order.recipes : [];
      const recipeIds = recipes.map((r) => r.recipeId);
      let recipeNameMap = {};
      if (recipeIds.length) {
        const recipeRes = await db.collection("recipes").where({ _id: db.command.in(recipeIds) }).get();
        for (const r of recipeRes.data || []) {
          recipeNameMap[r._id] = r.recipeName;
        }
      }

      return {
        success: true,
        order: {
          _id: order._id,
          orderName: order.orderName,
          status: order.status,
          createTime: order.createTime,
          recipes: recipes.map((r) => ({
            recipeId: r.recipeId,
            recipeName: recipeNameMap[r.recipeId] || "",
            note: r.note || "",
          })),
        },
      };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

