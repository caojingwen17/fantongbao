const cloud = require("./cloud");

const STORAGE_FAMILY_INVITE = "fantongbao_pending_family_invite_code";

function parseInviteCodeFromOptions(options) {
  let raw = options && options.scene != null ? String(options.scene) : "";
  if (raw) {
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      /* 已是明文 */
    }
    const m = raw.match(/^c=([A-Za-z0-9]+)$/);
    if (m) return m[1];
  }
  if (options && options.inviteCode) return String(options.inviteCode).trim();
  return "";
}

/** 是否带有明确的分享/邀请参数（勿用泛化 query.code，易与系统字段冲突） */
function hasExplicitInviteOptions(options) {
  return !!parseInviteCodeFromOptions(options || {});
}

function rememberPendingInviteCode(code) {
  const c = String(code || "").trim();
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pendingInviteCode = c || null;
    }
  } catch (e) {
    /* onLaunch 早期可能尚无 getApp */
  }
  try {
    if (c) wx.setStorageSync(STORAGE_FAMILY_INVITE, c);
    else wx.removeStorageSync(STORAGE_FAMILY_INVITE);
  } catch (e) {
    /* ignore */
  }
  return c;
}

function getPendingInviteCode() {
  try {
    const app = getApp();
    const mem = app && app.globalData && app.globalData.pendingInviteCode;
    if (mem) return String(mem).trim();
  } catch (e) {
    /* ignore */
  }
  try {
    return String(wx.getStorageSync(STORAGE_FAMILY_INVITE) || "").trim();
  } catch (e) {
    return "";
  }
}

function clearPendingInviteCode() {
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.pendingInviteCode = null;
    }
  } catch (e) {
    /* ignore */
  }
  try {
    wx.removeStorageSync(STORAGE_FAMILY_INVITE);
  } catch (e) {
    /* ignore */
  }
}

function buildFamilyInvitePath(inviteCode) {
  const c = String(inviteCode || "").trim();
  if (!c) return "/pages/index/index";
  return `/pages/family/invite/index?inviteCode=${encodeURIComponent(c)}`;
}

async function previewFamilyInvite(inviteCode) {
  const code = String(inviteCode || "").trim();
  if (!code) throw new Error("邀请链接无效");
  const res = await cloud.callFunction("familyFunctions", {
    type: "previewFamilyInvite",
    inviteCode: code,
  });
  if (!res || res.success === false) {
    throw new Error((res && res.errMsg) || "邀请链接无效");
  }
  return res;
}

async function joinFamilyByInviteCode(inviteCode) {
  const code = String(inviteCode || "").trim();
  if (!code) throw new Error("邀请链接无效");

  const resp = await cloud.callFunctionWithErrorToast("familyFunctions", {
    type: "joinFamily",
    inviteCode: code,
  });

  const app = getApp();
  if (resp && resp.familyId) {
    app.globalData.currentFamilyId = resp.familyId;
  }

  const familiesResp = await cloud
    .callFunction("familyFunctions", { type: "getMyFamilies" })
    .catch(() => null);
  app.globalData.families = (familiesResp && familiesResp.families) || [];

  clearPendingInviteCode();
  return resp;
}

/** 从启动参数解析并记住家庭邀请（分享/扫码落地） */
function captureInviteFromLaunchOptions(options) {
  const code = parseInviteCodeFromOptions(options || {});
  if (!code) return "";
  rememberPendingInviteCode(code);
  return code;
}

module.exports = {
  parseInviteCodeFromOptions,
  hasExplicitInviteOptions,
  rememberPendingInviteCode,
  getPendingInviteCode,
  clearPendingInviteCode,
  buildFamilyInvitePath,
  previewFamilyInvite,
  joinFamilyByInviteCode,
  captureInviteFromLaunchOptions,
};
