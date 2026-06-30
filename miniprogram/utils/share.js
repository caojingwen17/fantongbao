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

function defaultShareAppMessage() {
  return {
    title: "饭桶宝 · 家庭菜谱协作",
    path: "/pages/index/index",
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
  enableShareMenu,
  defaultShareAppMessage,
  defaultShareTimeline,
  getEnvVersion,
  buildRecipeSharePath,
  prepareRecipeShareToken,
  enhancePageConfig,
};
