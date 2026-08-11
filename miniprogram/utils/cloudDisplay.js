/**
 * 云存储 fileID（cloud://）在部分真机（尤其 iOS）上 image 组件可能不稳定，
 * 转为临时 HTTPS 后再展示更可靠。临时链接约 2 小时有效。
 *
 * 若控制台云存储为「仅创建者可读」，客户端 wx.cloud.getTempFileURL 无法解析他人上传的文件，
 * 需传入 familyId，由云函数 recipeFunctions.getTempFileURLs 换链（家庭成员均可访问）。
 */

const cloud = require("./cloud");

/** 临时链本地缓存（60 分钟：临时链 sign 约 2 小时有效，留足安全边际，降低缓存投毒窗口） */
const URL_CACHE_TTL_MS = 60 * 60 * 1000;
const urlCache = new Map();

/** 失败负缓存（30 秒）：持续性失败时避免每次 onShow/搜索都重发注定失败的请求 */
const NEG_CACHE_TTL_MS = 30 * 1000;
const negCache = new Map();

/** 进行中的换链请求（key -> Promise），并发同批 fileID 复用，避免缓存击穿 */
const inflight = new Map();

/** 只有真实换到的 http(s) 临时链才算成功结果；cloud:// 原样值不能入缓存（不能直渲） */
function isHttpTempUrl(url) {
  return typeof url === "string" && /^https?:\/\//.test(url);
}

function isNegCached(fileId) {
  const expiresAt = negCache.get(fileId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    negCache.delete(fileId);
    return false;
  }
  return true;
}

function getCachedUrl(fileId) {
  const row = urlCache.get(fileId);
  if (!row || Date.now() > row.expiresAt) {
    if (row) urlCache.delete(fileId);
    return null;
  }
  return row.url;
}

/** 使某个 fileID 的缓存失效（图片加载失败时强制下次重新解析） */
function invalidate(fileId) {
  if (!fileId) return;
  urlCache.delete(fileId);
  negCache.delete(fileId);
}

function putCachedUrls(map) {
  if (!map || typeof map !== "object") return;
  const expiresAt = Date.now() + URL_CACHE_TTL_MS;
  Object.keys(map).forEach((fileId) => {
    if (isHttpTempUrl(map[fileId])) urlCache.set(fileId, { url: map[fileId], expiresAt });
  });
}

/** 单次 getTempFileURL 上限 50 个 fileID，超出分批并发后合并 */
function clientResolveBatch(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) {
    chunks.push(ids.slice(i, i + 50));
  }
  return Promise.all(chunks.map(clientResolveChunk)).then((maps) =>
    Object.assign({}, ...maps)
  );
}

