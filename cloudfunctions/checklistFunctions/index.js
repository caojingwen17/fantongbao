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

async function getOrder({ orderId }) {
  const res = await db.collection("orders").where({ _id: orderId }).get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

exports.main = async (event) => {
  const ctx = getWXContext();
  const openid = ctx.OPENID;

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
        groups,
        totalCount,
        doneCount,
      };
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

      const allRes = await db.collection("order_shopping_items").where({ orderId: order._id, familyId: order.familyId }).get();
      const allItems = allRes.data || [];
      const allDone = allItems.length > 0 && allItems.every((x) => !!x.done);

      let newOrderStatus = order.status;
      if (allDone) {
        newOrderStatus = "pending_cooking";
        await db.collection("orders").where({ _id: order._id }).update({
          data: { status: newOrderStatus },
        });
      }

      return { success: true, newOrderStatus };
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
          };
        }
        if (s.phase === "prepare") {
          groupsMap[rid].prepareSteps.push({
            _id: s._id,
            stepText: s.stepText,
            done: !!s.done,
            stepIndex: s.stepIndex || 0,
          });
        } else {
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
          data: { status: newOrderStatus },
        });
      }

      return { success: true, newOrderStatus };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

