const auth = require("../../../utils/auth");
const haptics = require("../../../utils/haptics");
const ui = require("../../../utils/ui");

const { isPlaceholderNickName, formatLoginError, completeLoginFlow } = auth;

Page({
  data: {
    isLoading: false,
    checkingSession: true,
    nickName: "",
    avatarTempPath: "",
    avatarPreview: "",
    loginError: "",
  },

  onLoad() {
    const pages = getCurrentPages();
    const fromOtherPage = pages.length > 1;
    let entryFromInvite = false;
    let hasPendingInvite = false;
    try {
      const app = getApp();
      entryFromInvite = !!(app.globalData && app.globalData.entryFromInvite);
      const orderInvite = require("../../../utils/orderInvite");
      const invite = require("../../../utils/invite");
      hasPendingInvite = !!(
        orderInvite.getPendingOrderInviteToken() || invite.getPendingInviteCode()
      );
    } catch (e) {
      /* ignore */
    }

    // 非用户主动进入（如恢复上次页面栈到登录页）：回启动页，不强制登录
    if (!fromOtherPage && !entryFromInvite && !hasPendingInvite) {
      wx.reLaunch({ url: "/pages/launch/index" });
      return;
    }

    this.trySilentLogin();
  },

  async trySilentLogin() {
    const r = await auth.trySilentLogin();
    if (r.ok) {
      const app = getApp();
      await this.afterLoginNavigate({
        currentFamilyId: (app.globalData && app.globalData.currentFamilyId) || null,
      });
      return;
    }

    let loginError = r.error || "";
    if (!loginError) {
      try {
        const raw = wx.getStorageSync(auth.SESSION_KEY);
        if (raw && raw.nickName) {
          loginError = "本地登录信息已失效，请重新选择头像并填写昵称";
        }
      } catch (e) {
        /* ignore */
      }
    }
    this.setData({ checkingSession: false, loginError });
  },

  onChooseAvatar(e) {
    const path = e.detail && e.detail.avatarUrl ? e.detail.avatarUrl : "";
    if (!path) return;
    this._sessionAvatarUrl = "";
    this.setData({
      avatarTempPath: path,
      avatarPreview: path,
      loginError: "",
    });
  },

  onNickInput(e) {
    this.setData({ nickName: (e.detail && e.detail.value) || "" });
  },

  async onSubmitLogin() {
    const nickName = String(this.data.nickName || "").trim();
    if (!nickName) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }
    if (isPlaceholderNickName(nickName)) {
      wx.showToast({ title: "请填写真实昵称，不能使用「微信用户」", icon: "none" });
      return;
    }

    let avatarUrl = "";
    if (this.data.avatarTempPath) {
      if (this.data.isLoading) return;
      this.setData({ isLoading: true, loginError: "" });
      try {
        ui.showLoading("上传头像…", true);
        const cloudPath = `avatars/login/${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
        const up = await wx.cloud.uploadFile({
          cloudPath,
          filePath: this.data.avatarTempPath,
        });
        ui.hideLoading();
        avatarUrl = up && up.fileID ? up.fileID : "";
        if (!avatarUrl) {
          wx.showToast({ title: "头像上传失败", icon: "none" });
          return;
        }
      } catch (uploadErr) {
        ui.hideLoading();
        const msg = formatLoginError(uploadErr);
        this.setData({ loginError: msg });
        wx.showToast({ title: msg, icon: "none", duration: 3500 });
        return;
      } finally {
        this.setData({ isLoading: false });
      }
    } else if (this._sessionAvatarUrl) {
      avatarUrl = this._sessionAvatarUrl;
    } else {
      wx.showToast({ title: "请选择头像", icon: "none" });
      return;
    }

    if (this.data.isLoading) return;
    this.setData({ isLoading: true, loginError: "" });
    try {
      const ctx = await completeLoginFlow({
        nickName,
        avatarUrl,
      });
      await this.afterLoginNavigate(ctx);
    } catch (err) {
      const msg = formatLoginError(err);
      console.error("[login] manual login failed:", err);
      auth.clearAuthState({ keepSession: true });
      this._sessionAvatarUrl = avatarUrl;
      this.setData({ loginError: msg });
      wx.showToast({ title: msg, icon: "none", duration: 3500 });
    } finally {
      this.setData({ isLoading: false, checkingSession: false });
    }
  },

  async afterLoginNavigate(ctx) {
    haptics.success();
    wx.showToast({ title: "登录成功", icon: "none" });

    const app = getApp();
    const orderInvite = require("../../../utils/orderInvite");
    const invite = require("../../../utils/invite");

    if (app.globalData && app.globalData.pendingShareToken) {
      wx.reLaunch({ url: "/pages/recipe/share/index" });
      return;
    }

    const orderToken = orderInvite.getPendingOrderInviteToken();
    if (orderToken) {
      // 回到邀请落地页，由用户主动确认加入
      wx.reLaunch({ url: orderInvite.buildOrderInvitePath(orderToken) });
      return;
    }

    const inviteCode = invite.getPendingInviteCode();
    if (inviteCode) {
      wx.reLaunch({ url: invite.buildFamilyInvitePath(inviteCode) });
      return;
    }

    wx.reLaunch({ url: "/pages/index/index" });
  },
});
