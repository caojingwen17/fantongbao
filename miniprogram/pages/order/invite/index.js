const auth = require("../../../utils/auth");
const orderInvite = require("../../../utils/orderInvite");
const share = require("../../../utils/share");

Page({
  data: {
    loading: true,
    joining: false,
    errMsg: "",
    token: "",
    orderName: "",
    familyName: "",
    needLogin: false,
    joined: false,
  },

  async onLoad(options) {
    let token = orderInvite.parseTokenFromOptions(options);
    if (!token) {
      this.setData({
        loading: false,
        errMsg: "无效的邀请链接",
      });
      return;
    }

    orderInvite.rememberPendingOrderInviteToken(token);
    this.setData({ token });

    try {
      const preview = await orderInvite.previewOrderInvite(token);
      this.setData({
        loading: false,
        orderName: preview.orderName || "点菜单",
        familyName: preview.familyName || "家庭",
      });
    } catch (e) {
      orderInvite.clearPendingOrderInviteToken();
      this.setData({
        loading: false,
        errMsg: (e && e.message) || "邀请链接无效",
      });
      return;
    }

    // 静默登录成功后只更新按钮文案，不自动加入；由用户主动确认
    this.refreshLoginState();
  },

  async onShow() {
    if (this.data.loading || this.data.errMsg || this.data.joined) return;
    this.refreshLoginState();
  },

  async refreshLoginState() {
    if (auth.isLoggedIn()) {
      if (this.data.needLogin) this.setData({ needLogin: false });
      return;
    }
    const silent = await auth.trySilentLogin();
    this.setData({ needLogin: !silent.ok });
  },

  /** 用户主动点击「加入并开始点菜」后才执行加入家庭 + 进入点菜页 */
  async onConfirmJoin() {
    if (this._acceptHandled || this.data.joining || this.data.joined) return;

    if (!auth.isLoggedIn()) {
      const silent = await auth.trySilentLogin();
      if (!silent.ok) {
        orderInvite.rememberPendingOrderInviteToken(this.data.token);
        wx.navigateTo({ url: "/pages/login/login/index" });
        return;
      }
    }

    this.setData({ joining: true, needLogin: false });
    try {
      const { orderId } = await orderInvite.acceptOrderInvite(this.data.token);
      this._acceptHandled = true;
      orderInvite.clearPendingOrderInviteToken();
      this.setData({ joined: true });
      setTimeout(() => {
        wx.reLaunch({ url: `/pages/order/pick/index?orderId=${orderId}` });
      }, 600);
    } catch (e) {
      const msg = (e && e.message) || "加入失败，请重试";
      this.setData({
        joining: false,
        needLogin: !auth.isLoggedIn(),
      });
      wx.showToast({ title: msg, icon: "none" });
    }
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  onShareAppMessage() {
    const { token } = this.data;
    if (!token) return share.defaultShareAppMessage();
    return {
      title: share.ORDER_INVITE_SHARE_TITLE,
      path: orderInvite.buildOrderInvitePath(token),
    };
  },
});
