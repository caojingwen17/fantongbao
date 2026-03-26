const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");

Page({
  data: {
    orderId: "",
    order: {},
    groups: [],
    progress: {
      doneCount: 0,
      totalCount: 0,
    },
    checklistLoading: false,
  },

  async onLoad(options) {
    const orderId = options && options.orderId ? options.orderId : "";
    this.setData({ orderId });
    await this.fetchChecklist();
  },

  async fetchChecklist() {
    const { orderId } = this.data;
    if (!orderId) return;
    this.setData({ checklistLoading: true });
    try {
      const result = await cloud.callFunction("checklistFunctions", {
        type: "getCookingChecklist",
        orderId,
      });
      if (result) {
        const groups = (result.groups || []).map((g) => ({ ...g, open: true }));
        this.setData({
          order: result.order || {},
          groups,
          progress: {
            doneCount: result.doneCount || 0,
            totalCount: result.totalCount || 0,
          },
        });
      }
    } finally {
      this.setData({ checklistLoading: false });
    }
  },

  async onCheckStep(e) {
    const stepId = e.currentTarget.dataset.stepid;
    const beforeStatus = this.data.order.status;
    const result = await cloud.callFunctionWithErrorToast("checklistFunctions", {
      type: "markCookingStepDone",
      stepId,
    });

    await this.fetchChecklist();

    const afterStatus = (result && result.newOrderStatus) || beforeStatus;
    if (beforeStatus === "pending_cooking" && afterStatus === "completed") {
      wx.showModal({
        title: "提示",
        content: "确认已完成所有制作步骤吗？",
        confirmText: "确认",
        success: (res) => {
          if (res.confirm) {
            wx.reLaunch({ url: "/pages/index/index" });
          }
        },
      });
    }
  },

  toggleRecipe(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    const groups = this.data.groups || [];
    const next = groups.map((g) => {
      if (g.recipeId === recipeId) return { ...g, open: !g.open };
      return g;
    });
    this.setData({ groups: next });
  },

  goBack() {
    const { orderId } = this.data;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },
});

