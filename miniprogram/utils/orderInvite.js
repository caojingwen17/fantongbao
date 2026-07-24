const cloud = require("./cloud");
const invite = require("./invite");

const STORAGE_ORDER_INVITE = "fantongbao_pending_order_invite_token";

function parseTokenFromOptions(options) {
  let raw = options && options.scene != null ? String(options.scene) : "";
  if (raw) {
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      /* 已是明文 */
    }
    const m = raw.match(/^o=([a-z0-9]+)$/i);
    if (m) return m[1];
  }
  if (options && options.token) return String(options.token).trim();
  if (options && options.orderInviteToken) return String(options.orderInviteToken).trim();
  return "";
}

function rememberPendingOrderInviteToken(token) {
  const t = String(token || "").trim();
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pendingOrderInviteToken = t || null;
    }
  } catch (e) {
    /* ignore */
  }
  try {
    if (t) wx.setStorageSync(STORAGE_ORDER_INVITE, t);
    else wx.removeStorageSync(STORAGE_ORDER_INVITE);
  } catch (e) {
    /* ignore */
  }
  return t;
}

function getPendingOrderInviteToken() {
  try {
    const app = getApp();
    const mem = app && app.globalData && app.globalData.pendingOrderInviteToken;
    if (mem) return String(mem).trim();
  } catch (e) {
    /* ignore */
  }
  try {
    return String(wx.getStorageSync(STORAGE_ORDER_INVITE) || "").trim();
  } catch (e) {
    return "";
  }
}

function clearPendingOrderInviteToken() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pendingOrderInviteToken = null;
    }
  } catch (e) {
    /* ignore */
  }
  try {
    wx.removeStorageSync(STORAGE_ORDER_INVITE);
  } catch (e) {
    /* ignore */
  }
}

/** 邀请已成功接受：清除残留 token，并阻止首页再次消费冷启动 query */
function markOrderInviteHandled() {
  clearPendingOrderInviteToken();
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.orderInviteHandled = true;
      app.globalData.entryFromInvite = false;
    }
  } catch (e) {
    /* ignore */
  }
}

function isOrderInviteHandled() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.orderInviteHandled);
  } catch (e) {
    return false;
  }
}

function buildOrderInvitePath(token) {
  const t = String(token || "").trim();
  if (!t) return "/pages/order/invite/index";
  return `/pages/order/invite/index?token=${encodeURIComponent(t)}`;
}

async function previewOrderInvite(token) {
  const t = String(token || "").trim();
  if (!t) throw new Error("邀请链接无效");
  const res = await cloud.callFunction("orderFunctions", {
    type: "getOrderInvitePreview",
    token: t,
  });
  if (!res || res.success === false) {
    throw new Error((res && res.errMsg) || "邀请链接无效");
  }
  return res.preview || {};
}

async function acceptOrderInvite(token) {
  const auth = require("./auth");
  if (!auth.isLoggedIn()) {
    const silent = await auth.trySilentLogin();
    if (!silent.ok) throw new Error("请先登录并设置头像昵称");
  }

  const preview = await previewOrderInvite(token);
  const inviteCode = preview.inviteCode;
  const orderId = preview.orderId;
  const familyId = preview.familyId;
  if (!inviteCode || !orderId) throw new Error("邀请信息不完整");

  await invite.joinFamilyByInviteCode(inviteCode);

  const app = getApp();
  if (familyId) {
    await cloud.callFunction("familyFunctions", { type: "switchFamily", familyId }).catch(() => {});
    app.globalData.currentFamilyId = familyId;
  }

  markOrderInviteHandled();
  return { orderId, familyId, preview };
}

/** 从启动参数解析并记住点餐邀请 */
function captureOrderInviteFromLaunchOptions(options) {
  if (isOrderInviteHandled()) return "";
  const token = parseTokenFromOptions(options || {});
  if (!token) return "";
  rememberPendingOrderInviteToken(token);
  return token;
}

/** 若存在待处理邀请，跳转到对应落地页 */
function redirectToPendingInviteIfAny() {
  const inviteCode = invite.getPendingInviteCode();
  if (inviteCode) {
    try {
      const auth = require("./auth");
      const app = getApp();
      if (auth.isLoggedIn() && app.globalData && app.globalData.currentFamilyId) {
        invite.clearPendingInviteCode();
        return false;
      }
    } catch (e) {
      /* ignore */
    }
    wx.redirectTo({ url: invite.buildFamilyInvitePath(inviteCode) });
    return true;
  }
  return false;
}

/** 首页/落地：统一进入点餐邀请落地页，由用户主动确认后加入（不再静默加家庭） */
async function handlePendingOrderInviteOnEntry() {
  let entryFromInvite = false;
  try {
    const app = getApp();
    entryFromInvite = !!(app.globalData && app.globalData.entryFromInvite);
  } catch (e) {
    /* ignore */
  }
  if (!entryFromInvite || isOrderInviteHandled()) return false;

  const token = getPendingOrderInviteToken();
  if (!token) return false;

  wx.redirectTo({ url: buildOrderInvitePath(token) });
  return true;
}

module.exports = {
  parseTokenFromOptions,
  rememberPendingOrderInviteToken,
  getPendingOrderInviteToken,
  clearPendingOrderInviteToken,
  markOrderInviteHandled,
  isOrderInviteHandled,
  buildOrderInvitePath,
  previewOrderInvite,
  acceptOrderInvite,
  captureOrderInviteFromLaunchOptions,
  redirectToPendingInviteIfAny,
  handlePendingOrderInviteOnEntry,
};
