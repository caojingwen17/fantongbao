const auth = require("./auth");
const cloud = require("./cloud");

/** 上次会话的当前家庭 id（乐观预取用） */
const FAMILY_ID_STORAGE_KEY = "fantongbao_current_family_id";

/**
 * 主入口启动判定：新用户 guest / 已登录无家庭 needFamily / 已登录有家庭 ok
 * @returns {"guest"|"needFamily"|"ok"}
 */
async function resolveMainEntryStatus() {
  const app = getApp();

  if (app.globalData.userInfo) {
    if (!app.globalData.currentFamilyId) return "needFamily";
    return "ok";
  }

  const r = await auth.trySilentLogin();
  if (!r.ok || !app.globalData.userInfo) return "guest";
  if (!app.globalData.currentFamilyId) return "needFamily";
  return "ok";
}

function fireHomePrefetch(app, familyId) {
  // promise 包装为 { ok, data, error }，避免无人消费时产生未处理 rejection
  const promise = cloud
    .callFunction("familyFunctions", { type: "getHomeData", familyId, limit: 4 })
    .then((data) => ({ ok: true, data, error: null }))
    .catch((e) => ({ ok: false, data: null, error: e }));

  app.globalData.homePrefetch = { familyId, promise, ts: Date.now() };
}

/**
 * 启动页一进来就根据上次会话的 familyId 乐观预取首页数据，
 * 与静默登录全程并行。云端按 openid 鉴权，familyId 只是参数：
 * 若已失效（被移出家庭等），预取失败后首页会自动回退实时请求。
 */
function startOptimisticHomePrefetch() {
  const app = getApp();
  if (!app || !app.globalData || app.globalData.homePrefetch) return;

  let familyId = "";
  try {
    familyId = wx.getStorageSync(FAMILY_ID_STORAGE_KEY) || "";
  } catch (e) {
    return;
  }
  if (!familyId) return;

  fireHomePrefetch(app, familyId);
}

/**
 * 身份判定完成后的正式预取：与启动页最短展示时长 + reLaunch 页面跳转并行，
 * 首页 onLoad 直接消费结果。乐观预取已命中同一家庭时保留（它发得更早）。
 */
function startHomePrefetch() {
  const app = getApp();
  const familyId = app.globalData && app.globalData.currentFamilyId;
  if (!familyId) return;

  try {
    wx.setStorageSync(FAMILY_ID_STORAGE_KEY, familyId);
  } catch (e) {
    /* 存储失败不影响预取 */
  }

  const existing = app.globalData.homePrefetch;
  if (existing && existing.familyId === familyId) return;

  fireHomePrefetch(app, familyId);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  resolveMainEntryStatus,
  startOptimisticHomePrefetch,
  startHomePrefetch,
  delay,
};
