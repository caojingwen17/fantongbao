const cloud = require("../../utils/cloud");

Page({
  data: {
    currentFamily: null,
    membersCount: 0,
    pendingShopping: null,
    pendingCooking: null,
    recipes: [],
  },

  async onLoad() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) {
      wx.redirectTo({ url: "/pages/family/family/index" });
      return;
    }

    const currentFamily =
      (app.globalData.families || []).find((f) => f._id === familyId) || null;
    this.setData({ currentFamily });

    await this.refreshHome();
  },

  async refreshHome() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    try {
      const membersResp = await cloud.callFunction("familyFunctions", {
        type: "getFamilyMembers",
        familyId,
      });
      const members = (membersResp && membersResp.members) || [];
      this.setData({ membersCount: members.length });
    } catch (e) {
      this.setData({ membersCount: 0 });
    }

    try {
      const shoppingResp = await cloud.callFunction("orderFunctions", {
        type: "listOrders",
        familyId,
        status: "pending_shopping",
      });
      const shoppingList = (shoppingResp && shoppingResp.orders) || [];
      this.setData({
        pendingShopping: shoppingList[0] || null,
      });
    } catch (e) {
      this.setData({ pendingShopping: null });
    }

    try {
      const cookingResp = await cloud.callFunction("orderFunctions", {
        type: "listOrders",
        familyId,
        status: "pending_cooking",
      });
      const cookingList = (cookingResp && cookingResp.orders) || [];
      this.setData({
        pendingCooking: cookingList[0] || null,
      });
    } catch (e) {
      this.setData({ pendingCooking: null });
    }

    try {
      const recipeResp = await cloud.callFunction("recipeFunctions", {
        type: "listRecipes",
        familyId,
        keyword: "",
      });
      const list = (recipeResp && recipeResp.recipes) || [];
      this.setData({ recipes: list.slice(0, 6) });
    } catch (e) {
      this.setData({ recipes: [] });
    }
  },

  goFamily() {
    wx.navigateTo({ url: "/pages/family/family/index" });
  },

  goShopping() {
    const orderId = this.data.pendingShopping && this.data.pendingShopping._id;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/shopping/shopping/index?orderId=${orderId}` });
  },

  goCooking() {
    const orderId = this.data.pendingCooking && this.data.pendingCooking._id;
    if (!orderId) return;
    wx.navigateTo({ url: `/pages/cooking/cooking/index?orderId=${orderId}` });
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
