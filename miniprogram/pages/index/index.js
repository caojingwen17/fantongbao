const cloud = require("../../utils/cloud");
const { attachRecipeImgDisplay } = require("../../utils/cloudDisplay");
const auth = require("../../utils/auth");

Page({
  data: {
    currentFamily: null,
    membersCount: 0,
    pendingShopping: null,
    pendingCooking: null,
    pendingOrders: [],
    recipes: [],
    homeRefreshing: false,
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
    const currentFamily =
      (app.globalData.families || []).find((f) => f._id === familyId) || null;
    this.setData({ currentFamily });

    await this.refreshHome();
  },

  async onShow() {
    const ok = await this.ensureEntryContext();
    if (!ok) return;

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const currentFamily =
      (app.globalData.families || []).find((f) => f._id === familyId) || null;
    this.setData({ currentFamily });
    await this.refreshHome();
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
    wx.navigateTo({ url: "/pages/family/family/index" });
  },

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
