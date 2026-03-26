const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");

Page({
  data: {
    pageLoading: true,
    orderId: "",
    order: {},
    actionBusy: false,
  },

  async refreshOrder() {
    const { orderId } = this.data;
    if (!orderId) return;
    const result = await cloud.callFunction("orderFunctions", {
      type: "getOrderDetail",
      orderId,
    });
    if (result && result.order) {
      this.setData({ order: result.order });
    }
  },

  async onLoad(options) {
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

  goContinueAdd() {
    const { order } = this.data;
    if (!order || !order._id) {
      wx.navigateTo({ url: "/pages/order/choose/index" });
      return;
    }
    // V3：pending_shopping/pending_cooking 都允许“继续加菜”入口；
    // 若当前点菜单已进入待制作，则后续点菜会自动创建新待买菜单。
    wx.navigateTo({ url: "/pages/order/choose/index" });
  },

  goBack() {
    wx.navigateBack();
  },
});

