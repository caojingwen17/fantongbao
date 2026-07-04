const auth = require("../../../utils/auth");
const invite = require("../../../utils/invite");
const share = require("../../../utils/share");

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

    await this.tryAutoJoin();
  },

  async onShow() {
    if (this._joinHandled || this.data.loading || this.data.errMsg || this.data.joined) return;
    if (!this.data.needLogin) return;
    const silent = await auth.trySilentLogin();
    if (silent.ok) {
      await this.tryAutoJoin();
    }
  },

  async tryAutoJoin() {
    if (this._joinHandled || this.data.joining || this.data.joined) return;
    if (!auth.isLoggedIn()) {
      const silent = await auth.trySilentLogin();
      if (!silent.ok) {
        this.setData({ needLogin: true });
        return;
      }
    }

    this.setData({ joining: true, needLogin: false });
    wx.showLoading({ title: "加入家庭中…", mask: true });
    try {
      await invite.joinFamilyByInviteCode(this.data.inviteCode);
      this._joinHandled = true;
      invite.clearPendingInviteCode();
      wx.hideLoading();
      wx.showToast({ title: "已加入家庭", icon: "success", duration: 1500 });
      wx.reLaunch({ url: "/pages/index/index?onboard=1" });
    } catch (e) {
      this.setData({ joining: false, needLogin: !auth.isLoggedIn() });
      wx.hideLoading();
    }
  },

  onGoLogin() {
    invite.rememberPendingInviteCode(this.data.inviteCode);
    wx.navigateTo({ url: "/pages/login/login/index" });
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
    };
  },
});
