const cloud = require("../../../utils/cloud");

Page({
  data: {
    isLoading: false,
  },

  async onGetUserInfo(e) {
    try {
      let userInfo = e && e.detail ? e.detail.userInfo : null;

      // 兼容：有些情况下 e.detail.userInfo 可能为空（用户未授权或基础库差异）
      if (!userInfo && typeof wx.getUserProfile === "function") {
        userInfo = await new Promise((resolve) => {
          wx.getUserProfile({
            desc: "用于展示昵称和头像，创建/加入家庭",
            success: (res) => resolve(res && res.userInfo ? res.userInfo : null),
            fail: () => resolve(null),
          });
        });
      }

      if (!userInfo) {
        wx.showToast({ title: "未获取到头像/昵称授权", icon: "none" });
        return;
      }

      // 部分情况下，微信会返回占位数据（nickName 可能为“微信用户”）
      if (userInfo.nickName === "微信用户" || !userInfo.avatarUrl) {
        const settingRes = await new Promise((resolve) => {
          wx.getSetting({
            success: (res) => resolve(res || {}),
            fail: () => resolve({}),
          });
        });
        const allowed = !!(settingRes && settingRes.authSetting && settingRes.authSetting["scope.userInfo"]);
        if (!allowed) {
          wx.showModal({
            title: "需要授权",
            content: "请到设置中开启“获取您的昵称和头像”，授权后再登录。",
            confirmText: "去设置",
            success: (r) => {
              if (r.confirm) wx.openSetting();
            },
          });
          return;
        }
        // 如果已授权但仍拿到占位，提示用户重试
        wx.showToast({ title: "昵称头像未获取到真实数据，请重试登录", icon: "none" });
        return;
      }

      if (this.data.isLoading) return;
      this.setData({ isLoading: true });

      const loginResp = await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "login",
        nickName: userInfo.nickName,
        avatarUrl: userInfo.avatarUrl,
      });

      const app = getApp();
      app.globalData.userInfo = userInfo;
      if (loginResp && loginResp.openid) app.globalData.openid = loginResp.openid;

      // 初始化集合/索引（首次运行时集合可能不存在）
      try {
        await cloud.callFunction("initFunctions", { init: true });
      } catch (e) {
        // 忽略：后续如果集合缺失，具体功能会报错提示
      }

      // 拉取我的家庭，设置当前家庭上下文
      let familiesResp = null;
      try {
        familiesResp = await cloud.callFunction("familyFunctions", {
          type: "getMyFamilies",
        });
      } catch (err) {
        // 允许没有家庭：不影响后续跳转
      }

      const families = (familiesResp && familiesResp.families) || [];
      app.globalData.families = families;
      app.globalData.currentFamilyId =
        (families[0] && families[0]._id) || null;

      wx.showToast({ title: "登录成功", icon: "none" });

      if (app.globalData.currentFamilyId) {
        wx.redirectTo({ url: "/pages/index/index" });
      } else {
        wx.redirectTo({ url: "/pages/family/family/index" });
      }
    } catch (err) {
      // callFunctionWithErrorToast 已做提示
    } finally {
      this.setData({ isLoading: false });
    }
  },
});

