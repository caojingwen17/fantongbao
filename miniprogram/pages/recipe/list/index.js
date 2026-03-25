const cloud = require("../../../utils/cloud");

Page({
  data: {
    keyword: "",
    recipes: [],
    familyId: null,
  },

  onLoad() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    this.setData({ familyId });
    this.fetchRecipes();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || "" });
    // 简化：不做防抖，实时请求由开发者后续优化
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
      this.setData({ recipes: result && result.recipes ? result.recipes : [] });
    } catch (e) {
      // 已由封装处理提示
    }
  },

  goAdd() {
    wx.navigateTo({ url: "/pages/recipe/add/index" });
  },

  goDetail(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    wx.navigateTo({ url: `/pages/recipe/detail/index?recipeId=${recipeId}` });
  },

  onLongPressRecipe(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    wx.showActionSheet({
      itemList: ["编辑", "删除"],
      success: async (res) => {
        // 0 编辑 1 删除
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/recipe/edit/index?recipeId=${recipeId}` });
          return;
        }
        if (res.tapIndex === 1) {
          wx.showModal({
            title: "确认删除",
            content: "删除后不可恢复",
            confirmText: "删除",
            confirmColor: "#e64545",
            success: async (r) => {
              if (!r.confirm) return;
              await cloud.callFunctionWithErrorToast("recipeFunctions", {
                type: "deleteRecipe",
                recipeId,
              });
              wx.showToast({ title: "删除成功", icon: "none" });
              await this.fetchRecipes();
            },
          });
        }
      },
    });
  },
});

