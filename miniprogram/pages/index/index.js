const cloud = require("../../utils/cloud");
const { attachRecipeImgDisplay, resolveBatch } = require("../../utils/cloudDisplay");
const auth = require("../../utils/auth");

function getDefaultNewOrderName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const h = d.getHours();
  if (h >= 6 && h < 12) return `${ymd(d)}-午餐`;
  if (h >= 12 && h < 18) return `${ymd(d)}-晚餐`;
  if (h >= 18) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + 1);
    return `${ymd(nd)}-早餐`;
  }
  return `${ymd(d)}-早餐`;
}

Page({
  data: {
    currentFamily: null,
    families: [],
    membersCount: 0,
    memberAvatarDisplays: [],
    pendingShopping: null,
    pendingCooking: null,
    pendingOrders: [],
    recipes: [],
    /** 家庭菜谱总数（列表接口全量；首页只展示前 6 个卡片） */
    recipeTotalCount: 0,
    homeRefreshing: false,
    /** 首屏静默登录 + 首拉数据完成前全屏 loading */
    homeBootstrapping: true,
    showFamilyPicker: false,
    switchingFamilyId: "",
    showCreateOrderModal: false,
    newOrderName: "",
    createOrderBusy: false,
    /** 无点菜单且无菜谱时展示引导大卡片 */
    homeEmptyHero: false,
    /** 从家庭页创建/加入后带 ?onboard=1 打开的三步说明 */
    onboardSheetVisible: false,
  },

  async ensureEntryContext() {
    const app = getApp();

    // 尚未建立登录态/家庭上下文：尝试静默登录；失败则去登录页
    if (!app.globalData.userInfo) {
      try {
        const r = await auth.trySilentLogin();
        if (!r.ok) {
          wx.reLaunch({ url: "/pages/login/login/index" });
          return false;
        }
      } catch (e) {
        wx.reLaunch({ url: "/pages/login/login/index" });
        return false;
      }
    }

    // 已登录但未加入/未创建家庭：去家庭页引导
    if (!app.globalData.currentFamilyId) {
      wx.redirectTo({ url: "/pages/family/family/index" });
      return false;
    }

    return true;
  },

  async onLoad(options) {
    const openOnboard = options && String(options.onboard) === "1";
    const ok = await this.ensureEntryContext();
    if (!ok) {
      this.setData({ homeBootstrapping: false });
      return;
    }

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });

    await this.refreshHome();
    if (openOnboard) {
      this.setData({ onboardSheetVisible: true });
    }
  },

  async onShow() {
    const ok = await this.ensureEntryContext();
    if (!ok) {
      this.setData({ homeBootstrapping: false });
      return;
    }

    // 返回主页时，确保家庭下拉浮层已关闭
    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
    }

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });
    await this.refreshHome();
  },

  async refreshFamiliesIfNeeded() {
    const app = getApp();
    if (app.globalData.families && app.globalData.families.length) return;
    const resp = await cloud
      .callFunction("familyFunctions", { type: "getMyFamilies" })
      .catch(() => ({}));
    const families = (resp && resp.families) || [];
    app.globalData.families = families;
    const familyId = app.globalData.currentFamilyId;
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ families, currentFamily });
  },

  async refreshHome() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    this.setData({ homeRefreshing: true });
    wx.showNavigationBarLoading();
    try {
      const [membersResp, ordersResp, recipeResp] = await Promise.all([
        cloud
          .callFunction("familyFunctions", {
            type: "getFamilyMembers",
            familyId,
          })
          .catch(() => ({})),
        cloud
          .callFunction("orderFunctions", {
            type: "listActiveOrders",
            familyId,
          })
          .catch(() => ({})),
        cloud
          .callFunction("recipeFunctions", {
            type: "listRecipesForHome",
            familyId,
            limit: 6,
          })
          .catch(() => ({})),
      ]);

      const members = (membersResp && membersResp.members) || [];
      const avatarIds = members
        .map((m) => (m && (m.avatarUrl || m.avatar || m.userAvatar || m.avatarFileId)) || "")
        .filter(Boolean);
      const avatarMap = await resolveBatch(avatarIds, familyId ? { familyId } : {});
      const memberAvatarDisplays = members
        .map((m) => {
          const id = (m && (m.avatarUrl || m.avatar || m.userAvatar || m.avatarFileId)) || "";
          if (!id) return "";
          if (typeof id === "string" && id.indexOf("cloud://") === 0) return avatarMap[id] || id;
          return id;
        })
        .filter(Boolean)
        .slice(0, 2);

      this.setData({ membersCount: members.length, memberAvatarDisplays });

      const rawOrders = (ordersResp && ordersResp.orders) || [];
      const pendingOrders = rawOrders.map((o) => {
        const rc = o.recipeCount || 0;
        let statusText = o.status === "pending_cooking" ? "待制作" : "待买菜";
        if (rc === 0) statusText = "待点菜";
        return { ...o, statusText };
      });

      const pendingShopping =
        pendingOrders.find((x) => x.status === "pending_shopping") || null;
      const pendingCooking =
        pendingOrders.find((x) => x.status === "pending_cooking") || null;

      this.setData({ pendingShopping, pendingCooking, pendingOrders });

      const list = (recipeResp && recipeResp.recipes) || [];
      const recipeTotalCount =
        typeof recipeResp.totalCount === "number" ? recipeResp.totalCount : list.length;
      const withImg = await attachRecipeImgDisplay(list);
      const homeEmptyHero =
        (!pendingOrders || pendingOrders.length === 0) && recipeTotalCount === 0;
      this.setData({ recipes: withImg, recipeTotalCount, homeEmptyHero });
    } catch (e) {
      this.setData({
        membersCount: 0,
        memberAvatarDisplays: [],
        pendingShopping: null,
        pendingCooking: null,
        pendingOrders: [],
        recipes: [],
        recipeTotalCount: 0,
        homeEmptyHero: true,
      });
    } finally {
      wx.hideNavigationBarLoading();
      this.setData({ homeRefreshing: false, homeBootstrapping: false });
    }
  },

  goFamily() {
    // 跳转前收起浮层，避免返回后残留
    if (this.data.showFamilyPicker) this.setData({ showFamilyPicker: false });
    wx.navigateTo({ url: "/pages/family/family/index" });
  },

  goFeedback() {
    wx.navigateTo({ url: "/pages/feedback/index" });
  },

  onHide() {
    // 保险：页面隐藏时强制关闭浮层
    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
    }
  },

  async onToggleFamilyPicker() {
    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
      return;
    }
    await this.refreshFamiliesIfNeeded();
    this.setData({ showFamilyPicker: true });
  },

  onCloseFamilyPicker() {
    if (!this.data.showFamilyPicker) return;
    this.setData({ showFamilyPicker: false });
  },

  async onSwitchFamily(e) {
    const familyId = e.currentTarget.dataset.familyid;
    if (!familyId || this.data.switchingFamilyId) return;
    const app = getApp();
    app.globalData.currentFamilyId = familyId;
    const families = this.data.families || app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({
      switchingFamilyId: familyId,
      currentFamily: currentFamily || this.data.currentFamily,
      showFamilyPicker: false,
    });
    wx.showNavigationBarLoading();
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "switchFamily",
        familyId,
      });
    } finally {
      wx.hideNavigationBarLoading();
      this.setData({ switchingFamilyId: "" });
    }
    await this.refreshHome();
  },

  noop() {},

  closeOnboardSheet() {
    this.setData({ onboardSheetVisible: false });
  },

  onCopyInvite() {
    const code = this.data.currentFamily && this.data.currentFamily.inviteCode;
    if (!code) return;
    wx.setClipboardData({ data: code });
  },

  goPendingOrder(e) {
    const orderId = e.currentTarget.dataset.orderid;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },

  openCreateOrderModal() {
    if (this.data.showFamilyPicker) this.setData({ showFamilyPicker: false });
    this.setData({
      showCreateOrderModal: true,
      newOrderName: getDefaultNewOrderName(),
    });
  },

  closeCreateOrderModal() {
    if (this.data.createOrderBusy) return;
    this.setData({ showCreateOrderModal: false, newOrderName: "" });
  },

  onNewOrderNameInput(e) {
    this.setData({ newOrderName: (e.detail && e.detail.value) || "" });
  },

  async confirmCreateOrder() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId || this.data.createOrderBusy) return;
    const orderName = (this.data.newOrderName || "").trim() || getDefaultNewOrderName();
    this.setData({ createOrderBusy: true });
    try {
      const res = await cloud.callFunctionWithErrorToast("orderFunctions", {
        type: "createOrder",
        familyId,
        orderName,
      });
      const orderId = res && res.orderId;
      this.setData({ showCreateOrderModal: false, newOrderName: "" });
      if (orderId) {
        await this.refreshHome();
        wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
      }
    } finally {
      this.setData({ createOrderBusy: false });
    }
  },

  goRecipeList() {
    wx.navigateTo({ url: "/pages/recipe/list/index" });
  },

  goRecipeAdd() {
    wx.navigateTo({ url: "/pages/recipe/add/index" });
  },

  goRecipeDetail(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    wx.navigateTo({ url: `/pages/recipe/detail/index?recipeId=${recipeId}` });
  },
});
