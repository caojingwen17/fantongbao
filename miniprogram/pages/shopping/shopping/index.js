const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");

Page({
  data: {
    orderId: "",
    order: {},
    mergedItems: [],
    viewItems: [],
    viewItemsSeasoning: [],
    viewItemsFood: [],
    groups: [],
    progress: {
      doneCount: 0,
      totalCount: 0,
    },
    extraName: "",
    extraAmount: "",
    checklistLoading: false,
    actionBusy: false,
    pendingToggleCount: 0,
    manualItemIdsFlat: [],
    expenseDialogVisible: false,
    expenseInput: "",
    pendingCompleteOrderId: "",
  },

  buildViewItems(mergedItems) {
    return (mergedItems || []).map((m) => {
      const rawSource = m && m.sourcesText ? String(m.sourcesText) : "来自：手动添加";
      const amountText = m && m.totalAmountText ? String(m.totalAmountText) : "";
      const displaySource = amountText ? `${rawSource}（${amountText}）` : rawSource;
      const name = m && m.name ? String(m.name) : "";
      const isManual = !!(m && m.manualItemIds && m.manualItemIds.length);
      const isSeasoning = /(酱|油|盐|醋|糖|料酒|耗油|胡椒|花椒|孜然|辣椒|豆瓣|味精)/.test(name);
      return {
        ...m,
        displayName: name,
        displaySource,
        tagText: isManual ? "手动添加" : isSeasoning ? "调料" : "食材",
        tagClass: isManual ? "manual" : isSeasoning ? "seasoning" : "food",
      };
    });
  },

  buildManualIds(mergedItems) {
    const manualItemIdsFlat = [];
    (mergedItems || []).forEach((m) => {
      const ids = (m && m.manualItemIds) || [];
      ids.forEach((id) => manualItemIdsFlat.push(id));
    });
    return manualItemIdsFlat;
  },

  applyMergedItemsToView(mergedItems, progress) {
    const viewItems = this.buildViewItems(mergedItems);
    const viewItemsSeasoning = viewItems.filter((x) => x.tagClass === "seasoning");
    const viewItemsFood = viewItems.filter((x) => x.tagClass !== "seasoning");
    const manualItemIdsFlat = this.buildManualIds(mergedItems);
    this.setData({
      mergedItems,
      viewItems,
      viewItemsSeasoning,
      viewItemsFood,
      manualItemIdsFlat,
      progress: progress || this.data.progress,
    });
  },

  async onLoad(options) {
    const ok = await auth.requireLoggedInOrBack({ content: "使用买菜清单需要先登录。" });
    if (!ok) return;
    const orderId = options && options.orderId ? options.orderId : "";
    this.setData({ orderId });
    this._skipShowFetchOnce = true;
    await this.fetchChecklist();
  },

  async onShow() {
    if (!auth.isLoggedIn()) return;
    if (this._skipShowFetchOnce) {
      this._skipShowFetchOnce = false;
      return;
    }
    await this.fetchChecklist();
  },

  async fetchChecklist() {
    const { orderId } = this.data;
    if (!orderId) return;
    if (this._fetchPromise) return this._fetchPromise;
    this._fetchPromise = this._doFetchChecklist().finally(() => {
      this._fetchPromise = null;
    });
    return this._fetchPromise;
  },

  async _doFetchChecklist() {
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
        const mergedItems = result.mergedItems || [];
        this.setData({
          order: result.order || {},
          groups: result.groups || [],
          progress: { totalCount, doneCount },
        });
        this.applyMergedItemsToView(mergedItems, { totalCount, doneCount });
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
    }, "提交中…", false);
    this.setData({ extraName: "", extraAmount: "" });
    await this.fetchChecklist();
  },

  async onDeleteItem(e) {
    const itemIds = e.currentTarget.dataset.itemids || [];
    if (!this.data.order || this.data.order.status !== "pending_shopping") return;
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await ui.withLoading(async () => {
        await cloud.callFunctionWithErrorToast("checklistFunctions", {
          type: "removeManualShoppingItems",
          orderId: this.data.orderId,
          itemIds,
        });
      }, "处理中…", false);
    } finally {
      this.setData({ actionBusy: false });
    }
    await this.fetchChecklist();
  },

  async onCheckItem(e) {
    if (!this.data.order || this.data.order.status !== "pending_shopping") return;
    const itemIds = e.currentTarget.dataset.itemids || [];
    const wasDone = !!e.currentTarget.dataset.alldone;
    const targetDone = !wasDone;
    if (!itemIds || !itemIds.length) return;
    const prevMergedItems = JSON.parse(JSON.stringify(this.data.mergedItems || []));
    const prevProgress = { ...(this.data.progress || { totalCount: 0, doneCount: 0 }) };

    // 乐观更新：先本地切换完成状态，接口失败再回滚。
    const nextMergedItems = (this.data.mergedItems || []).map((m) => {
      const ids = (m && m.itemIds) || [];
      const hit = ids.some((id) => itemIds.includes(id));
      return hit ? { ...m, allDone: targetDone } : m;
    });
    const delta = targetDone ? itemIds.length : -itemIds.length;
    const optimisticDoneCount = Math.max(
      0,
      Math.min(prevProgress.totalCount || 0, (prevProgress.doneCount || 0) + delta)
    );
    this.applyMergedItemsToView(nextMergedItems, {
      totalCount: prevProgress.totalCount || 0,
      doneCount: optimisticDoneCount,
    });

    this.setData({
      pendingToggleCount: (this.data.pendingToggleCount || 0) + 1,
    });
    try {
      await cloud.callFunctionWithErrorToast("checklistFunctions", {
        type: targetDone ? "markMergedItemsDone" : "markMergedItemsUndone",
        orderId: this.data.orderId,
        itemIds,
      });
    } catch (err) {
      // 失败回滚到点击前，避免错误状态留在界面。
      this.applyMergedItemsToView(prevMergedItems, prevProgress);
      wx.showToast({ title: "更新失败，请重试", icon: "none" });
    } finally {
      const nextPending = Math.max(0, (this.data.pendingToggleCount || 1) - 1);
      this.setData({
        pendingToggleCount: nextPending,
      });
    }
  },

  async onConfirmAllSeasonings() {
    if (!this.data.order || this.data.order.status !== "pending_shopping") return;
    if (this.data.actionBusy) return;
    const undoneGroups = (this.data.viewItemsSeasoning || []).filter((x) => !x.allDone);
    if (!undoneGroups.length) {
      wx.showToast({ title: "调料已全部确认", icon: "none" });
      return;
    }
    const itemIds = [];
    undoneGroups.forEach((g) => {
      (g.itemIds || []).forEach((id) => itemIds.push(id));
    });
    const uniqueItemIds = [...new Set(itemIds)];
    if (!uniqueItemIds.length) return;

    const prevMergedItems = JSON.parse(JSON.stringify(this.data.mergedItems || []));
    const prevProgress = { ...(this.data.progress || { totalCount: 0, doneCount: 0 }) };

    const nextMergedItems = (this.data.mergedItems || []).map((m) => {
      const ids = (m && m.itemIds) || [];
      const hit = ids.some((id) => uniqueItemIds.includes(id));
      return hit ? { ...m, allDone: true } : m;
    });
    const optimisticDoneCount = Math.max(
      0,
      Math.min(prevProgress.totalCount || 0, (prevProgress.doneCount || 0) + uniqueItemIds.length)
    );
    this.applyMergedItemsToView(nextMergedItems, {
      totalCount: prevProgress.totalCount || 0,
      doneCount: optimisticDoneCount,
    });

    this.setData({ pendingToggleCount: (this.data.pendingToggleCount || 0) + 1 });
    try {
      await cloud.callFunctionWithErrorToast("checklistFunctions", {
        type: "markMergedItemsDone",
        orderId: this.data.orderId,
        itemIds: uniqueItemIds,
      });
      wx.showToast({ title: "调料已全部确认", icon: "none" });
    } catch (err) {
      this.applyMergedItemsToView(prevMergedItems, prevProgress);
      wx.showToast({ title: "更新失败，请重试", icon: "none" });
    } finally {
      const nextPending = Math.max(0, (this.data.pendingToggleCount || 1) - 1);
      this.setData({ pendingToggleCount: nextPending });
    }
  },

  async onCompleteShopping() {
    const { orderId, order } = this.data;
    if (!orderId || !order || order.status !== "pending_shopping" || this.data.actionBusy) return;

    wx.showModal({
      title: "确认完成买菜",
      content: "确认完成采购？即使仍有未勾选项也会直接进入做菜阶段。",
      confirmText: "确认完成",
      confirmColor: "#07C160",
      success: (r) => {
        if (!r.confirm) return;
        if ((this.data.pendingToggleCount || 0) > 0) {
          wx.showToast({ title: "正在同步勾选，请稍后", icon: "none" });
          return;
        }
        this.setData({
          expenseDialogVisible: true,
          expenseInput: "",
          pendingCompleteOrderId: orderId,
        });
      },
    });
  },

  closeExpenseDialog() {
    this.setData({
      expenseDialogVisible: false,
      expenseInput: "",
      pendingCompleteOrderId: "",
    });
  },

  onExpenseInput(e) {
    this.setData({ expenseInput: (e && e.detail && e.detail.value) || "" });
  },

  async onSkipExpense() {
    await this._submitCompleteShopping(null);
  },

  async onConfirmExpense() {
    const raw = (this.data.expenseInput || "").trim();
    if (!raw) {
      wx.showToast({ title: "请输入金额或点击跳过", icon: "none" });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      wx.showToast({ title: "请输入有效金额", icon: "none" });
      return;
    }
    await this._submitCompleteShopping(n);
  },

  async _submitCompleteShopping(shoppingExpense) {
    const orderId = this.data.pendingCompleteOrderId || this.data.orderId;
    if (!orderId || this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await ui.withLoading(async () => {
        await cloud.callFunctionWithErrorToast("checklistFunctions", {
          type: "completeShoppingOrder",
          orderId,
        });
        const expense = shoppingExpense != null && shoppingExpense !== "" ? Number(shoppingExpense) : null;
        if (expense != null && Number.isFinite(expense) && expense > 0) {
          await cloud.callFunctionWithErrorToast("checklistFunctions", {
            type: "setShoppingExpense",
            orderId,
            shoppingExpense: expense,
          });
        }
      }, "提交中…");
      this.closeExpenseDialog();
      wx.showToast({ title: "已完成买菜", icon: "none" });
      wx.redirectTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
    } finally {
      this.setData({ actionBusy: false });
    }
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

  onContinueAdd() {
    const { order, orderId } = this.data;
    if (!order || order.status !== "pending_shopping" || !orderId) return;
    wx.navigateTo({ url: `/pages/order/pick/index?orderId=${orderId}` });
  },

  onDeleteManualAll() {
    const ids = this.data.manualItemIdsFlat || [];
    if (!ids.length) return;
    this.onDeleteItem({ currentTarget: { dataset: { itemids: ids } } });
  },

  noop() {},
});

