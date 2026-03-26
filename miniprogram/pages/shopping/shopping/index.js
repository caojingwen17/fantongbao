const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");

Page({
  data: {
    orderId: "",
    order: {},
    mergedItems: [],
    groups: [],
    progress: {
      doneCount: 0,
      totalCount: 0,
    },
    extraName: "",
    extraAmount: "",
    checklistLoading: false,
    actionBusy: false,
  },

  async onLoad(options) {
    const orderId = options && options.orderId ? options.orderId : "";
    this.setData({ orderId });
    await this.fetchChecklist();
  },

  async onShow() {
    // 从“继续加菜”返回时自动刷新归并清单
    await this.fetchChecklist();
  },

  async fetchChecklist() {
    const { orderId } = this.data;
    if (!orderId) return;
    this.setData({ checklistLoading: true });
    try {
      const result = await cloud.callFunction("checklistFunctions", {
        type: "getShoppingChecklist",
        orderId,
      });
      if (result) {
        const totalCount = result.totalCount || 0;
        const doneCount = result.doneCount || 0;
        this.setData({
          order: result.order || {},
          mergedItems: result.mergedItems || [],
          groups: result.groups || [],
          progress: { totalCount, doneCount },
        });
      }
    } finally {
      this.setData({ checklistLoading: false });
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
    await ui.withLoading(async () => {
      await cloud.callFunctionWithErrorToast("checklistFunctions", {
        type: "addExtraShoppingItem",
        orderId,
        name: extraName,
        amount: extraAmount,
      });
    }, "提交中…");
    this.setData({ extraName: "", extraAmount: "" });
    await this.fetchChecklist();
  },

  async onDeleteItem(e) {
    const itemIds = e.currentTarget.dataset.itemids || [];
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await ui.withLoading(async () => {
        await cloud.callFunctionWithErrorToast("checklistFunctions", {
          type: "removeManualShoppingItems",
          orderId: this.data.orderId,
          itemIds,
        });
      }, "处理中…");
    } finally {
      this.setData({ actionBusy: false });
    }
    await this.fetchChecklist();
  },

  async onCheckItem(e) {
    const itemIds = e.currentTarget.dataset.itemids || [];
    if (!itemIds || !itemIds.length) return;
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await ui.withLoading(async () => {
        await cloud.callFunctionWithErrorToast("checklistFunctions", {
          type: "markMergedItemsDone",
          orderId: this.data.orderId,
          itemIds,
        });
      }, "更新中…");
    } finally {
      this.setData({ actionBusy: false });
    }

    // 刷新进度
    await this.fetchChecklist();
  },

  onCompleteShopping() {
    const { orderId, order } = this.data;
    if (!orderId || !order || order.status !== "pending_shopping" || this.data.actionBusy) return;

    wx.showModal({
      title: "确认完成买菜",
      content: "确认完成采购？完成后将无法加菜、删菜。",
      confirmText: "确认完成",
      confirmColor: "#07C160",
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ actionBusy: true });
        try {
          await ui.withLoading(async () => {
            await cloud.callFunctionWithErrorToast("checklistFunctions", {
              type: "completeShoppingOrder",
              orderId,
            });
          }, "提交中…");
          wx.showToast({ title: "已完成买菜", icon: "none" });
          await this.fetchChecklist();
          wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
        } finally {
          this.setData({ actionBusy: false });
        }
      },
    });
  },

  goBack() {
    const { orderId } = this.data;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },

  onContinueAdd() {
    const { order } = this.data;
    if (!order || order.status !== "pending_shopping") return;
    wx.navigateTo({ url: "/pages/order/choose/index" });
  },
});

