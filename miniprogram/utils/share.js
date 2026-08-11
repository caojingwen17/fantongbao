/**
 * 小程序转发分享：未实现 onShareAppMessage 时，右上角「转发」为灰色。
 */

function enableShareMenu() {
  if (typeof wx.showShareMenu !== "function") return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ["shareAppMessage", "shareTimeline"],
  });
}

const ORDER_INVITE_SHARE_TITLE = "邀请您一起点菜";
const BRAND_SHARE_IMAGE = "/images/share/share-brand.png";
const ORDER_INVITE_SHARE_IMAGE = "/images/share/share-order-invite.png";
const FAMILY_INVITE_SHARE_IMAGE = "/images/share/share-family-invite.png";

function defaultShareAppMessage() {
  return {
    title: "饭桶宝 · 家庭菜谱协作",
    path: "/pages/index/index",
    imageUrl: BRAND_SHARE_IMAGE,
  };
}

function defaultShareTimeline() {
  return {
    title: "饭桶宝 · 家庭菜谱协作",
    query: "",
  };
}

function getEnvVersion() {
  try {
    const info = wx.getAccountInfoSync();
    const v = info && info.miniProgram && info.miniProgram.envVersion;
    if (v === "develop" || v === "trial" || v === "release") return v;
  } catch (e) {
    /* ignore */
  }
  return "release";
}

function buildRecipeSharePath(token) {
  const t = String(token || "").trim();
  if (!t) return "/pages/index/index";
  return `/pages/recipe/share/index?token=${encodeURIComponent(t)}`;
}

function buildFamilyInvitePath(inviteCode) {
  const invite = require("./invite");
  return invite.buildFamilyInvitePath(inviteCode);
}

function buildOrderInvitePath(token) {
  const orderInvite = require("./orderInvite");
  return orderInvite.buildOrderInvitePath(token);
}

async function prepareOrderInviteToken(cloud, orderId) {
  const prep = await cloud.callFunction("orderFunctions", {
    type: "prepareOrderInvite",
    orderId,
  });
  if (!prep || prep.success === false || !prep.token) {
    const msg = (prep && (prep.errMsg || prep.message)) || "准备邀请失败";
    throw new Error(msg);
  }
  return prep;
}

/** 预生成点餐邀请分享信息，写入 page.data 与 globalData（供 onShareAppMessage 同步读取） */
async function prepareOrderInviteShareOnPage(page, cloud, orderId) {
  const prep = await prepareOrderInviteToken(cloud, orderId);
  const token = prep.token;
  const path = buildOrderInvitePath(token);
  const payload = { title: ORDER_INVITE_SHARE_TITLE, path, token, imageUrl: ORDER_INVITE_SHARE_IMAGE };
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.orderInviteShare = payload;
    }
  } catch (e) {
    /* ignore */
  }
  if (page && typeof page.setData === "function") {
    page.setData({ shareToken: token, sharePath: path, shareReady: true });
  }
  return payload;
}

/** onShareAppMessage 内同步取分享文案（勿用 this._xxx 或 promise，真机不可靠） */
function getOrderInviteShareFromPage(page) {
  const data = (page && page.data) || {};
  let token = String(data.shareToken || "").trim();
  if (!token) {
    try {
      const app = getApp();
      const cached = app && app.globalData && app.globalData.orderInviteShare;
      if (cached && cached.token) token = String(cached.token).trim();
    } catch (e) {
      /* ignore */
    }
  }
  if (!token) return null;
  return {
    title: ORDER_INVITE_SHARE_TITLE,
    path: buildOrderInvitePath(token),
    imageUrl: ORDER_INVITE_SHARE_IMAGE,
  };
}

async function prepareRecipeShareToken(cloud, recipeId) {
  const prep = await cloud.callFunction("recipeFunctions", {
    type: "prepareRecipeShare",
    recipeId,
    envVersion: getEnvVersion(),
  });
  if (!prep || prep.success === false || !prep.token) {
    const msg = (prep && (prep.errMsg || prep.message)) || "准备分享失败";
    throw new Error(msg);
  }
  return prep;
}

/** 为 Page 配置补全默认分享（已有 onShareAppMessage 的页面不会被覆盖） */
function enhancePageConfig(pageConfig) {
  if (!pageConfig.onShareAppMessage) {
    pageConfig.onShareAppMessage = defaultShareAppMessage;
  }
  if (!pageConfig.onShareTimeline) {
    pageConfig.onShareTimeline = defaultShareTimeline;
  }

  const origOnLoad = pageConfig.onLoad;
  pageConfig.onLoad = function (...args) {
    enableShareMenu();
    if (origOnLoad) return origOnLoad.apply(this, args);
  };

  const origOnShow = pageConfig.onShow;
  pageConfig.onShow = function (...args) {
    enableShareMenu();
    if (origOnShow) return origOnShow.apply(this, args);
  };
}

module.exports = {
  ORDER_INVITE_SHARE_TITLE,
  FAMILY_INVITE_SHARE_IMAGE,
  enableShareMenu,
  defaultShareAppMessage,
  defaultShareTimeline,
  getEnvVersion,
  buildRecipeSharePath,
  buildFamilyInvitePath,
  buildOrderInvitePath,
  prepareOrderInviteToken,
  prepareOrderInviteShareOnPage,
  getOrderInviteShareFromPage,
  prepareRecipeShareToken,
  enhancePageConfig,
};
