const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const { attachRecipeImgDisplay } = require("../../../utils/cloudDisplay");

const KEYWORD_DEBOUNCE_MS = 320;

Page({
  data: {
    keyword: "",
    recipes: [],
    familyId: null,
    listLoading: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });
  },

  onShow() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (familyId !== this.data.familyId) {
      this.setData({ familyId });
    }
    this.fetchRecipes();
  },

  onKeywordInput(e) {
    const keyword = e.detail.value || "";
    this.setData({ keyword });
    if (this._keywordTimer) clearTimeout(this._keywordTimer);
    this._keywordTimer = setTimeout(() => this.fetchRecipes(), KEYWORD_DEBOUNCE_MS);
  },

  async fetchRecipes() {
    if (!this.data.familyId) return;
    this.setData({ listLoading: true });
    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "listRecipes",
        familyId: this.data.familyId,
        keyword: this.data.keyword,
      });
      const raw = result && result.recipes ? result.recipes : [];
      const withImg = await attachRecipeImgDisplay(raw);
      this.setData({ recipes: withImg });
    } catch (e) {
      // 已由封装处理提示
    } finally {
      this.setData({ listLoading: false });
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
              await ui.withLoading(async () => {
                await cloud.callFunctionWithErrorToast("recipeFunctions", {
                  type: "deleteRecipe",
                  recipeId,
                });
              }, "删除中…");
              wx.showToast({ title: "删除成功", icon: "none" });
              await this.fetchRecipes();
            },
          });
        }
      },
    });
  },
});

