const cloud = require("../../../utils/cloud");

Page({
  data: {
    orderId: "",
    order: {},
  },

  async onLoad(options) {
    const orderId = options && options.orderId ? options.orderId : "";
    this.setData({ orderId });
    if (!orderId) return;

    try {
      const result = await cloud.callFunction("orderFunctions", {
        type: "getOrderDetail",
        orderId,
      });
      if (result && result.order) {
        this.setData({ order: result.order });
      }
    } catch (e) {}
  },

  goShopping() {
    const { orderId } = this.data;
    wx.navigateTo({ url: `/pages/shopping/shopping/index?orderId=${orderId}` });
  },

  goCooking() {
    const { orderId } = this.data;
    wx.navigateTo({ url: `/pages/cooking/cooking/index?orderId=${orderId}` });
  },

  goBack() {
    wx.navigateBack();
  },
});

