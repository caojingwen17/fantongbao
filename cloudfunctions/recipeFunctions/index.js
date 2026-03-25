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

exports.main = async (event) => {
  const ctx = getWXContext();
  const openid = ctx.OPENID;

  if (!event || !event.type) throw new Error("缺少 type");

  switch (event.type) {
    case "listRecipes": {
      const { familyId, keyword } = event;
      if (!familyId) throw new Error("缺少 familyId");

      await assertFamilyMember({ openid, familyId });

      if (keyword) {
        // 尝试使用正则检索；若云库不支持该正则语法，可先在前端过滤
        const reg = db.RegExp ? db.RegExp({ regexp: keyword, options: "i" }) : null;
        if (reg) {
          const res = await db
            .collection("recipes")
            .where({ familyId, recipeName: reg })
            .orderBy("createTime", "desc")
            .get();
          const recipes = (res.data || []).map((r) => ({ ...r, id: r._id }));
          return { success: true, recipes };
        }
      }

      const res = await db
        .collection("recipes")
        .where({ familyId })
        .orderBy("createTime", "desc")
        .get();
      const recipes = (res.data || []).map((r) => ({ ...r, id: r._id }));
      return { success: true, recipes };
    }

    case "getRecipe": {
      const { recipeId } = event;
      if (!recipeId) throw new Error("缺少 recipeId");

      const res = await db.collection("recipes").where({ _id: recipeId }).get();
      const recipe = res && res.data && res.data[0] ? res.data[0] : null;
      if (!recipe) throw new Error("菜谱不存在");

      await assertFamilyMember({ openid, familyId: recipe.familyId });

      return {
        success: true,
        recipe,
      };
    }

    case "addRecipe": {
      const {
        familyId,
        recipeName,
        recipeImg,
        xiaohongshuUrl,
        ingredients,
        seasonings,
        prepareSteps,
        cookingSteps,
      } = event;

      if (!familyId) throw new Error("缺少 familyId");
      if (!recipeName) throw new Error("缺少 recipeName");
      if (!recipeImg) throw new Error("缺少 recipeImg");
      if (!ingredients || !ingredients.length) throw new Error("至少1种食材");
      if (!prepareSteps || !prepareSteps.length) throw new Error("至少1个备菜步骤");

      await assertFamilyMember({ openid, familyId });

      const created = await db.collection("recipes").add({
        data: {
          familyId,
          recipeName,
          recipeImg,
          xiaohongshuUrl: xiaohongshuUrl || "",
          ingredients,
          seasonings: seasonings || [],
          prepareSteps,
          cookingSteps: cookingSteps || [],
          creatorId: openid,
          createTime: now(),
          updateTime: now(),
        },
      });

      return { success: true, recipeId: created._id };
    }

    case "updateRecipe": {
      const {
        recipeId,
        recipeName,
        recipeImg,
        xiaohongshuUrl,
        ingredients,
        seasonings,
        prepareSteps,
        cookingSteps,
      } = event;

      if (!recipeId) throw new Error("缺少 recipeId");

      const res = await db.collection("recipes").where({ _id: recipeId }).get();
      const recipe = res && res.data && res.data[0] ? res.data[0] : null;
      if (!recipe) throw new Error("菜谱不存在");

      await assertFamilyMember({ openid, familyId: recipe.familyId });

      await db.collection("recipes").where({ _id: recipeId }).update({
        data: {
          recipeName: recipeName || recipe.recipeName,
          recipeImg: recipeImg || recipe.recipeImg,
          xiaohongshuUrl: xiaohongshuUrl || recipe.xiaohongshuUrl || "",
          ingredients: ingredients || recipe.ingredients || [],
          seasonings: seasonings || recipe.seasonings || [],
          prepareSteps: prepareSteps || recipe.prepareSteps || [],
          cookingSteps: cookingSteps || recipe.cookingSteps || [],
          updateTime: now(),
        },
      });

      return { success: true };
    }

    case "deleteRecipe": {
      const { recipeId } = event;
      if (!recipeId) throw new Error("缺少 recipeId");

      const res = await db.collection("recipes").where({ _id: recipeId }).get();
      const recipe = res && res.data && res.data[0] ? res.data[0] : null;
      if (!recipe) throw new Error("菜谱不存在");

      const fam = await assertFamilyMember({ openid, familyId: recipe.familyId });
      const isAdmin = fam.adminId === openid;
      const isCreator = recipe.creatorId === openid;
      if (!isAdmin && !isCreator) throw new Error("无权限删除");

      await db.collection("recipes").where({ _id: recipeId }).remove();
      return { success: true };
    }

    /**
     * 云存储若为「仅创建者可读」，客户端无法换他人上传的 fileID 临时链。
     * 云函数侧换链不受该限制，供家庭成员查看同一家庭内的菜谱图、头像等。
     */
    case "getTempFileURLs": {
      const { familyId, fileIds } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });
      const ids = Array.isArray(fileIds)
        ? [...new Set(fileIds.filter((x) => x && String(x).indexOf("cloud://") === 0))]
        : [];
      if (!ids.length) return { success: true, map: {} };
      const tmp = await cloud.getTempFileURL({ fileList: ids });
      const map = {};
      (tmp.fileList || []).forEach((item) => {
        if (item && item.fileID) {
          map[item.fileID] = item.tempFileURL || item.fileID;
        }
      });
      return { success: true, map };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

