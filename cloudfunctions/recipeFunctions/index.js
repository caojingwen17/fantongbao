const cloud = require("wx-server-sdk");
const { getOpenidOrThrow } = require("./auth");
const {
  assertTextsSafe,
  assertCloudImageSafe,
  collectRecipeTexts,
} = require("./sec");

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

/** 点餐邀请 token 校验：返回 token 记录（含 orderId/familyId），无效返回 null */
async function getOrderInviteRow(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  const tr = await db.collection("order_invite_tokens").where({ token: t }).limit(1).get();
  return tr && tr.data && tr.data[0] ? tr.data[0] : null;
}

/** 客人凭邀请 token 访问家庭菜谱时的环节校验：进入买菜环节或已结束后不可再点菜 */
async function assertGuestOrderPickable(inviteRow) {
  const orderRes = await db.collection("orders").where({ _id: inviteRow.orderId }).get();
  const order = orderRes && orderRes.data && orderRes.data[0] ? orderRes.data[0] : null;
  if (!order) throw new Error("点菜单不存在");
  if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
    throw new Error("点菜单已结束，无法继续点餐");
  }
  if (order.shoppingStartedAt) {
    throw new Error("该点菜单已开始买菜，不能继续点菜啦");
  }
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

function isCloudPathForFamily(fileId, familyId) {
  const s = String(fileId || "");
  if (!s || !familyId) return false;
  return (
    s.includes(`/recipes/${familyId}/`) ||
    s.includes(`/imports/recipe_ocr/${familyId}/`)
  );
}

/** 仅允许换链属于该家庭的 fileID（路径前缀 + 库内引用） */
async function filterFamilyFileIds({ familyId, fileIds }) {
  const ids = [...new Set((fileIds || []).filter((x) => x && String(x).indexOf("cloud://") === 0))];
  if (!ids.length) return [];

  const allowed = new Set();
  for (const id of ids) {
    if (isCloudPathForFamily(id, familyId)) allowed.add(id);
  }

  const remaining = ids.filter((id) => !allowed.has(id));
  if (!remaining.length) return [...allowed];

  const _ = db.command;
  const remArr = [...new Set(remaining)];

  const famRes = await db.collection("families").where({ _id: familyId }).get();
  const memberIds = (famRes.data && famRes.data[0] && famRes.data[0].memberIds) || [];

  // 按候选 id 反查，查询次数固定、与家庭数据量脱钩
  // 防御性分批（_.in 上限 100），remaining 通常只有几个
  const chunks = [];
  for (let i = 0; i < remArr.length; i += 100) {
    chunks.push(remArr.slice(i, i + 100));
  }
  const queryByCandidate = (collection, extraWhere, fieldSpec, key) =>
    Promise.all(
      chunks.map((c) =>
        db
          .collection(collection)
          .where({ ...extraWhere, [key]: _.in(c) })
          .field(fieldSpec)
          .get()
      )
    ).then((ress) => ress.reduce((acc, r) => acc.concat(r.data || []), []));

  const [recipeHits, userHits, tokenHits] = await Promise.all([
    queryByCandidate("recipes", { familyId }, { recipeImg: true }, "recipeImg"),
    queryByCandidate("users", { _id: _.in(memberIds) }, { avatarUrl: true }, "avatarUrl"),
    queryByCandidate(
      "recipe_share_tokens",
      {},
      { qrFileId: true, recipeId: true },
      "qrFileId"
    ),
  ]);

  for (const r of recipeHits) {
    const img = r && r.recipeImg;
    if (img) allowed.add(img);
  }
  for (const u of userHits) {
    const av = u && u.avatarUrl;
    if (av) allowed.add(av);
  }

  // 二维码 token 需确认其 recipeId 属于本家庭后才能放行
  const tokenRecipeIds = [
    ...new Set(tokenHits.map((t) => t && t.recipeId).filter(Boolean)),
  ];
  if (tokenRecipeIds.length) {
    const confirmRes = await db
      .collection("recipes")
      .where({ _id: _.in(tokenRecipeIds), familyId })
      .field({ _id: true })
      .get();
    const familyRecipeIds = new Set((confirmRes.data || []).map((r) => r._id));
    for (const t of tokenHits) {
      const qr = t && t.qrFileId;
      if (qr && familyRecipeIds.has(t.recipeId)) allowed.add(qr);
    }
  }

  return [...allowed];
}

