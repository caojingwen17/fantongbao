const cloud = require("../../../utils/cloud");
const auth = require("../../../utils/auth");

Page({
  data: {
    status: "pending_shopping",
    statusText: "待买菜",
    familyId: null,
    orders: [],
    listLoading: false,
    refreshing: false,
  },

  async onLoad() {
    const ok = await auth.requireLoggedInOrBack({ content: "查看点菜单列表需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({
      familyId: app.globalData.currentFamilyId,
    });
  },

  onShow() {
    if (!auth.isLoggedIn()) return;
    this.fetchOrders();
  },

  onChangeStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({
      status,
      statusText: status === "pending_shopping" ? "待买菜" : status === "pending_cooking" ? "待制作" : "已完成",
    });
    this.fetchOrders();
  },

  async onRefresh() {
    try {
      await this.fetchOrders();
    } finally {
      this.setData({ refreshing: false });
    }
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

  goFirstOrder() {
    const first = (this.data.orders || [])[0];
    if (!first || !first._id) {
      wx.showToast({ title: "暂无可处理点菜单", icon: "none" });
      return;
    }
    this.onOrderTap({ currentTarget: { dataset: { orderid: first._id } } });
  },

  goRecipeList() {
    wx.switchTab({ url: "/pages/recipe/list/index" });
  },

  onGoPick() {
    wx.switchTab({ url: "/pages/index/index" });
  },
});

