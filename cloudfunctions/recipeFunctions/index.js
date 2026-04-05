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

function randomShareToken(len) {
  const n = typeof len === "number" ? len : 10;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < n; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

async function getOrCreateShareTokenForRecipe(recipeId) {
  const exist = await db.collection("recipe_share_tokens").where({ recipeId }).limit(1).get();
  if (exist && exist.data && exist.data[0]) return exist.data[0];

  for (let attempt = 0; attempt < 8; attempt++) {
    const token = randomShareToken(10);
    try {
      await db.collection("recipe_share_tokens").add({
        data: {
          token,
          recipeId,
          createTime: now(),
        },
      });
      const again = await db.collection("recipe_share_tokens").where({ recipeId }).limit(1).get();
      if (again && again.data && again.data[0]) return again.data[0];
    } catch (e) {
      const retry = await db.collection("recipe_share_tokens").where({ recipeId }).limit(1).get();
      if (retry && retry.data && retry.data[0]) return retry.data[0];
    }
  }
  throw new Error("生成分享码失败，请重试");
}

async function ensureShareQrFileId(token, envVersion) {
  const tr = await db.collection("recipe_share_tokens").where({ token }).limit(1).get();
  const row = tr && tr.data && tr.data[0] ? tr.data[0] : null;
  if (!row) throw new Error("分享已失效");
  if (row.qrFileId) {
    if (row.qrEnv === envVersion) return row.qrFileId;
    if (!row.qrEnv && envVersion === "release") return row.qrFileId;
  }

  const scene = `t=${token}`;
  if (scene.length > 32) throw new Error("scene 过长");

  const openapi = cloud.openapi && cloud.openapi.wxacode;
  if (!openapi || typeof openapi.getUnlimited !== "function") {
    throw new Error("未配置 wxacode.getUnlimited 云调用");
  }

  const ev =
    envVersion === "develop" || envVersion === "trial" || envVersion === "release"
      ? envVersion
      : "release";
  const qrParams = {
    scene,
    page: "pages/recipe/share/index",
    width: 280,
    autoColor: true,
    envVersion: ev,
  };
  if (ev === "develop" || ev === "trial") {
    qrParams.checkPath = false;
  }

  const qrRes = await openapi.getUnlimited(qrParams);

  const code =
    qrRes &&
    (qrRes.errcode !== undefined && qrRes.errcode !== null
      ? qrRes.errcode
      : qrRes.errCode);
  if (code !== undefined && code !== null && Number(code) !== 0) {
    throw new Error(
      (qrRes.errmsg || qrRes.errMsg || "生成小程序码失败") + ` (${code})`
    );
  }

  let buffer =
    (qrRes && qrRes.buffer) ||
    (qrRes && qrRes.data && qrRes.data.buffer) ||
    (qrRes && typeof qrRes.data === "object" && qrRes.data instanceof ArrayBuffer
      ? Buffer.from(qrRes.data)
      : null);
  if (!buffer && qrRes && qrRes.data && qrRes.data instanceof Uint8Array) {
    buffer = Buffer.from(qrRes.data);
  }
  if (!buffer) {
    const errMsg =
      (qrRes && (qrRes.errmsg || qrRes.errMsg || qrRes.message)) ||
      "生成小程序码失败：未返回图片数据";
    throw new Error(errMsg);
  }

  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const cloudPath = `share/qr/${token}-${Date.now()}.jpg`;
  const up = await cloud.uploadFile({
    cloudPath,
    fileContent: buf,
  });
  const fileID = up && up.fileID ? up.fileID : "";
  if (!fileID) throw new Error("上传小程序码失败");

  await db.collection("recipe_share_tokens").where({ token }).update({
    data: { qrFileId: fileID, qrUpdateTime: now(), qrEnv: ev },
  });

  return fileID;
}

exports.main = async (event) => {
  const ctx = getWXContext();
  const openid = ctx.OPENID;

  if (!event || !event.type) throw new Error("缺少 type");

  switch (event.type) {
    case "countRecipesByFamilyIds": {
      const { familyIds } = event;
      const ids = Array.isArray(familyIds)
        ? [...new Set(familyIds.filter((x) => x && String(x).trim()))]
        : [];
      if (!ids.length) return { success: true, counts: {} };

      // 只允许统计“我所在家庭”
      const famRes = await db
        .collection("families")
        .where({ _id: db.command.in(ids) })
        .get();
      const allowed = (famRes.data || [])
        .filter((f) => Array.isArray(f.memberIds) && f.memberIds.includes(openid))
        .map((f) => f._id);

      const counts = {};
      await Promise.all(
        allowed.map(async (familyId) => {
          const c = await db.collection("recipes").where({ familyId }).count();
          counts[familyId] = (c && typeof c.total === "number" ? c.total : 0) || 0;
        })
      );

      // 其他未授权/不存在的家庭 id 统一返回 0
      ids.forEach((id) => {
        if (typeof counts[id] !== "number") counts[id] = 0;
      });
      return { success: true, counts };
    }

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

    /** 首页：总数 + 最新若干条，避免拉全表菜谱 */
    case "listRecipesForHome": {
      const { familyId, limit } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });
      const lim = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 50);
      const [countRes, listRes] = await Promise.all([
        db.collection("recipes").where({ familyId }).count(),
        db
          .collection("recipes")
          .where({ familyId })
          .orderBy("createTime", "desc")
          .limit(lim)
          .get(),
      ]);
      const totalCount = (countRes && typeof countRes.total === "number" ? countRes.total : 0) || 0;
      const recipes = (listRes.data || []).map((r) => ({ ...r, id: r._id }));
      return { success: true, recipes, totalCount };
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
      if (!ingredients || !ingredients.length) throw new Error("至少1种食材");
      if (!prepareSteps || !prepareSteps.length) throw new Error("至少1个备菜步骤");

      await assertFamilyMember({ openid, familyId });

      const created = await db.collection("recipes").add({
        data: {
          familyId,
          recipeName,
          recipeImg: recipeImg || "",
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

    /** 分享海报：校验成员后为菜谱生成/复用 token，并生成右下角小程序码临时链 */
    case "prepareRecipeShare": {
      const { recipeId, envVersion: envFromClient } = event;
      if (!recipeId) throw new Error("缺少 recipeId");
      const res = await db.collection("recipes").where({ _id: recipeId }).get();
      const recipe = res.data && res.data[0];
      if (!recipe) throw new Error("菜谱不存在");
      await assertFamilyMember({ openid, familyId: recipe.familyId });

      const envVersion =
        envFromClient === "develop" ||
        envFromClient === "trial" ||
        envFromClient === "release"
          ? envFromClient
          : "release";

      const row = await getOrCreateShareTokenForRecipe(recipeId);
      const token = row.token;
      let qrTempUrl = "";
      let qrFileId = "";
      let qrError = "";
      try {
        qrFileId = await ensureShareQrFileId(token, envVersion);
      } catch (e) {
        qrError = (e && e.message) || String(e);
      }
      if (qrFileId) {
        try {
          const tmp = await cloud.getTempFileURL({ fileList: [qrFileId] });
          const item = tmp && tmp.fileList && tmp.fileList[0];
          if (item && item.tempFileURL) {
            qrTempUrl = item.tempFileURL;
          }
        } catch (e) {
          /* 换链失败不写入 qrError：客户端可用 wx.cloud.downloadFile(fileID)，避免误提示「网络异常」 */
        }
      }
      return { success: true, token, qrTempUrl, qrFileId, qrError };
    }

    /** 扫码落地页：凭 token 读菜谱快照（不要求在原家庭） */
    case "getRecipeSharePreview": {
      const { token } = event;
      const t = String(token || "").trim();
      if (!t) return { success: false, errMsg: "缺少 token" };
      const tr = await db.collection("recipe_share_tokens").where({ token: t }).limit(1).get();
      const row = tr.data && tr.data[0];
      if (!row) return { success: false, errMsg: "分享已失效或不存在" };
      const rr = await db.collection("recipes").where({ _id: row.recipeId }).get();
      const recipe = rr.data && rr.data[0];
      if (!recipe) return { success: false, errMsg: "原菜谱已删除" };

      let recipeImgDisplay = "";
      const img = recipe.recipeImg || "";
      if (img && String(img).indexOf("cloud://") === 0) {
        try {
          const tmp = await cloud.getTempFileURL({ fileList: [img] });
          const item = tmp && tmp.fileList && tmp.fileList[0];
          recipeImgDisplay = (item && item.tempFileURL) || "";
        } catch (e) {}
      } else if (img && /^https?:\/\//i.test(String(img))) {
        recipeImgDisplay = img;
      }

      return {
        success: true,
        preview: {
          recipeName: recipe.recipeName || "",
          recipeImg: img,
          recipeImgDisplay: recipeImgDisplay || img,
          ingredients: recipe.ingredients || [],
          seasonings: recipe.seasonings || [],
          prepareSteps: recipe.prepareSteps || [],
          cookingSteps: recipe.cookingSteps || [],
        },
      };
    }

    /** 将分享菜谱复制到当前用户所在家庭 */
    case "importSharedRecipe": {
      const { token, familyId } = event;
      const t = String(token || "").trim();
      if (!t) throw new Error("缺少 token");
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const tr = await db.collection("recipe_share_tokens").where({ token: t }).limit(1).get();
      const row = tr.data && tr.data[0];
      if (!row) throw new Error("分享已失效");
      const rr = await db.collection("recipes").where({ _id: row.recipeId }).get();
      const recipe = rr.data && rr.data[0];
      if (!recipe) throw new Error("原菜谱不存在");

      const ings = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
      const prep = Array.isArray(recipe.prepareSteps) ? recipe.prepareSteps : [];
      if (!ings.length) throw new Error("原菜谱无食材，无法导入");
      if (!prep.length) throw new Error("原菜谱无备菜步骤，无法导入");

      const baseName = recipe.recipeName || "菜谱";
      const name = `${baseName}（分享）`;

      const created = await db.collection("recipes").add({
        data: {
          familyId,
          recipeName: name,
          recipeImg: recipe.recipeImg || "",
          xiaohongshuUrl: recipe.xiaohongshuUrl || "",
          ingredients: ings,
          seasonings: Array.isArray(recipe.seasonings) ? recipe.seasonings : [],
          prepareSteps: prep,
          cookingSteps: Array.isArray(recipe.cookingSteps) ? recipe.cookingSteps : [],
          creatorId: openid,
          createTime: now(),
          updateTime: now(),
          importedFromShareToken: t,
          shareSourceRecipeId: recipe._id,
        },
      });

      return { success: true, recipeId: created._id };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

