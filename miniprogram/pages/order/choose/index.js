const cloud = require("../../../utils/cloud");
const auth = require("../../../utils/auth");

/**
 * 兼容旧入口：无 orderId 时尝试使用当前家庭下待买菜点菜单，否则提示返回。
 * 新流程请使用 /pages/order/pick/index?orderId=
 */
Page({
  async onLoad(options) {
    const logged = await auth.requireLoggedInOrBack({ content: "点菜需要先登录。" });
    if (!logged) return;
    let orderId = (options && options.orderId) || "";
    const app = getApp();
    const familyId = app.globalData.currentFamilyId || "";
    if (!orderId && familyId) {
      try {
        const r = await cloud.callFunction("orderFunctions", {
          type: "getPendingShoppingOrderDetail",
          familyId,
        });
        orderId = r && r.order && r.order._id ? r.order._id : "";
      } catch (e) {}
    }
    if (orderId) {
      wx.redirectTo({ url: `/pages/order/pick/index?orderId=${orderId}` });
    } else {
      wx.showToast({ title: "请从点菜单进入点菜", icon: "none" });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack({ delta: 1 });
        else wx.reLaunch({ url: "/pages/index/index" });
      }, 1600);
    }
  },
});
