const auth = require("../../../utils/auth");
const invite = require("../../../utils/invite");
const share = require("../../../utils/share");
const ui = require("../../../utils/ui");

Page({
  data: {
    loading: true,
    joining: false,
    errMsg: "",
    inviteCode: "",
    familyName: "",
    needLogin: false,
    joined: false,
  },

  async onLoad(options) {
    const app = getApp();
    let code = invite.parseInviteCodeFromOptions(options);
    if (!code && app.globalData && app.globalData.entryFromInvite) {
      code = invite.getPendingInviteCode();
    }
    if (!code) {
      this.setData({
        loading: false,
        errMsg: "无效的邀请链接",
      });
      return;
    }

    invite.rememberPendingInviteCode(code);
    this.setData({ inviteCode: code });

    // 预览与静默登录互不依赖：登录态探测并行发出，只更新按钮文案
    this.refreshLoginState();

    try {
      const preview = await invite.previewFamilyInvite(code);
      this.setData({
        loading: false,
        familyName: preview.familyName || "家庭",
      });
    } catch (e) {
      invite.clearPendingInviteCode();
      this.setData({
        loading: false,
        errMsg: (e && e.message) || "邀请链接无效",
      });
      return;
    }
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

  /** 用户主动点击「加入家庭」后才执行加入 */
  async onConfirmJoin() {
    if (this._joinHandled || this.data.joining || this.data.joined) return;

    if (!auth.isLoggedIn()) {
      const silent = await auth.trySilentLogin();
      if (!silent.ok) {
        invite.rememberPendingInviteCode(this.data.inviteCode);
        wx.navigateTo({ url: "/pages/login/login/index" });
        return;
      }
    }

    this.setData({ joining: true, needLogin: false });
    ui.showLoading("加入家庭中…", true);
    try {
      await invite.joinFamilyByInviteCode(this.data.inviteCode);
      this._joinHandled = true;
      invite.clearPendingInviteCode();
      ui.hideLoading();
      this.setData({ joined: true });
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/index/index?onboard=1" });
      }, 600);
    } catch (e) {
      ui.hideLoading();
      this.setData({ joining: false, needLogin: !auth.isLoggedIn() });
      wx.showToast({
        title: (e && e.message) || "加入失败，请重试",
        icon: "none",
      });
    }
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  onShareAppMessage() {
    const { inviteCode, familyName } = this.data;
    if (!inviteCode) return share.defaultShareAppMessage();
    const name = familyName || "家庭";
    return {
      title: `邀请你加入「${name}」一起玩饭桶宝`,
      path: invite.buildFamilyInvitePath(inviteCode),
      imageUrl: share.FAMILY_INVITE_SHARE_IMAGE,
    };
  },
});