function clientResolveChunk(ids) {
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: ids,
      success: (res) => {
        const map = {};
        (res.fileList || []).forEach((item) => {
          // tempFileURL 缺失时不得把 cloud:// 原样写入（会被当成功结果缓存 90 分钟，而 cloud:// 不能直渲）
          if (item && item.fileID && isHttpTempUrl(item.tempFileURL)) {
            map[item.fileID] = item.tempFileURL;
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
  const inviteToken = options && options.inviteToken;
  if (familyId || inviteToken) {
    try {
      const res = await cloud.callFunction("recipeFunctions", {
        type: "getTempFileURLs",
        familyId: familyId || "",
        fileIds: ids,
        inviteToken: inviteToken || "",
      }, { timeout: 25000 });
      const map = res && res.map && typeof res.map === "object" ? res.map : null;
      if (map) {
        // 云函数换链可能缺项（过滤/部分失败，或返回 cloud:// 原样值——同样不算成功），
        // 缺的部分再用客户端兜底补齐
        const missing = ids.filter((id) => !isHttpTempUrl(map[id]));
        if (!missing.length) return map;
        const clientMap = await clientResolveBatch(missing);
        return { ...map, ...clientMap };
      }
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
    else if (!isNegCached(id)) missing.push(id);
  });

  if (missing.length) {
    // 并发同批 fileID 复用同一个进行中请求，避免缓存击穿（key 与 familyId/inviteToken 相关）
    const familyId = options && options.familyId ? options.familyId : "";
    const inviteToken = options && options.inviteToken ? options.inviteToken : "";
    const key = familyId + "|" + inviteToken + "|" + [...missing].sort().join("|");
    let fetchPromise = inflight.get(key);
    if (!fetchPromise) {
      fetchPromise = fetchUncachedUrls(missing, options).then((map) => {
        // 即使下方 race 已超时返回，迟到的结果也要落缓存，避免下次全量重发
        putCachedUrls(map);
        return map;
      });
      inflight.set(key, fetchPromise);
      const clearInflight = () => inflight.delete(key);
      fetchPromise.then(clearInflight, clearInflight);
    }

    // 换链加超时：挂起不能阻塞页面刷新（去重锁靠底层请求 settle 释放）
    const timeoutMark = {};
    const fresh = await Promise.race([
      fetchPromise,
      new Promise((resolve) => setTimeout(() => resolve(timeoutMark), 12000)),
    ]);
    if (fresh !== timeoutMark) {
      missing.forEach((id) => {
        if (isHttpTempUrl(fresh[id])) result[id] = fresh[id];
        else negCache.set(id, Date.now() + NEG_CACHE_TTL_MS);
      });
    }
  }

  return result;
}

/**
 * @param {string} src
 * @param {{ familyId?: string }} [options]
 * 解析失败返回 ""（不回退 cloud://——Android 直渲 cloud:// 极不稳定，会闪图后消失）
 */
async function resolveForImage(src, options) {
  if (!src || typeof src !== "string") return "";
  if (src.indexOf("cloud://") !== 0) return src;
  const cached = getCachedUrl(src);
  if (cached) return cached;
  const map = await resolveBatch([src], options);
  return map[src] || "";
}

/**
 * 微批聚合的单张解析：同一 tick 内多个组件/调用合并为一次 resolveBatch，
 * 避免列表场景 N 个 ft-cloud-image 各发一次换链请求。
 * 注意：同 tick 混合不同 familyId/inviteToken 时以首个带上下文的为准
 * （实际只有当前可见页面在发请求，不会出现跨上下文混合）。
 */
let queuedResolveItems = [];
let queuedResolveTimer = null;

function resolveForImageQueued(src, options) {
  if (!src || typeof src !== "string") return Promise.resolve("");
  if (src.indexOf("cloud://") !== 0) return Promise.resolve(src);
  const cached = getCachedUrl(src);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    queuedResolveItems.push({ src, options: options || {}, resolve });
    if (!queuedResolveTimer) {
      queuedResolveTimer = setTimeout(flushQueuedResolves, 0);
    }
  });
}

async function flushQueuedResolves() {
  queuedResolveTimer = null;
  const items = queuedResolveItems;
  queuedResolveItems = [];
  const ids = [...new Set(items.map((x) => x.src))];
  const ctxItem =
    items.find((x) => x.options.familyId) ||
    items.find((x) => x.options.inviteToken) ||
    { options: {} };
  const map = await resolveBatch(ids, ctxItem.options);
  items.forEach((x) => x.resolve(map[x.src] || getCachedUrl(x.src) || ""));
}

/**
 * 菜谱列表项增加 recipeImgDisplay（供 image src 使用）
 * 已有 recipeImgDisplay 且 recipeImg 未变时复用，减少 setData 体积。
 * options.inviteToken：客人凭点餐邀请 token 走云函数换链。
 */
async function attachRecipeImgDisplay(recipes, options) {
  const list = Array.isArray(recipes) ? recipes : [];
  const withFam = list.find((r) => r && r.familyId);
  const familyId = withFam ? withFam.familyId : "";
  const inviteToken = options && options.inviteToken ? options.inviteToken : "";
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
    const opts = {};
    if (familyId) opts.familyId = familyId;
    if (inviteToken) opts.inviteToken = inviteToken;
    map = await resolveBatch(needResolve, opts);
  }

  return list.map((r) => {
    const id = r && r.recipeImg;
    if (!id) return { ...r, recipeImgDisplay: r.recipeImgDisplay || "" };
    if (typeof id === "string" && id.indexOf("cloud://") !== 0) {
      return { ...r, recipeImgDisplay: id };
    }
    const cached = getCachedUrl(id);
    const display = cached || map[id] || r.recipeImgDisplay || "";
    return { ...r, recipeImgDisplay: display };
  });
}

module.exports = {
  resolveForImage,
  resolveForImageQueued,
  resolveBatch,
  attachRecipeImgDisplay,
  getCachedUrl,
  invalidate,
};
