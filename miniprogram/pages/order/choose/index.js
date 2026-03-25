const cloud = require("../../../utils/cloud");

Page({
  data: {
    keyword: "",
    recipes: [],
    familyId: null,
  },

  async onLoad() {
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });
    await this.fetchRecipes();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || "" });
    this.fetchRecipes();
  },

  async fetchRecipes() {
    if (!this.data.familyId) return;
    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "listRecipes",
        familyId: this.data.familyId,
        keyword: this.data.keyword,
      });
      this.setData({ recipes: (result && result.recipes) || [] });
    } catch (e) {}
  },

  onAddWithNote(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    wx.navigateTo({ url: `/pages/recipe/note/index?recipeId=${recipeId}` });
  },

  async onAddSkipNote(e) {
    if (!this.data.familyId) return;
    const recipeId = e.currentTarget.dataset.recipeid;
    try {
      // 让云端“确保待买菜点菜单存在”并添加菜品（备注为空）
      await cloud.callFunctionWithErrorToast("orderFunctions", {
        type: "addRecipeToPendingShoppingOrder",
        familyId: this.data.familyId,
        recipeId,
        note: "",
      });
      wx.showToast({ title: "添加成功", icon: "none" });
    } catch (err) {}
  },
});

