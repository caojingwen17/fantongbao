const cloud = require("../../utils/cloud");
const { attachRecipeImgDisplay } = require("../../utils/cloudDisplay");
const auth = require("../../utils/auth");

Page({
  data: {
    currentFamily: null,
    families: [],
    membersCount: 0,
    pendingShopping: null,
    pendingCooking: null,
    pendingOrders: [],
    recipes: [],
    homeRefreshing: false,
    showFamilyPicker: false,
    switchingFamilyId: "",
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

  async onLoad() {
    const ok = await this.ensureEntryContext();
    if (!ok) return;

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });

    await this.refreshHome();
  },

  async onShow() {
    const ok = await this.ensureEntryContext();
    if (!ok) return;

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
            type: "listFirstOrdersByStatuses",
            familyId,
          })
          .catch(() => ({})),
        cloud
          .callFunction("recipeFunctions", {
            type: "listRecipes",
            familyId,
            keyword: "",
          })
          .catch(() => ({})),
      ]);

      const members = (membersResp && membersResp.members) || [];
      this.setData({ membersCount: members.length });

      const pendingShopping =
        ordersResp && ordersResp.pendingShopping ? ordersResp.pendingShopping : null;
      const pendingCooking =
        ordersResp && ordersResp.pendingCooking ? ordersResp.pendingCooking : null;

      const pendingOrders = [];
      if (pendingShopping) {
        pendingOrders.push({
          ...pendingShopping,
          statusText: "待买菜",
        });
      }
      if (pendingCooking) {
        pendingOrders.push({
          ...pendingCooking,
          statusText: "待制作",
        });
      }

      this.setData({ pendingShopping, pendingCooking, pendingOrders });

      const list = (recipeResp && recipeResp.recipes) || [];
      const withImg = await attachRecipeImgDisplay(list.slice(0, 6));
      this.setData({ recipes: withImg });
    } catch (e) {
      this.setData({
        membersCount: 0,
        pendingShopping: null,
        pendingCooking: null,
        pendingOrders: [],
        recipes: [],
      });
    } finally {
      wx.hideNavigationBarLoading();
      this.setData({ homeRefreshing: false });
    }
  },

  goFamily() {
    // 跳转前收起浮层，避免返回后残留
    if (this.data.showFamilyPicker) this.setData({ showFamilyPicker: false });
    wx.navigateTo({ url: "/pages/family/family/index" });
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

  goPendingOrder(e) {
    const orderId = e.currentTarget.dataset.orderid;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
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
