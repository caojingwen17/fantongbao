const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const haptics = require("../../../utils/haptics");

Page({
  data: {
    orderId: "",
    /** 多单一起买：全部订单 id（单参时也为 1 个） */
    orderIds: [],
    combined: false,
    order: {},
    orders: [],
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
    refreshing: false,
    confirmModal: {
      visible: false,
      kicker: "",
      title: "",
      content: "",
      confirmText: "确认",
      danger: false,
    },
  },

  openConfirm(opts, action) {
    this._confirmAction = action || null;
    this.setData({
      confirmModal: {
        visible: true,
        kicker: opts.kicker || "",
        title: opts.title || "",
        content: opts.content || "",
        confirmText: opts.confirmText || "确认",
        danger: !!opts.danger,
      },
    });
  },

  async onConfirmModalOk() {
    const action = this._confirmAction;
    this._confirmAction = null;
    this.setData({ "confirmModal.visible": false });
    if (action) await action();
  },

  onConfirmModalCancel() {
    this._confirmAction = null;
    this.setData({ "confirmModal.visible": false });
  },

  buildViewItems(mergedItems) {
    return (mergedItems || []).map((m) => {
      const rawSource = m && m.sourcesText ? String(m.sourcesText) : "来自：手动添加";
      const amountText = m && m.totalAmountText ? String(m.totalAmountText) : "";
      const displaySource = amountText ? `${rawSource}（${amountText}）` : rawSource;
      const name = m && m.name ? String(m.name) : "";
      const isManual = !!(m && m.manualItemIds && m.manualItemIds.length);
      // 优先用后端按 itemSource 给的分类；旧数据缺字段时退回名称正则
      const isSeasoning =
        typeof (m && m.isSeasoning) === "boolean"
          ? m.isSeasoning
          : /(酱|油|盐|醋|糖|料酒|耗油|蚝油|生抽|老抽|胡椒|花椒|孜然|辣椒|豆瓣|味精|鸡精|豉油)/.test(name);
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
    // 多单一起买：orderIds=逗号分隔；单点菜单：orderId
    const rawIds = options && options.orderIds ? String(options.orderIds) : "";
    const orderIds = rawIds
      ? rawIds.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const orderId = orderIds.length ? orderIds[0] : (options && options.orderId) || "";
    if (!orderIds.length && orderId) orderIds.push(orderId);
    this.setData({ orderId, orderIds, combined: orderIds.length > 1 });
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
    const { orderId, orderIds, combined } = this.data;
    if (!orderId) return;
    this.setData({ checklistLoading: true });
    try {
      // orderId 一并传上：新版后端优先用 orderIds，旧版可退化为单参，避免升级期全空
      const payload = { type: "getShoppingChecklist", orderId };
      if (combined) payload.orderIds = orderIds;
      const result = await cloud.callFunction("checklistFunctions", payload);
      if (result) {
        const totalCount = result.totalCount || 0;
        const doneCount = result.doneCount || 0;
        const mergedItems = result.mergedItems || [];
        this.setData({
          order: result.order || {},
          orders: Array.isArray(result.orders) ? result.orders : [],
          groups: result.groups || [],
          progress: { totalCount, doneCount },
        });
        this.applyMergedItemsToView(mergedItems, { totalCount, doneCount });
        // 有未勾选项时重置自动提示标记，便于下次全部勾选后再次询问
        if (!totalCount || doneCount < totalCount) {
          this._autoCompletePromptShown = false;
        }
      }
    } catch (e) {
      wx.showToast({
        title: (e && e.message ? e.message : "清单加载失败").slice(0, 30),
        icon: "none",
      });
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
    haptics.light();
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
      if (targetDone) {
        this._maybePromptCompleteShopping();
      } else {
        this._autoCompletePromptShown = false;
      }
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

  /** 全部采购项勾选后立即询问是否完成买菜（每次全勾只问一次，取消勾选后重置） */
  _maybePromptCompleteShopping() {
    const { progress, order } = this.data;
    const total = (progress && progress.totalCount) || 0;
    const done = (progress && progress.doneCount) || 0;
    if (!order || order.status !== "pending_shopping") return;
    if (!total || done < total) return;
    if (this._autoCompletePromptShown) return;
    this._autoCompletePromptShown = true;
    this.openConfirm(
      {
        kicker: "完成买菜",
        title: "采购项已全部勾选",
        content: "是否完成买菜，进入做菜阶段？",
        confirmText: "确认完成",
      },
      async () => {
        if ((this.data.pendingToggleCount || 0) > 0) {
          wx.showToast({ title: "正在同步勾选，请稍后", icon: "none" });
          return;
        }
        this.setData({
          expenseDialogVisible: true,
          expenseInput: "",
          pendingCompleteOrderId: this.data.orderId,
        });
      }
    );
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
      this._maybePromptCompleteShopping();
    } catch (err) {
      this.applyMergedItemsToView(prevMergedItems, prevProgress);
      wx.showToast({ title: "更新失败，请重试", icon: "none" });
    } finally {
      const nextPending = Math.max(0, (this.data.pendingToggleCount || 1) - 1);
      this.setData({ pendingToggleCount: nextPending });
    }
  },

  /** 食材一键全部确认（逻辑同调料） */
  async onConfirmAllFood() {
    if (!this.data.order || this.data.order.status !== "pending_shopping") return;
    if (this.data.actionBusy) return;
    const undoneGroups = (this.data.viewItemsFood || []).filter((x) => !x.allDone);
    if (!undoneGroups.length) {
      wx.showToast({ title: "食材已全部确认", icon: "none" });
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
      wx.showToast({ title: "食材已全部确认", icon: "none" });
      this._maybePromptCompleteShopping();
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

    this.openConfirm(
      {
        kicker: "完成买菜",
        title: "确认完成采购？",
        content: "即使仍有未勾选项也会直接进入做菜阶段。",
        confirmText: "确认完成",
      },
      async () => {
        if ((this.data.pendingToggleCount || 0) > 0) {
          wx.showToast({ title: "正在同步勾选，请稍后", icon: "none" });
          return;
        }
        this.setData({
          expenseDialogVisible: true,
          expenseInput: "",
          pendingCompleteOrderId: orderId,
        });
      }
    );
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
    const { orderIds, combined } = this.data;
    this.setData({ actionBusy: true });
    try {
      await ui.withLoading(async () => {
        await cloud.callFunctionWithErrorToast(
          "checklistFunctions",
          Object.assign(
            { type: "completeShoppingOrder", orderId },
            combined ? { orderIds } : {}
          )
        );
        const expense = shoppingExpense != null && shoppingExpense !== "" ? Number(shoppingExpense) : null;
        if (expense != null && Number.isFinite(expense) && expense > 0) {
          await cloud.callFunctionWithErrorToast("checklistFunctions", {
            type: "setShoppingExpense",
            orderId,
            shoppingExpense: expense,
            // 一起买：金额自动平摊到全部点菜单
            sharedOrderIds: combined ? orderIds : null,
          });
        }
      }, "提交中…");
      this.closeExpenseDialog();
      haptics.success();
      wx.showToast({ title: "已完成买菜", icon: "none" });
      if (combined) {
        wx.reLaunch({ url: "/pages/index/index" });
      } else {
        wx.redirectTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
      }
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
    this.openConfirm(
      {
        kicker: "删除手动项",
        title: "删除全部手动添加的采购项？",
        confirmText: "删除",
        danger: true,
      },
      async () => {
        await this.onDeleteItem({ currentTarget: { dataset: { itemids: ids } } });
      }
    );
  },

  noop() {},

  async onRefresh() {
    try {
      await this.fetchChecklist();
    } finally {
      this.setData({ refreshing: false });
    }
  },
});

