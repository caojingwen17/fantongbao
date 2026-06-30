/**
 * 云存储 fileID（cloud://）在部分真机（尤其 iOS）上 image 组件可能不稳定，
 * 转为临时 HTTPS 后再展示更可靠。临时链接约 2 小时有效。
 *
 * 若控制台云存储为「仅创建者可读」，客户端 wx.cloud.getTempFileURL 无法解析他人上传的文件，
 * 需传入 familyId，由云函数 recipeFunctions.getTempFileURLs 换链（家庭成员均可访问）。
 */

const cloud = require("./cloud");

/** 临时链本地缓存（约 90 分钟，避免每次 onShow/搜索都调云函数） */
const URL_CACHE_TTL_MS = 90 * 60 * 1000;
const urlCache = new Map();

function getCachedUrl(fileId) {
  const row = urlCache.get(fileId);
  if (!row || Date.now() > row.expiresAt) {
    if (row) urlCache.delete(fileId);
    return null;
  }
  return row.url;
}

function putCachedUrls(map) {
  if (!map || typeof map !== "object") return;
  const expiresAt = Date.now() + URL_CACHE_TTL_MS;
  Object.keys(map).forEach((fileId) => {
    if (map[fileId]) urlCache.set(fileId, { url: map[fileId], expiresAt });
  });
}

function clientResolveBatch(ids) {
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: ids,
      success: (res) => {
        const map = {};
        (res.fileList || []).forEach((item) => {
          if (item && item.fileID) {
            map[item.fileID] = item.tempFileURL || item.fileID;
          }
        });
        resolve(map);
      },
      fail: () => resolve({}),
    });
  });
}

async function fetchUncachedUrls(ids, options) {
  const familyId = options && options.familyId;
  if (familyId) {
    try {
      const res = await cloud.callFunction("recipeFunctions", {
        type: "getTempFileURLs",
        familyId,
        fileIds: ids,
      });
      if (res && res.map && typeof res.map === "object") return res.map;
    } catch (e) {
      /* 回退客户端 */
    }
  }
  return clientResolveBatch(ids);
}

/**
 * @param {string[]} fileIds
 * @param {{ familyId?: string }} [options] 有 familyId 时优先走云函数换链
 * @returns {Promise<Record<string, string>>} fileID -> tempFileURL
 */
async function resolveBatch(fileIds, options) {
  const ids = [...new Set((fileIds || []).filter((x) => x && String(x).indexOf("cloud://") === 0))];
  if (!ids.length) return {};

  const result = {};
  const missing = [];
  ids.forEach((id) => {
    const cached = getCachedUrl(id);
    if (cached) result[id] = cached;
    else missing.push(id);
  });

  if (missing.length) {
    const fresh = await fetchUncachedUrls(missing, options);
    putCachedUrls(fresh);
    missing.forEach((id) => {
      if (fresh[id]) result[id] = fresh[id];
    });
  }

  return result;
}

/**
 * @param {string} src
 * @param {{ familyId?: string }} [options]
 */
async function resolveForImage(src, options) {
  if (!src || typeof src !== "string") return "";
  if (src.indexOf("cloud://") !== 0) return src;
  const cached = getCachedUrl(src);
  if (cached) return cached;
  const map = await resolveBatch([src], options);
  return map[src] || src;
}

/**
 * 菜谱列表项增加 recipeImgDisplay（供 image src 使用）
 * 已有 recipeImgDisplay 且 recipeImg 未变时复用，减少 setData 体积。
 */
async function attachRecipeImgDisplay(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  const withFam = list.find((r) => r && r.familyId);
  const familyId = withFam ? withFam.familyId : "";
  const needResolve = [];
  list.forEach((r) => {
    const id = r && r.recipeImg;
    if (!id || String(id).indexOf("cloud://") !== 0) return;
    if (r.recipeImgDisplay && r.recipeImgDisplay !== id) return;
    if (getCachedUrl(id)) return;
    needResolve.push(id);
  });

  let map = {};
  if (needResolve.length) {
    map = await resolveBatch(needResolve, familyId ? { familyId } : {});
  }

  return list.map((r) => {
    const id = r && r.recipeImg;
    if (!id) return { ...r, recipeImgDisplay: r.recipeImgDisplay || "" };
    if (typeof id === "string" && id.indexOf("cloud://") !== 0) {
      return { ...r, recipeImgDisplay: id };
    }
    const cached = getCachedUrl(id);
    const display = cached || (map[id] ? map[id] : r.recipeImgDisplay || id);
    return { ...r, recipeImgDisplay: display || id || "" };
  });
}

module.exports = {
  resolveForImage,
  resolveBatch,
  attachRecipeImgDisplay,
};
