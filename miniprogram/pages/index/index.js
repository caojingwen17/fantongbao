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
    /** 未登录且静默登录失败：展示首页介绍，不强制跳转登录（符合平台审核「先体验后授权」） */
    homeGuest: false,
    /** 已登录但尚未加入任何家庭：可浏览本页提示，不强制跳转家庭页 */
    homeNeedFamily: false,
  },

  /**
   * @returns {"ok"|"guest"|"needFamily"}
   */
  async ensureEntryContext() {
    const app = getApp();

    if (!app.globalData.userInfo) {
      try {
        const r = await auth.trySilentLogin();
        if (!r.ok) {
          return "guest";
        }
      } catch (e) {
        return "guest";
      }
    }

    if (!app.globalData.currentFamilyId) {
      return "needFamily";
    }

    return "ok";
  },

  /** 访客：与正式首页同一套布局，数据为空，仅顶部展示轻提示 */
  applyGuestBrowseState() {
    this.setData({
      homeBootstrapping: false,
      homeGuest: true,
      homeNeedFamily: false,
      currentFamily: null,
      families: [],
      membersCount: 0,
      memberAvatarDisplays: [],
      pendingShopping: null,
      pendingCooking: null,
      pendingOrders: [],
      recipes: [],
      recipeTotalCount: 0,
      homeEmptyHero: true,
      homeRefreshing: false,
    });
  },

  async onLoad(options) {
    const openOnboard = options && String(options.onboard) === "1";
    const ctx = await this.ensureEntryContext();
    if (ctx === "guest") {
      this.applyGuestBrowseState();
      return;
    }
    if (ctx === "needFamily") {
      this.setData({ homeBootstrapping: false, homeGuest: false, homeNeedFamily: true });
      return;
    }

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });

    this.setData({ homeGuest: false, homeNeedFamily: false });
    await this.refreshHome();
    if (openOnboard) {
      this.setData({ onboardSheetVisible: true });
    }
  },

  async onShow() {
    const ctx = await this.ensureEntryContext();
    if (ctx === "guest") {
      this.applyGuestBrowseState();
      return;
    }
    if (ctx === "needFamily") {
      this.setData({ homeBootstrapping: false, homeGuest: false, homeNeedFamily: true });
      return;
    }

    // 返回主页时，确保家庭下拉浮层已关闭
    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
    }

    this.setData({ homeGuest: false, homeNeedFamily: false });

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });
    await this.refreshHome();
  },

  async guardGuestAction(content) {
    if (!this.data.homeGuest) return true;
    const r = await auth.requireLoggedIn({
      content: content || "使用此功能需要先登录。",
    });
    return r.ok;
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

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login/index" });
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
    if (!(await this.guardGuestAction("切换家庭需要先登录。"))) return;
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
    if (!(await this.guardGuestAction("切换家庭需要先登录。"))) return;
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

  async onCopyInvite() {
    if (!(await this.guardGuestAction("复制邀请码需要先登录。"))) return;
    const code = this.data.currentFamily && this.data.currentFamily.inviteCode;
    if (!code) return;
    wx.setClipboardData({ data: code });
  },

  async goPendingOrder(e) {
    const orderId = e.currentTarget.dataset.orderid;
    if (!orderId) return;
    if (!(await this.guardGuestAction("查看点菜单需要先登录。"))) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },

  async openCreateOrderModal() {
    if (!(await this.guardGuestAction("创建点菜单需要先登录。"))) return;
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
    if (!(await this.guardGuestAction("创建点菜单需要先登录。"))) return;
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

  async goRecipeList() {
    if (!(await this.guardGuestAction("查看菜谱需要先登录。"))) return;
    wx.navigateTo({ url: "/pages/recipe/list/index" });
  },

  async goRecipeAdd() {
    if (!(await this.guardGuestAction("添加菜谱需要先登录。"))) return;
    wx.navigateTo({ url: "/pages/recipe/add/index" });
  },

  async goRecipeDetail(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    if (!(await this.guardGuestAction("查看菜谱需要先登录。"))) return;
    wx.navigateTo({ url: `/pages/recipe/detail/index?recipeId=${recipeId}` });
  },
});
