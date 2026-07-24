const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const share = require("../../../utils/share");

Page({
  data: {
    pageLoading: true,
    orderId: "",
    order: {},
    recipeCount: 0,
    statusText: "",
    statusCodeText: "0（待购物）",
    actionBusy: false,
    shareConfirmVisible: false,
    shareReady: false,
    shareToken: "",
    canInviteOrder: false,
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

  async ensureShareToken() {
    if (this.data.shareToken) return this.data.shareToken;
    const { orderId } = this.data;
    if (!orderId) throw new Error("缺少点菜单");
    const payload = await share.prepareOrderInviteShareOnPage(this, cloud, orderId);
    return payload.token;
  },

  onShareAppMessage() {
    const msg = share.getOrderInviteShareFromPage(this);
    if (this.data.shareConfirmVisible) {
      setTimeout(() => this.setData({ shareConfirmVisible: false }), 400);
    }
    if (msg) return msg;
    const { orderId } = this.data;
    if (orderId && this.data.canInviteOrder) {
      wx.showToast({ title: "邀请准备中，请稍后再试", icon: "none" });
      return {
        title: share.ORDER_INVITE_SHARE_TITLE,
        path: `/pages/order/detail/index?orderId=${orderId}`,
      };
    }
    return share.defaultShareAppMessage();
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
        canInviteOrder:
          order &&
          (order.status === "pending_shopping" || order.status === "pending_cooking"),
      });
      if (
        order &&
        (order.status === "pending_shopping" || order.status === "pending_cooking")
      ) {
        this.ensureShareToken().catch(() => {});
      }
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

    this.openConfirm(
      {
        kicker: "删除菜品",
        title: "确认删除该菜品？",
        content: "删除后将同步更新买菜清单。",
        confirmText: "删除",
        danger: true,
      },
      async () => {
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
            this.openConfirm(
              {
                kicker: "点菜单已空",
                title: "该点菜单已无菜品",
                content: "是否一并删除本点菜单？",
                confirmText: "删除点菜单",
                danger: true,
              },
              async () => {
                await ui.withLoading(async () => {
                  await cloud.callFunctionWithErrorToast("orderFunctions", {
                    type: "deleteOrderIfEmpty",
                    orderId: this.data.orderId,
                  });
                }, "删除中…");
                wx.showToast({ title: "已删除", icon: "none" });
                wx.switchTab({ url: "/pages/order/list/index" });
              }
            );
          } else {
            wx.showToast({ title: "已删除", icon: "none" });
          }
        } finally {
          this.setData({ actionBusy: false });
        }
      }
    );
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
    const pages = getCurrentPages();
    if (pages.length <= 1) {
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    const prev = pages[pages.length - 2];
    const prevRoute = prev && prev.route ? prev.route : "";
    // 分享链路：详情页下叠了点菜页时，直接回首页，勿再退回点菜页
    if (
      prevRoute === "pages/order/pick/index" ||
      prevRoute === "pages/order/invite/index"
    ) {
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/pages/index/index" }),
    });
  },

  onCompletedToHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  onBack() {
    this.goBack();
  },

  onTapUnlockShareOrder() {
    if (!this.data.canInviteOrder) return;
    this.setData({ shareConfirmVisible: true, shareReady: !!this.data.shareToken });
    if (this.data.shareToken) return;
    this.ensureShareToken()
      .then(() => this.setData({ shareReady: true }))
      .catch(() => {
        this.setData({ shareConfirmVisible: false });
        wx.showToast({ title: "准备邀请失败，请重试", icon: "none" });
      });
  },

  onCloseShareConfirm() {
    this.setData({ shareConfirmVisible: false });
  },

  onAskDeleteOrder() {
    if (this.data.actionBusy || !this.data.orderId) return;
    this.openConfirm(
      {
        kicker: "删除点菜单",
        title: "确定删除本点菜单？",
        content: "将删除本点菜单及关联的买菜/做菜清单，且不可恢复。",
        confirmText: "删除",
        danger: true,
      },
      async () => {
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
      }
    );
  },
});

