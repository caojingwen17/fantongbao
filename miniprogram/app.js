// app.js
const share = require("./utils/share.js");

const _Page = Page;
Page = function (pageConfig) {
  share.enhancePageConfig(pageConfig);
  return _Page(pageConfig);
};

App({
  onLaunch: function () {
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
      /** 子页变更数据后标记，首页 onShow 再刷新 */
      homeDirty: false,
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

    const auth = require("./utils/auth.js");
    auth.bootstrapSilentLogin().catch(() => {});
  },
});
