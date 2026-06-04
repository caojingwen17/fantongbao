const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");

Page({
  data: {
    pageLoading: true,
    orderId: "",
    order: {},
    recipeCount: 0,
    statusText: "",
    statusCodeText: "0（待购物）",
    actionBusy: false,
  },

  getStatusText(status, recipeCount) {
    const n = typeof recipeCount === "number" ? recipeCount : 0;
    if (n === 0 && status !== "completed") {
      return "待点菜";
    }
    switch (status) {
      case "pending_shopping":
        return "待买菜";
      case "pending_cooking":
        return "待制作";
      case "completed":
        return "已完成";
      default:
        return status || "";
    }
  },

  getStatusCodeText(status, recipeCount) {
    const n = typeof recipeCount === "number" ? recipeCount : 0;
    if (n === 0 && status !== "completed") {
      return "待点菜";
    }
    switch (status) {
      case "pending_shopping":
        return "0（待购物）";
      case "pending_cooking":
        return "1（待制作）";
      case "completed":
        return "2（已完成）";
      default:
        return "0（待购物）";
    }
  },

  async refreshOrder() {
    const { orderId } = this.data;
    if (!orderId) return;
    const result = await cloud.callFunction("orderFunctions", {
      type: "getOrderDetail",
      orderId,
    });
    if (result && result.order) {
      const order = result.order;
      const recipeCount = Array.isArray(order.recipes) ? order.recipes.length : 0;
      this.setData({
        order,
        recipeCount,
        statusText: this.getStatusText(order && order.status, recipeCount),
        statusCodeText: this.getStatusCodeText(order && order.status, recipeCount),
      });
    }
  },

  async onLoad(options) {
    const ok = await auth.requireLoggedInOrBack({ content: "查看点菜单需要先登录。" });
    if (!ok) return;
    const orderId = options && options.orderId ? options.orderId : "";
    this.setData({ orderId });
    if (!orderId) {
      this.setData({ pageLoading: false });
      return;
    }

    try {
      await this.refreshOrder();
    } catch (e) {
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  onShow() {
    if (!auth.isLoggedIn()) return;
    if (!this.data.orderId || this.data.pageLoading) return;
    this.refreshOrder();
  },

  async onRemoveRecipe(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId || this.data.actionBusy) return;

    wx.showModal({
      title: "确认删除",
      content: "确认删除该菜品？删除后将同步更新买菜清单。",
      confirmText: "删除",
      confirmColor: "#e64545",
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ actionBusy: true });
        try {
          const resp = await ui.withLoading(async () => {
            return await cloud.callFunctionWithErrorToast("orderFunctions", {
              type: "removeRecipeFromPendingShoppingOrder",
              orderId: this.data.orderId,
              recipeId,
            });
          }, "删除中…");

          await this.refreshOrder();

          if (resp && resp.isEmpty) {
            wx.showModal({
              title: "点菜单已空",
              content: "该点菜单已无菜品，是否一并删除点菜单？",
              confirmText: "删除点菜单",
              confirmColor: "#e64545",
              success: async (rr) => {
                if (!rr.confirm) return;
                await ui.withLoading(async () => {
                  await cloud.callFunctionWithErrorToast("orderFunctions", {
                    type: "deleteOrderIfEmpty",
                    orderId: this.data.orderId,
                  });
                }, "删除中…");
                wx.showToast({ title: "已删除", icon: "none" });
                wx.navigateTo({ url: "/pages/order/list/index" });
              },
            });
          } else {
            wx.showToast({ title: "已删除", icon: "none" });
          }
        } finally {
          this.setData({ actionBusy: false });
        }
      },
    });
  },

  goShopping() {
    const { orderId } = this.data;
    wx.navigateTo({ url: `/pages/shopping/shopping/index?orderId=${orderId}` });
  },

  goCooking() {
    const { orderId } = this.data;
    wx.navigateTo({ url: `/pages/cooking/cooking/index?orderId=${orderId}` });
  },

  goOrder() {
    const { orderId } = this.data;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/pick/index?orderId=${orderId}` });
  },

  goContinueAdd() {
    this.goOrder();
  },

  goBack() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  onCompletedToHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  onBack() {
    this.goBack();
  },

  onAskDeleteOrder() {
    if (this.data.actionBusy || !this.data.orderId) return;
    wx.showModal({
      title: "删除点菜单",
      content: "将删除本点菜单及关联的买菜/做菜清单，且不可恢复。确定删除？",
      confirmText: "删除",
      confirmColor: "#e64545",
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ actionBusy: true });
        try {
          await ui.withLoading(async () => {
            await cloud.callFunctionWithErrorToast("orderFunctions", {
              type: "deleteOrder",
              orderId: this.data.orderId,
            });
          }, "删除中…");
          wx.showToast({ title: "已删除", icon: "none" });
          wx.reLaunch({ url: "/pages/index/index" });
        } finally {
          this.setData({ actionBusy: false });
        }
      },
    });
  },
});

