const cloud = require("../../../utils/cloud");

const SESSION_KEY = "fantongbao_session";

/** 微信静默/旧接口返回的占位昵称，不能当作真实资料 */
const PLACEHOLDER_NICKNAMES = ["微信用户", "WeChat User"];

function isPlaceholderNickName(name) {
  if (!name || typeof name !== "string") return true;
  return PLACEHOLDER_NICKNAMES.includes(name.trim());
}

/** 文档中的默认灰头像 URL 片段，旧授权常见 */
function isWeChatDefaultAvatarUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.indexOf("mmbiz/icTdbqWNOwNRna42") !== -1;
}

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
    try {
      const s = wx.getStorageSync(SESSION_KEY);
      const badNick = s && isPlaceholderNickName(s.nickName);
      const badAvatar =
        s &&
        s.avatarUrl &&
        typeof s.avatarUrl === "string" &&
        isWeChatDefaultAvatarUrl(s.avatarUrl);
      if (!s || !s.nickName || !s.avatarUrl || badNick || badAvatar) {
        if (badNick || badAvatar) {
          wx.removeStorageSync(SESSION_KEY);
        }
        this.setData({ checkingSession: false });
        return;
      }
      this.setData({ isLoading: true });
      await this.completeLoginFlow({
        nickName: s.nickName,
        avatarUrl: s.avatarUrl,
      });
    } catch (e) {
      wx.removeStorageSync(SESSION_KEY);
      this.setData({ checkingSession: false, isLoading: false });
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
      await this.completeLoginFlow({
        nickName,
        avatarUrl: fileID,
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: "登录失败，请重试", icon: "none" });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  /**
   * @param {{ nickName: string, avatarUrl: string }} userInfo avatarUrl 可为云 fileID 或 https
   */
  async completeLoginFlow(userInfo) {
    const loginResp = await cloud.callFunctionWithErrorToast("familyFunctions", {
      type: "login",
      nickName: userInfo.nickName,
      avatarUrl: userInfo.avatarUrl,
    });

    wx.setStorageSync(SESSION_KEY, {
      nickName: userInfo.nickName,
      avatarUrl: userInfo.avatarUrl,
    });

    const app = getApp();
    app.globalData.userInfo = userInfo;
    if (loginResp && loginResp.openid) app.globalData.openid = loginResp.openid;

    try {
      await cloud.callFunction("initFunctions", { init: true });
    } catch (e) {}

    let familiesResp = null;
    try {
      familiesResp = await cloud.callFunction("familyFunctions", {
        type: "getMyFamilies",
      });
    } catch (err) {}

    const families = (familiesResp && familiesResp.families) || [];
    app.globalData.families = families;

    const serverCid = loginResp && loginResp.currentFamilyId ? loginResp.currentFamilyId : null;
    if (serverCid && families.some((f) => f._id === serverCid)) {
      app.globalData.currentFamilyId = serverCid;
    } else {
      app.globalData.currentFamilyId = (families[0] && families[0]._id) || null;
    }

    wx.showToast({ title: "登录成功", icon: "none" });

    if (app.globalData.currentFamilyId) {
      wx.redirectTo({ url: "/pages/index/index" });
    } else {
      wx.redirectTo({ url: "/pages/family/family/index" });
    }
  },
});
