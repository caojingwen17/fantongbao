const auth = require("../../../utils/auth");

const { getValidSessionOrNull, completeLoginFlow, isPlaceholderNickName } = auth;

Page({
  data: {
    isLoading: false,
    checkingSession: true,
    nickName: "",
    avatarTempPath: "",
    avatarPreview: "",
  },

  onLoad() {
    this.trySilentLogin();
  },

  async trySilentLogin() {
    const s = getValidSessionOrNull();
    if (!s) {
      this.setData({ checkingSession: false });
      return;
    }
    this.setData({ isLoading: true });
    try {
      await this.afterLoginNavigate(await completeLoginFlow(s));
    } catch (e) {
      this.setData({ checkingSession: false, isLoading: false });
      wx.removeStorageSync(auth.SESSION_KEY);
    }
  },

  onChooseAvatar(e) {
    const path = e.detail && e.detail.avatarUrl ? e.detail.avatarUrl : "";
    if (!path) return;
    this.setData({
      avatarTempPath: path,
      avatarPreview: path,
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
    // 与静默登录保持一致的“占位昵称”判断
    if (isPlaceholderNickName(nickName)) {
      wx.showToast({ title: "请填写真实昵称，不能使用「微信用户」", icon: "none" });
      return;
    }
    if (!this.data.avatarTempPath) {
      wx.showToast({ title: "请选择头像", icon: "none" });
      return;
    }
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    try {
      wx.showLoading({ title: "上传头像…" });
      const cloudPath = `avatars/login/${Date.now()}-${Math.random().toString(16).slice(2)}.png`;
      const up = await wx.cloud.uploadFile({
        cloudPath,
        filePath: this.data.avatarTempPath,
      });
      const fileID = up && up.fileID ? up.fileID : "";
      wx.hideLoading();
      if (!fileID) {
        wx.showToast({ title: "头像上传失败", icon: "none" });
        return;
      }
      await this.afterLoginNavigate(
        await completeLoginFlow({
          nickName,
          avatarUrl: fileID,
        })
      );
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  /**
   * 登录完成后的跳转策略：以首页为“主页”，避免把登录页留在栈底
   * @param {{ currentFamilyId: string|null }} ctx
   */
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
