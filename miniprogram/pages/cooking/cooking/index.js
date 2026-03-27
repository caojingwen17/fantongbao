const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");

Page({
  data: {
    orderId: "",
    order: {},
    groups: [],
    currentRecipeId: "",
    currentGroup: null,
    progress: {
      doneCount: 0,
      totalCount: 0,
    },
    checklistLoading: false,
    showCompleteModal: false,
    pendingToggleCount: 0,
    actionBusy: false,
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
        const prevGroups = this.data.groups || [];
        const openMap = {};
        prevGroups.forEach((g) => {
          if (g && g.recipeId) openMap[g.recipeId] = !!g.open;
        });
        const groups = (result.groups || []).map((g) => {
          const prepareSteps = (g.prepareSteps || []).map((s) => ({ ...s }));
          const cookingSteps = (g.cookingSteps || []).map((s) => ({ ...s }));
          const totalCount = prepareSteps.length + cookingSteps.length;
          const doneCount =
            prepareSteps.filter((s) => !!s.done).length + cookingSteps.filter((s) => !!s.done).length;
          return {
            ...g,
            open: Object.prototype.hasOwnProperty.call(openMap, g.recipeId) ? openMap[g.recipeId] : true,
            totalCount,
            doneCount,
            prepareSteps,
            cookingSteps,
          };
        });
        const currentRecipeId =
          this.data.currentRecipeId && groups.find((g) => g.recipeId === this.data.currentRecipeId)
            ? this.data.currentRecipeId
            : (groups[0] && groups[0].recipeId) || "";
        const currentGroup = groups.find((g) => g.recipeId === currentRecipeId) || groups[0] || null;
        this.setData({
          order: result.order || {},
          groups,
          currentRecipeId,
          currentGroup,
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
    const done = !!e.currentTarget.dataset.done;
    if (!stepId) return;
    if (this.data.order.status !== "pending_cooking") return;

    const prevGroups = JSON.parse(JSON.stringify(this.data.groups || []));
    const prevProgress = { ...(this.data.progress || { doneCount: 0, totalCount: 0 }) };
    const targetDone = !done;

    const groups = (this.data.groups || []).map((g) => {
      const nextPrepare = (g.prepareSteps || []).map((s) => (s._id === stepId ? { ...s, done: targetDone } : s));
      const nextCooking = (g.cookingSteps || []).map((s) => (s._id === stepId ? { ...s, done: targetDone } : s));
      const doneCount = nextPrepare.filter((s) => !!s.done).length + nextCooking.filter((s) => !!s.done).length;
      return { ...g, prepareSteps: nextPrepare, cookingSteps: nextCooking, doneCount };
    });
    const nextDoneCount = Math.max(
      0,
      Math.min(prevProgress.totalCount || 0, (prevProgress.doneCount || 0) + (targetDone ? 1 : -1))
    );
    this.setData({
      groups,
      progress: { totalCount: prevProgress.totalCount || 0, doneCount: nextDoneCount },
      pendingToggleCount: (this.data.pendingToggleCount || 0) + 1,
    });

    try {
      await cloud.callFunctionWithErrorToast("checklistFunctions", {
        type: targetDone ? "markCookingStepDone" : "markCookingStepUndone",
        stepId,
      });
    } catch (err) {
      this.setData({ groups: prevGroups, progress: prevProgress });
      wx.showToast({ title: "更新失败，请重试", icon: "none" });
    } finally {
      const nextPending = Math.max(0, (this.data.pendingToggleCount || 1) - 1);
      this.setData({
        pendingToggleCount: nextPending,
      });
    }
  },

  onToggleGroup(e) {
    const recipeId = e.currentTarget.dataset.recipeid || "";
    if (!recipeId) return;
    const groups = (this.data.groups || []).map((g) => {
      if (g.recipeId !== recipeId) return g;
      return { ...g, open: !g.open };
    });
    this.setData({ groups });
  },

  onSelectRecipe(e) {
    const recipeId = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.recipeid : "";
    if (!recipeId) return;
    const groups = this.data.groups || [];
    const currentGroup = groups.find((g) => g.recipeId === recipeId) || null;
    this.setData({ currentRecipeId: recipeId, currentGroup });
  },

  goBack() {
    const pages = getCurrentPages();
    const { orderId } = this.data;
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    if (orderId) {
      wx.redirectTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
    } else {
      wx.reLaunch({ url: "/pages/index/index" });
    }
  },

  closeCompleteModal() {
    this.setData({ showCompleteModal: false });
  },

  async confirmCompleteModal() {
    if (this.data.pendingToggleCount > 0) {
      wx.showToast({ title: "正在同步勾选，请稍后", icon: "none" });
      return;
    }
    const orderId = this.data.orderId;
    if (!orderId) return;
    this.setData({ actionBusy: true });
    try {
      await cloud.callFunctionWithErrorToast("checklistFunctions", {
        type: "completeCookingOrder",
        orderId,
      });
    } finally {
      this.setData({ actionBusy: false, showCompleteModal: false });
    }
    wx.reLaunch({ url: "/pages/index/index" });
  },

  onCompleteCooking() {
    this.setData({ showCompleteModal: true });
  },
});

