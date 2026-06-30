const auth = require("../../../utils/auth");
const cloudDisplay = require("../../../utils/cloudDisplay");

const { getValidSessionOrNull, completeLoginFlow, isPlaceholderNickName, formatLoginError } =
  auth;

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
    this.trySilentLogin();
  },

  async resolveAvatarPreview(avatarUrl) {
    if (!avatarUrl) return "";
    if (avatarUrl.indexOf("cloud://") !== 0) return avatarUrl;
    try {
      const map = await cloudDisplay.resolveBatch([avatarUrl]);
      return (map && map[avatarUrl]) || avatarUrl;
    } catch (e) {
      return avatarUrl;
    }
  },

  async trySilentLogin() {
    const s = getValidSessionOrNull();
    if (!s) {
      let loginError = "";
      try {
        const raw = wx.getStorageSync(auth.SESSION_KEY);
        if (raw && raw.nickName) {
          loginError = "本地登录信息已失效，请重新选择头像并填写昵称";
        }
      } catch (e) {
        /* ignore */
      }
      this.setData({ checkingSession: false, loginError });
      return;
    }

    this.setData({ isLoading: true, loginError: "" });
    try {
      const ctx = await completeLoginFlow(s, { silent: true });
      await this.afterLoginNavigate(ctx);
    } catch (e) {
      auth.clearAuthState({ keepSession: true });
      const msg = formatLoginError(e);
      console.error("[login] silent login failed:", e);
      this._sessionAvatarUrl = s.avatarUrl;
      const avatarPreview = await this.resolveAvatarPreview(s.avatarUrl);
      this.setData({
        checkingSession: false,
        isLoading: false,
        loginError: msg,
        nickName: s.nickName,
        avatarPreview,
      });
    }
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
        wx.showLoading({ title: "上传头像…", mask: true });
        const cloudPath = `avatars/login/${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
        const up = await wx.cloud.uploadFile({
          cloudPath,
          filePath: this.data.avatarTempPath,
        });
        wx.hideLoading();
        avatarUrl = up && up.fileID ? up.fileID : "";
        if (!avatarUrl) {
          wx.showToast({ title: "头像上传失败", icon: "none" });
          return;
        }
      } catch (uploadErr) {
        wx.hideLoading();
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
    wx.showToast({ title: "登录成功", icon: "none" });

    const app = getApp();
    if (app.globalData && app.globalData.pendingShareToken) {
      wx.reLaunch({ url: "/pages/recipe/share/index" });
      return;
    }

    if (ctx && ctx.currentFamilyId) {
      wx.reLaunch({ url: "/pages/index/index" });
    } else {
      wx.reLaunch({ url: "/pages/family/family/index" });
    }
  },
});
