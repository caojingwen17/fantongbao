const cloud = require("./cloud");

const SESSION_KEY = "fantongbao_session";

/** 微信静默/旧接口返回的占位昵称，不能当作真实资料 */
const PLACEHOLDER_NICKNAMES = ["微信用户", "WeChat User"];

function isPlaceholderNickName(name) {
  if (!name || typeof name !== "string") return true;
  return PLACEHOLDER_NICKNAMES.includes(name.trim());
}

/** 文档中的默认灰头像 URL 片段，旧授权常见 */
function isWeChatDefaultAvatarUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.indexOf("mmbiz/icTdbqWNOwNRna42") !== -1;
}

function getValidSessionOrNull() {
  try {
    const s = wx.getStorageSync(SESSION_KEY);
    const badNick = s && isPlaceholderNickName(s.nickName);
    const badAvatar =
      s &&
      s.avatarUrl &&
      typeof s.avatarUrl === "string" &&
      isWeChatDefaultAvatarUrl(s.avatarUrl);
    if (!s || !s.nickName || !s.avatarUrl || badNick || badAvatar) {
      if (badNick || badAvatar) wx.removeStorageSync(SESSION_KEY);
      return null;
    }
    return { nickName: s.nickName, avatarUrl: s.avatarUrl };
  } catch (e) {
    wx.removeStorageSync(SESSION_KEY);
    return null;
  }
}

/**
 * 统一的登录流程：云端 login → 写入 session → 初始化 → 拉取家庭列表并选中 currentFamilyId
 * @param {{ nickName: string, avatarUrl: string }} userInfo avatarUrl 可为云 fileID 或 https
 * @returns {Promise<{ currentFamilyId: string|null, families: any[] }>}
 */
async function completeLoginFlow(userInfo) {
  const loginResp = await cloud.callFunctionWithErrorToast("familyFunctions", {
    type: "login",
    nickName: userInfo.nickName,
    avatarUrl: userInfo.avatarUrl,
  });

  wx.setStorageSync(SESSION_KEY, {
    nickName: userInfo.nickName,
    avatarUrl: userInfo.avatarUrl,
  });

  const app = getApp();
  app.globalData.userInfo = userInfo;
  if (loginResp && loginResp.openid) app.globalData.openid = loginResp.openid;

  const [, familiesResp] = await Promise.all([
    cloud.callFunction("initFunctions", { init: true }).catch(() => null),
    cloud.callFunction("familyFunctions", { type: "getMyFamilies" }).catch(() => null),
  ]);

  const families = (familiesResp && familiesResp.families) || [];
  app.globalData.families = families;

  const serverCid =
    loginResp && loginResp.currentFamilyId ? loginResp.currentFamilyId : null;
  if (serverCid && families.some((f) => f._id === serverCid)) {
    app.globalData.currentFamilyId = serverCid;
  } else {
    app.globalData.currentFamilyId = (families[0] && families[0]._id) || null;
  }

  return {
    currentFamilyId: app.globalData.currentFamilyId || null,
    families,
  };
}

/**
 * 若本地存在可用 session，则静默走 completeLoginFlow。
 * @returns {Promise<{ ok: boolean, currentFamilyId: string|null }>}
 */
async function trySilentLogin() {
  const s = getValidSessionOrNull();
  if (!s) return { ok: false, currentFamilyId: null };
  const { currentFamilyId } = await completeLoginFlow(s);
  return { ok: true, currentFamilyId: currentFamilyId || null };
}

function isLoggedIn() {
  const app = getApp();
  return !!(app && app.globalData && app.globalData.userInfo);
}

/**
 * 已登录或静默登录成功返回 { ok: true }；否则弹窗。
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'cancel' | 'login' }>}
 */
async function requireLoggedIn(options) {
  const opt = options || {};
  const app = getApp();
  if (app.globalData.userInfo) return { ok: true };
  try {
    const r = await trySilentLogin();
    if (r.ok) return { ok: true };
  } catch (e) {
    /* ignore */
  }
  return new Promise((resolve) => {
    wx.showModal({
      title: opt.title || "需要登录",
      content: opt.content || "使用此功能需要先登录。",
      confirmText: "去登录",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: "/pages/login/login/index" });
          resolve({ ok: false, reason: "login" });
        } else {
          resolve({ ok: false, reason: "cancel" });
        }
      },
      fail: () => resolve({ ok: false, reason: "cancel" }),
    });
  });
}

/**
 * 用于子页面 onLoad：未登录则弹窗；用户点「取消」时返回上一页或首页。
 * @returns {Promise<boolean>}
 */
async function requireLoggedInOrBack(options) {
  const r = await requireLoggedIn(options);
  if (r.ok) return true;
  if (r.reason === "cancel") {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/pages/index/index" }),
    });
  }
  return false;
}

module.exports = {
  SESSION_KEY,
  getValidSessionOrNull,
  isPlaceholderNickName,
  completeLoginFlow,
  trySilentLogin,
  isLoggedIn,
  requireLoggedIn,
  requireLoggedInOrBack,
};

