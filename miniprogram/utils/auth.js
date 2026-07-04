const cloud = require("./cloud");

const SESSION_KEY = "fantongbao_session";

/** 微信静默/旧接口返回的占位昵称，不能当作真实资料 */
const PLACEHOLDER_NICKNAMES = ["微信用户", "WeChat User"];

let _loginInflight = null;
let _loginInflightKey = "";
let _silentLoginInflight = null;

function isLoggedIn() {
  const app = getApp();
  return !!(app && app.globalData && app.globalData.userInfo);
}

function isPlaceholderNickName(name) {
  if (!name || typeof name !== "string") return true;
  return PLACEHOLDER_NICKNAMES.includes(name.trim());
}

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

function clearAuthState(options) {
  const keepSession = !!(options && options.keepSession);
  const app = getApp();
  if (app && app.globalData) {
    app.globalData.userInfo = null;
    app.globalData.openid = null;
    app.globalData.families = [];
    app.globalData.currentFamilyId = null;
  }
  if (!keepSession) {
    try {
      wx.removeStorageSync(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
  }
}

const LOGIN_ERROR_HINTS = {
  "缺少 openid": "无法识别微信身份：请用正式 AppID 编译，并在真机或开发者工具中确认已登录微信",
  未登录或无法识别用户: "无法识别微信身份，请关闭小程序后重新打开",
  "云函数未部署": "云函数 familyFunctions 未部署，请在开发者工具中右键上传并部署",
};

function formatLoginError(err) {
  if (!err) return "登录失败";
  const raw = err.message || err.errMsg || String(err);
  const m = raw.match(/Error:\s*(.+)$/);
  const core = (m && m[1] ? m[1].trim() : raw).trim();
  for (const key of Object.keys(LOGIN_ERROR_HINTS)) {
    if (core.includes(key)) return LOGIN_ERROR_HINTS[key];
  }
  return core.slice(0, 120);
}

function ensureWxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res && res.code) resolve();
        else reject(new Error("微信登录态获取失败，请重试"));
      },
      fail: (e) => {
        reject(new Error((e && e.errMsg) || "微信登录态获取失败"));
      },
    });
  });
}

async function runCompleteLoginFlow(userInfo, options) {
  await ensureWxLogin();

  const silent = !!(options && options.silent);
  const payload = {
    type: "login",
    nickName: userInfo.nickName,
    avatarUrl: userInfo.avatarUrl,
  };

  let loginResp;
  if (silent) {
    loginResp = await cloud.callFunction("familyFunctions", payload);
  } else {
    loginResp = await cloud.callFunctionWithErrorToast("familyFunctions", payload);
  }

  if (!loginResp || loginResp.success === false) {
    throw new Error(
      (loginResp && (loginResp.errMsg || loginResp.message)) || "云端登录失败"
    );
  }

  wx.setStorageSync(SESSION_KEY, {
    nickName: userInfo.nickName,
    avatarUrl: userInfo.avatarUrl,
  });

  const app = getApp();
  app.globalData.userInfo = {
    nickName: userInfo.nickName,
    avatarUrl: userInfo.avatarUrl,
  };
  if (loginResp.openid) app.globalData.openid = loginResp.openid;

  const familiesResp = await cloud
    .callFunction("familyFunctions", { type: "getMyFamilies" })
    .catch(() => null);

  const families = (familiesResp && familiesResp.families) || [];
  app.globalData.families = families;

  const serverCid = loginResp.currentFamilyId || null;
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

async function completeLoginFlow(userInfo, options) {
  const sessionKey = `${userInfo.nickName}|${userInfo.avatarUrl}`;
  if (_loginInflight && _loginInflightKey === sessionKey) {
    return _loginInflight;
  }

  _loginInflightKey = sessionKey;
  _loginInflight = runCompleteLoginFlow(userInfo, options).finally(() => {
    if (_loginInflightKey === sessionKey) {
      _loginInflight = null;
      _loginInflightKey = "";
    }
  });

  return _loginInflight;
}

async function applyServerSession(restoreResp) {
  const userInfo = restoreResp && restoreResp.userInfo;
  if (!userInfo || !userInfo.nickName || !userInfo.avatarUrl) {
    return { ok: false, currentFamilyId: null, error: null };
  }

  const { nickName, avatarUrl } = userInfo;
  wx.setStorageSync(SESSION_KEY, { nickName, avatarUrl });

  const app = getApp();
  app.globalData.userInfo = { nickName, avatarUrl };
  if (restoreResp.openid) app.globalData.openid = restoreResp.openid;

  const familiesResp = await cloud
    .callFunction("familyFunctions", { type: "getMyFamilies" })
    .catch(() => null);

  const families = (familiesResp && familiesResp.families) || [];
  app.globalData.families = families;

  const serverCid = restoreResp.currentFamilyId || null;
  if (serverCid && families.some((f) => f._id === serverCid)) {
    app.globalData.currentFamilyId = serverCid;
  } else {
    app.globalData.currentFamilyId = (families[0] && families[0]._id) || null;
  }

  return {
    ok: true,
    currentFamilyId: app.globalData.currentFamilyId || null,
    error: null,
  };
}

async function tryRestoreFromServer() {
  await ensureWxLogin();
  const resp = await cloud.callFunction("familyFunctions", { type: "restoreSession" });
  if (!resp || !resp.restored || !resp.userInfo) {
    return { ok: false, currentFamilyId: null, error: null };
  }
  const { nickName, avatarUrl } = resp.userInfo;
  if (isPlaceholderNickName(nickName) || isWeChatDefaultAvatarUrl(avatarUrl)) {
    return { ok: false, currentFamilyId: null, error: null };
  }
  return applyServerSession(resp);
}

async function trySilentLogin() {
  const app = getApp();
  if (isLoggedIn()) {
    return {
      ok: true,
      currentFamilyId: (app.globalData && app.globalData.currentFamilyId) || null,
      error: null,
    };
  }

  if (_silentLoginInflight) return _silentLoginInflight;

  _silentLoginInflight = (async () => {
    try {
      const restored = await tryRestoreFromServer();
      if (restored.ok) return restored;

      const local = getValidSessionOrNull();
      if (local) {
        try {
          const { currentFamilyId } = await completeLoginFlow(local, { silent: true });
          return { ok: true, currentFamilyId: currentFamilyId || null, error: null };
        } catch (localErr) {
          clearAuthState({ keepSession: false });
          return { ok: false, currentFamilyId: null, error: formatLoginError(localErr) };
        }
      }
      return { ok: false, currentFamilyId: null, error: null };
    } catch (e) {
      return { ok: false, currentFamilyId: null, error: formatLoginError(e) };
    } finally {
      _silentLoginInflight = null;
    }
  })();

  return _silentLoginInflight;
}

async function bootstrapSilentLogin() {
  return trySilentLogin();
}

async function requireLoggedIn(options) {
  const opt = options || {};
  if (isLoggedIn()) return { ok: true };

  const silent = await trySilentLogin();
  if (silent.ok) return { ok: true };

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
  clearAuthState,
  formatLoginError,
  ensureWxLogin,
  completeLoginFlow,
  tryRestoreFromServer,
  trySilentLogin,
  bootstrapSilentLogin,
  isLoggedIn,
  requireLoggedIn,
  requireLoggedInOrBack,
};
