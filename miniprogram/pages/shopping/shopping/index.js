const cloud = require("../../../utils/cloud");

Page({
  data: {
    orderId: "",
    order: {},
    groups: [],
    progress: {
      doneCount: 0,
      totalCount: 0,
    },
    extraName: "",
    extraAmount: "",
  },

  async onLoad(options) {
    const orderId = options && options.orderId ? options.orderId : "";
    this.setData({ orderId });
    await this.fetchChecklist();
  },

  async fetchChecklist() {
    const { orderId } = this.data;
    if (!orderId) return;
    const result = await cloud.callFunction("checklistFunctions", {
      type: "getShoppingChecklist",
      orderId,
    });
    if (result) {
      const totalCount = result.totalCount || 0;
      const doneCount = result.doneCount || 0;
      this.setData({
        order: result.order || {},
        groups: result.groups || [],
        progress: { totalCount, doneCount },
      });
    }
  },

  onExtraNameInput(e) {
    this.setData({ extraName: e.detail.value || "" });
  },

  onExtraAmountInput(e) {
    this.setData({ extraAmount: e.detail.value || "" });
  },

  async onAddExtra() {
    const { orderId, extraName, extraAmount } = this.data;
    if (!extraName) {
      wx.showToast({ title: "请输入采购项名称", icon: "none" });
      return;
    }
    await cloud.callFunctionWithErrorToast("checklistFunctions", {
      type: "addExtraShoppingItem",
      orderId,
      name: extraName,
      amount: extraAmount,
    });
    this.setData({ extraName: "", extraAmount: "" });
    await this.fetchChecklist();
  },

  async onDeleteItem(e) {
    const itemId = e.currentTarget.dataset.itemid;
    await cloud.callFunctionWithErrorToast("checklistFunctions", {
      type: "removeExtraShoppingItem",
      itemId,
    });
    await this.fetchChecklist();
  },

  async onCheckItem(e) {
    const itemId = e.currentTarget.dataset.itemid;
    const beforeStatus = this.data.order.status;
    const result = await cloud.callFunctionWithErrorToast("checklistFunctions", {
      type: "markShoppingItemDone",
      itemId,
    });

    // 刷新进度
    await this.fetchChecklist();

    const afterStatus = (result && result.newOrderStatus) || beforeStatus;
    if (beforeStatus === "pending_shopping" && afterStatus === "pending_cooking") {
      wx.showModal({
        title: "提示",
        content: "确认已完成所有采购吗？",
        confirmText: "确认",
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: "/pages/order/list/index" });
          }
        },
      });
    }
  },

  goBack() {
    const { orderId } = this.data;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },
});

