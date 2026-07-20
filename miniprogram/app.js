// app.js
const share = require("./utils/share.js");

function mergeLaunchQuery(launch, options) {
  return Object.assign({}, (launch && launch.query) || {}, (options && options.query) || {});
}

function isEntryFromInviteLaunch(launch, options) {
  const orderInvite = require("./utils/orderInvite.js");
  const invite = require("./utils/invite.js");
  const q = mergeLaunchQuery(launch, options);
  return !!(
    orderInvite.parseTokenFromOptions(q) || invite.hasExplicitInviteOptions(q)
  );
}

const _Page = Page;
Page = function (pageConfig) {
  share.enhancePageConfig(pageConfig);
  return _Page(pageConfig);
};

App({
  onLaunch: function (options) {
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloud1-6gw490q203c9a832",
      // 登录后用户信息与当前家庭上下文（由业务云函数返回并填充）
      userInfo: null,
      currentFamilyId: null,
      families: [],
      /** 扫码/分享落地：登录完成后回到分享页用 */
      pendingShareToken: null,
      /** 家庭邀请：登录后自动加入 */
      pendingInviteCode: null,
      /** 点菜单邀请：登录后加入家庭并进入点菜页 */
      pendingOrderInviteToken: null,
      /** 当前页预生成的点餐邀请分享（onShareAppMessage 同步读） */
      orderInviteShare: null,
      /** 子页变更数据后标记，首页 onShow 再刷新 */
      homeDirty: false,
      /** 本次冷启动是否由分享/邀请链接进入 */
      entryFromInvite: false,
      /** 点餐邀请已成功接受，避免回首页时重复跳转点菜页 */
      orderInviteHandled: false,
      /** 主入口启动页判定结果：guest | needFamily | ok */
      mainEntryBoot: null,
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      const env = this.globalData.env;
      // env 为空时允许不传，避免“环境未找到”导致全局报错。
      const initOptions = {
        traceUser: true,
      };
      if (env) {
        initOptions.env = env;
      }
      wx.cloud.init(initOptions);
    }

    const orderInvite = require("./utils/orderInvite.js");
    const invite = require("./utils/invite.js");
    const launch =
      typeof wx.getLaunchOptionsSync === "function" ? wx.getLaunchOptionsSync() : {};
    const entryFromInvite = isEntryFromInviteLaunch(launch, options);
    this.globalData.entryFromInvite = entryFromInvite;
    if (!entryFromInvite) {
      orderInvite.clearPendingOrderInviteToken();
      invite.clearPendingInviteCode();
    }

    this._captureInviteLaunchOptions(options);
    if (entryFromInvite) {
      this._rerouteOrderInviteIfNeeded(options);
    }
    // 静默登录由首页统一调度，避免与访客首屏竞态
  },

  /** 分享卡片带 token 但落到了首页等页面时，纠偏到邀请落地页 */
  _rerouteOrderInviteIfNeeded(options) {
    try {
      const orderInvite = require("./utils/orderInvite.js");
      const launch =
        typeof wx.getLaunchOptionsSync === "function" ? wx.getLaunchOptionsSync() : {};
      const merged = mergeLaunchQuery(launch, options);
      const token = orderInvite.parseTokenFromOptions(merged);
      if (!token) return;

      const rawPath = String((launch && launch.path) || "").replace(/^\//, "");
      if (rawPath.indexOf("pages/order/invite/index") === 0) return;

      wx.reLaunch({ url: orderInvite.buildOrderInvitePath(token) });
    } catch (e) {
      /* ignore */
    }
  },

  /**
   * 分享/扫码打开时尽早记住邀请参数（避免仅落到首页访客态）
   * @param {boolean} useLaunchQuery 为 false 时仅用本次切入参数，避免 onShow 用冷启动 query 写回已清除的邀请码
   */
  _captureInviteLaunchOptions(options, useLaunchQuery = true) {
    try {
      const orderInvite = require("./utils/orderInvite.js");
      const invite = require("./utils/invite.js");
      const launch = typeof wx.getLaunchOptionsSync === "function" ? wx.getLaunchOptionsSync() : {};
      const merged = useLaunchQuery
        ? mergeLaunchQuery(launch, options)
        : Object.assign({}, (options && options.query) || {});
      const orderToken = orderInvite.parseTokenFromOptions(merged);
      const inviteCode = invite.parseInviteCodeFromOptions(merged);
      if (!orderToken && !inviteCode) return;
      orderInvite.captureOrderInviteFromLaunchOptions(merged);
      invite.captureInviteFromLaunchOptions(merged);
    } catch (e) {
      /* ignore */
    }
  },

  onShow(options) {
    const q = Object.assign({}, (options && options.query) || {});
    const orderInvite = require("./utils/orderInvite.js");
    const invite = require("./utils/invite.js");
    if (
      orderInvite.parseTokenFromOptions(q) ||
      invite.hasExplicitInviteOptions(q)
    ) {
      this._captureInviteLaunchOptions(options, false);
    }
  },
});
