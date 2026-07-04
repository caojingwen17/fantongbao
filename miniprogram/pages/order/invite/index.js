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

    await this.tryAutoAccept();
  },

  async onShow() {
    if (this._acceptHandled || this.data.loading || this.data.errMsg || this.data.joined) return;
    if (!this.data.needLogin) return;
    const silent = await auth.trySilentLogin();
    if (silent.ok) {
      await this.tryAutoAccept();
    }
  },

  async tryAutoAccept() {
    if (this._acceptHandled || this.data.joining || this.data.joined) return;

    if (!auth.isLoggedIn()) {
      const silent = await auth.trySilentLogin();
      if (!silent.ok) {
        this.setData({ joining: false, needLogin: true, errMsg: "" });
        orderInvite.rememberPendingOrderInviteToken(this.data.token);
        return;
      }
    }

    this.setData({ joining: true, needLogin: false, errMsg: "" });
    wx.showLoading({ title: "加入中…", mask: true });
    try {
      const { orderId } = await orderInvite.acceptOrderInvite(this.data.token);
      this._acceptHandled = true;
      orderInvite.clearPendingOrderInviteToken();
      wx.showToast({ title: "已加入，开始点菜", icon: "success", duration: 1500 });
      wx.reLaunch({ url: `/pages/order/pick/index?orderId=${orderId}` });
    } catch (e) {
      const msg = (e && e.message) || "加入失败，请重试";
      this.setData({
        joining: false,
        needLogin: !auth.isLoggedIn(),
        errMsg: auth.isLoggedIn() ? msg : "",
      });
      if (auth.isLoggedIn()) {
        wx.showToast({ title: msg, icon: "none" });
      } else {
        orderInvite.rememberPendingOrderInviteToken(this.data.token);
        this.setData({ needLogin: true });
      }
    } finally {
      wx.hideLoading();
      if (!this._acceptHandled) {
        this.setData({ joining: false });
      }
    }
  },

  onGoLogin() {
    orderInvite.rememberPendingOrderInviteToken(this.data.token);
    wx.navigateTo({ url: "/pages/login/login/index" });
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
