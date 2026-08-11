const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const haptics = require("../../../utils/haptics");

const KEYWORD_DEBOUNCE_MS = 320;

Page({
  data: {
    orderId: "",
    familyId: "",
    /** 客人模式：凭点餐邀请 token 访问，不加入家庭 */
    inviteToken: "",
    guest: false,
    order: null,
    localPicked: [],
    recipesRaw: [],
    keyword: "",
    viewRecipes: [],
    pickedRows: [],
    pickedCount: 0,
    listLoading: false,
    refreshing: false,
    pickedSheetVisible: false,
    canInviteOrder: false,
    orderName: "",
  },

  async onLoad(options) {
    const ok = await auth.requireLoggedInOrBack({ content: "点菜需要先登录。" });
    if (!ok) return;
    const app = getApp();
    const orderId = (options && options.orderId) || "";
    const inviteToken = (options && options.inviteToken) || "";
    this.setData({
      orderId,
      familyId: app.globalData.currentFamilyId || "",
      inviteToken,
      guest: !!inviteToken,
    });
    if (!orderId) {
      wx.showToast({ title: "缺少点菜单", icon: "none" });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.loadInitial();
  },

  formatDate(v) {
    if (!v) return "—";
    if (typeof v === "string") {
      const m = v.match(/\d{4}-\d{2}-\d{2}/);
      if (m) return m[0];
      return v.slice(0, 10);
    }
    try {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mo = `${d.getMonth() + 1}`.padStart(2, "0");
        const day = `${d.getDate()}`.padStart(2, "0");
        return `${y}-${mo}-${day}`;
      }
    } catch (e) {}
    return "—";
  },

  applyPickedFlags() {
    const raw = this.data.recipesRaw || [];
    const localPicked = this.data.localPicked || [];
    const ids = new Set(localPicked.map((r) => r.recipeId).filter(Boolean));
    const viewRecipes = raw.map((item) => ({
      ...item,
      createDateText: this.formatDate(item.createTime),
      inOrder: ids.has(item.id),
    }));
    this.setData({
      viewRecipes,
      pickedRows: localPicked,
      pickedCount: localPicked.length,
    });
  },

  /** 进入页面：拉点菜单 + 菜谱列表，本地草稿与服务器一致 */
  async loadInitial() {
    const { orderId, familyId, inviteToken, guest } = this.data;
    if (!orderId) return;
    if (!familyId && !guest) return;
    this.setData({ listLoading: true });
    try {
      const [orderRes, recipeRes] = await Promise.all([
        cloud.callFunction("orderFunctions", Object.assign(
          { type: "getOrderDetail", orderId },
          guest ? { inviteToken } : {}
        )),
        cloud.callFunction("recipeFunctions", Object.assign(
          {
            type: "listRecipes",
            familyId,
            keyword: this.data.keyword || "",
            lite: true,
          },
          guest ? { inviteToken } : {}
        )),
      ]);
      const order = orderRes && orderRes.order ? orderRes.order : null;
      if (order && order.status === "completed") {
        wx.showToast({ title: "该点菜单已完成", icon: "none" });
        setTimeout(() => this.goBackFromPick(), 1200);
        return;
      }
      const raw = (recipeRes && recipeRes.recipes) || [];
      const localPicked = (order && order.recipes ? order.recipes : []).map((r) => ({ ...r }));
      this.setData({
        order,
        recipesRaw: raw,
        localPicked,
        orderName: (order && order.orderName) || "点菜单",
        canInviteOrder:
          !guest &&
          order &&
          (order.status === "pending_shopping" || order.status === "pending_cooking"),
      });
      this.applyPickedFlags();
    } catch (e) {
      if (e && e.message) {
        wx.showToast({ title: String(e.message).slice(0, 30), icon: "none" });
      }
    } finally {
      this.setData({ listLoading: false });
    }
  },

  /** 仅搜索菜谱，不重置已点草稿 */
  async loadRecipesOnly() {
    const { familyId, inviteToken, guest } = this.data;
    if (!familyId && !guest) return;
    this.setData({ listLoading: true });
    try {
      const recipeRes = await cloud.callFunction("recipeFunctions", Object.assign(
        {
          type: "listRecipes",
          familyId,
          keyword: this.data.keyword || "",
          lite: true,
        },
        guest ? { inviteToken } : {}
      ));
      const raw = (recipeRes && recipeRes.recipes) || [];
      this.setData({ recipesRaw: raw });
      this.applyPickedFlags();
    } catch (e) {
    } finally {
      this.setData({ listLoading: false });
    }
  },

  onKeywordInput(e) {
    const keyword = e.detail.value || "";
    this.setData({ keyword });
    if (this._keywordTimer) clearTimeout(this._keywordTimer);
    this._keywordTimer = setTimeout(() => this.loadRecipesOnly(), KEYWORD_DEBOUNCE_MS);
  },

  onClearKeyword() {
    if (!this.data.keyword) return;
    this.setData({ keyword: "" });
    this.loadRecipesOnly();
  },

  async onRefresh() {
    try {
      await this.loadRecipesOnly();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  /** 从分享链接进入时页面栈无上一页，navigateBack 会失败，需显式回到点菜单详情 */
  goBackFromPick() {
    const { orderId, guest } = this.data;
    const pages = getCurrentPages();
    const prev = pages.length >= 2 ? pages[pages.length - 2] : null;
    const prevRoute = prev && prev.route ? prev.route : "";
    if (prevRoute === "pages/order/detail/index") {
      wx.navigateBack();
      return;
    }
    // 客人没有家庭权限，不能进点菜单详情页，直接回首页
    if (guest) {
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    if (orderId) {
      // 分享进入等场景：reLaunch 清栈，避免详情页返回又落到点菜页
      wx.reLaunch({ url: `/pages/order/detail/index?orderId=${orderId}` });
      return;
    }
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/pages/index/index" }),
    });
  },

  onBack() {
    this.goBackFromPick();
  },

  noop() {},

  goRecipeDetail(e) {
    // 客人模式不开放菜谱详情（详情页含编辑等家庭成员操作）
    if (this.data.guest) return;
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    wx.navigateTo({ url: `/pages/recipe/detail/index?recipeId=${recipeId}` });
  },

  togglePickedSheet() {
    this.setData({ pickedSheetVisible: !this.data.pickedSheetVisible });
  },

  closePickedSheet() {
    this.setData({ pickedSheetVisible: false });
  },

  async onSubmit() {
    const { orderId, order, localPicked } = this.data;
    if (!orderId || !order) return;
    if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
      wx.showToast({ title: "当前点菜单不可提交", icon: "none" });
      return;
    }

    const serverRecipes = order.recipes || [];
    const serverIds = new Set(serverRecipes.map((r) => r.recipeId).filter(Boolean));
    const localById = new Map((localPicked || []).map((r) => [r.recipeId, r]));
    const toRemove = [...serverIds].filter((id) => !localById.has(id));
    const toAdd = (localPicked || []).filter((r) => r && r.recipeId && !serverIds.has(r.recipeId));

    if (toRemove.length === 0 && toAdd.length === 0) {
      this.goBackFromPick();
      return;
    }

    try {
      await ui.withLoading(async () => {
        await cloud.callFunction(
          "orderFunctions",
          Object.assign(
            {
              type: "syncOrderRecipes",
              orderId,
              recipes: (localPicked || []).map((r) => ({
                recipeId: r.recipeId,
                note: r.note || "",
                creatorId: r.creatorId,
              })),
            },
            this.data.guest ? { inviteToken: this.data.inviteToken } : {}
          ),
          { timeout: 30000 }
        );
      }, "提交中…");
      getApp().globalData.homeDirty = true;
      haptics.medium();
      wx.showToast({ title: "已提交", icon: "success" });
      setTimeout(() => this.goBackFromPick(), 400);
    } catch (err) {
      wx.showToast({
        title: String((err && err.message) || "提交失败，请重试").slice(0, 30),
        icon: "none",
      });
      await this.loadInitial();
      getApp().globalData.homeDirty = true;
    }
  },

  onTapAdd(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    const inOrder = e.currentTarget.dataset.inorder;
    // 已点状态下按钮为「−」，点击取消点这道菜
    if (inOrder === true || inOrder === "true") {
      this.onPickedRemove(e);
      return;
    }
    const { order, localPicked } = this.data;
    if (!recipeId || !order) return;
    if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
      wx.showToast({ title: "当前点菜单不可加菜", icon: "none" });
      return;
    }
    const ids = new Set((localPicked || []).map((r) => r.recipeId));
    if (ids.has(recipeId)) return;
    haptics.light();
    const raw = (this.data.recipesRaw || []).find((r) => r.id === recipeId);
    const recipeName = raw && raw.recipeName ? raw.recipeName : "";
    const next = [
      ...(localPicked || []),
      {
        recipeId,
        recipeName,
        note: "",
        creatorNickName: "",
      },
    ];
    this.setData({ localPicked: next });
    this.applyPickedFlags();
  },

  onPickedRemove(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    haptics.light();
    const { order, localPicked } = this.data;
    if (!order) return;
    if (order.status !== "pending_shopping" && order.status !== "pending_cooking") {
      return;
    }
    const next = (localPicked || []).filter((r) => r && r.recipeId !== recipeId);
    this.setData({ localPicked: next });
    this.applyPickedFlags();
  },
});
