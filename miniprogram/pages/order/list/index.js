const cloud = require("../../../utils/cloud");

Page({
  data: {
    status: "pending_shopping",
    familyId: null,
    orders: [],
    listLoading: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({
      familyId: app.globalData.currentFamilyId,
    });
  },

  onShow() {
    this.fetchOrders();
  },

  onChangeStatus(e) {
    this.setData({ status: e.currentTarget.dataset.status });
    this.fetchOrders();
  },

  async fetchOrders() {
    if (!this.data.familyId) return;
    this.setData({ listLoading: true });
    try {
      const result = await cloud.callFunction("orderFunctions", {
        type: "listOrders",
        familyId: this.data.familyId,
        status: this.data.status,
      });
      this.setData({
        orders: (result && result.orders) || [],
      });
    } finally {
      this.setData({ listLoading: false });
    }
  },

  onOrderTap(e) {
    const orderId = e.currentTarget.dataset.orderid;
    // 根据状态跳转到对应工作台
    const order = (this.data.orders || []).find((x) => x._id === orderId);
    const status = order ? order.status : this.data.status;
    if (status === "pending_shopping") {
      wx.navigateTo({ url: `/pages/shopping/shopping/index?orderId=${orderId}` });
      return;
    }
    if (status === "pending_cooking") {
      wx.navigateTo({ url: `/pages/cooking/cooking/index?orderId=${orderId}` });
      return;
    }
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },
});