exports.main = async (event) => {
  const ctx = getWXContext();
  const openid = getOpenidOrThrow(ctx);

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
      const { familyId, keyword, inviteToken } = event;
      let famId = familyId;

      // 客人凭点餐邀请 token 访问：familyId 以 token 记录为准，且仅限开始买菜前
      if (inviteToken) {
        const inviteRow = await getOrderInviteRow(inviteToken);
        if (!inviteRow) throw new Error("邀请已失效，请重新打开链接");
        await assertGuestOrderPickable(inviteRow);
        famId = inviteRow.familyId;
      }
      if (!famId) throw new Error("缺少 familyId");
      if (!inviteToken) await assertFamilyMember({ openid, familyId: famId });

      const lite = event.lite === true;
      const liteField = { recipeName: true, recipeImg: true, createTime: true };
      // 分页：skip/limit（不传时维持旧行为上限 100 条；列表页传 30）；多取 1 条判断 hasMore
      const skip = Math.max(0, parseInt(event.skip, 10) || 0);
      const limit = Math.min(100, Math.max(1, parseInt(event.limit, 10) || 100));

      const runPagedQuery = async (where) => {
        let query = db
          .collection("recipes")
          .where(where)
          .orderBy("createTime", "desc");
        if (lite) query = query.field(liteField);
        const res = await query
          .skip(skip)
          .limit(limit + 1)
          .get();
        const rows = res.data || [];
        const hasMore = rows.length > limit;
        const recipes = rows.slice(0, limit).map((r) => ({ ...r, id: r._id }));
        return { success: true, recipes, hasMore };
      };

      if (keyword) {
        // 尝试使用正则检索；若云库不支持该正则语法，可先在前端过滤
        const reg = db.RegExp ? db.RegExp({ regexp: keyword, options: "i" }) : null;
        if (reg) {
          return runPagedQuery({ familyId: famId, recipeName: reg });
        }
      }

      return runPagedQuery({ familyId: famId });
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

    case "checkRecipeImage": {
      const { fileID, familyId } = event;
      if (!fileID) throw new Error("缺少 fileID");
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });
      if (!isCloudPathForFamily(fileID, familyId) || !String(fileID).includes(`/recipes/${familyId}/`)) {
        throw new Error("图片路径无效，请重新上传");
      }
      await assertCloudImageSafe(cloud, fileID);
      return { success: true };
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

      await assertTextsSafe(cloud, {
        openid,
        scene: 3,
        texts: collectRecipeTexts({
          recipeName,
          ingredients,
          seasonings,
          prepareSteps,
          cookingSteps,
        }),
      });
      if (recipeImg) {
        if (!isCloudPathForFamily(recipeImg, familyId) || !String(recipeImg).includes(`/recipes/${familyId}/`)) {
          throw new Error("展示图路径无效，请重新上传");
        }
        await assertCloudImageSafe(cloud, recipeImg);
      }

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

      const nextName = recipeName || recipe.recipeName;
      const nextIngredients = ingredients || recipe.ingredients || [];
      const nextSeasonings = seasonings || recipe.seasonings || [];
      const nextPrepare = prepareSteps || recipe.prepareSteps || [];
      const nextCooking = cookingSteps || recipe.cookingSteps || [];
      const nextImg = recipeImg || recipe.recipeImg;

      await assertTextsSafe(cloud, {
        openid,
        scene: 3,
        texts: collectRecipeTexts({
          recipeName: nextName,
          ingredients: nextIngredients,
          seasonings: nextSeasonings,
          prepareSteps: nextPrepare,
          cookingSteps: nextCooking,
        }),
      });
      // 仅当展示图发生变化时校验路径与内容安全：
      // 早期分享导入的菜谱沿用了原家庭的图片路径（recipes/{原家庭}/），未换图时不应被拦
      if (nextImg && nextImg !== recipe.recipeImg) {
        if (
          !isCloudPathForFamily(nextImg, recipe.familyId) ||
          !String(nextImg).includes(`/recipes/${recipe.familyId}/`)
        ) {
          throw new Error("展示图路径无效，请重新上传");
        }
        await assertCloudImageSafe(cloud, nextImg);
      }

      await db.collection("recipes").where({ _id: recipeId }).update({
        data: {
          recipeName: nextName,
          recipeImg: nextImg,
          xiaohongshuUrl: xiaohongshuUrl || recipe.xiaohongshuUrl || "",
          ingredients: nextIngredients,
          seasonings: nextSeasonings,
          prepareSteps: nextPrepare,
          cookingSteps: nextCooking,
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
      const { familyId, fileIds, inviteToken } = event;
      let famId = familyId;
      // 客人凭点餐邀请 token 换链：familyId 以 token 记录为准
      if (inviteToken) {
        const inviteRow = await getOrderInviteRow(inviteToken);
        if (!inviteRow) throw new Error("邀请已失效，请重新打开链接");
        famId = inviteRow.familyId;
      }
      if (!famId) throw new Error("缺少 familyId");
      if (!inviteToken) await assertFamilyMember({ openid, familyId: famId });
      const ids = await filterFamilyFileIds({ familyId: famId, fileIds });
      if (!ids.length) return { success: true, map: {} };
      // getTempFileURL 单次上限 50 个 fileID，超出必须分批，否则整批失败
      const fileItems = [];
      for (let i = 0; i < ids.length; i += 50) {
        const tmp = await cloud.getTempFileURL({ fileList: ids.slice(i, i + 50) });
        (tmp.fileList || []).forEach((item) => fileItems.push(item));
      }
      const map = {};
      fileItems.forEach((item) => {
        // tempFileURL 缺失时不回退 cloud:// 原样值（客户端会视为成功结果缓存，而 cloud:// 不能直渲）
        if (item && item.fileID && item.tempFileURL) {
          map[item.fileID] = item.tempFileURL;
        }
      });
      console.log(`[recipeFunctions] getTempFileURLs family=${famId} req=${ids.length} ok=${Object.keys(map).length}`);
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
          if (!recipeImgDisplay) {
            console.warn(
              "[recipeFunctions] getRecipeSharePreview 换链无结果:",
              img,
              JSON.stringify(item || tmp || {})
            );
          }
        } catch (e) {
          // 换链失败时 recipeImgDisplay 回落为 cloud:// fileID，扫码用户可能无权限直读，需记录排查
          console.warn("[recipeFunctions] getRecipeSharePreview 换链失败:", img, (e && e.message) || String(e));
        }
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

      const name = recipe.recipeName || "菜谱";

      // 展示图复制一份到当前家庭路径：导入菜谱自包含，
      // 原图被删/原家庭路径校验（updateRecipe）都不受影响
      const srcImg = String(recipe.recipeImg || "");
      let recipeImg = srcImg;
      if (srcImg.indexOf("cloud://") === 0) {
        try {
          const dl = await cloud.downloadFile({ fileID: srcImg });
          if (dl && dl.fileContent) {
            const m = srcImg.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i);
            const ext = m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
            const cloudPath = `recipes/${familyId}/${Date.now()}-${Math.random()
              .toString(16)
              .slice(2)}.${ext}`;
            const up = await cloud.uploadFile({ cloudPath, fileContent: dl.fileContent });
            if (up && up.fileID) recipeImg = up.fileID;
          }
        } catch (e) {
          // 复制失败沿用原图引用，不阻断导入
          console.warn(
            "[recipeFunctions] importSharedRecipe 复制展示图失败，沿用原图:",
            (e && e.message) || String(e)
          );
        }
      }

      const created = await db.collection("recipes").add({
        data: {
          familyId,
          recipeName: name,
          recipeImg,
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

