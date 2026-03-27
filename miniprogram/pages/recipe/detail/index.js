const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const { resolveForImage } = require("../../../utils/cloudDisplay");

Page({
  data: {
    pageLoading: true,
    recipeId: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    ingredients: [],
    seasonings: [],
    prepareSteps: [],
    cookingSteps: [],
  },

  async fetchRecipeDetail() {
    const { recipeId } = this.data;
    if (!recipeId) return;
    const result = await cloud.callFunction("recipeFunctions", {
      type: "getRecipe",
      recipeId,
    });
    if (result && result.recipe) {
      const recipe = result.recipe;
      const recipeImg = recipe.recipeImg || "";
      const recipeImgDisplay = await resolveForImage(recipeImg, {
        familyId: recipe.familyId,
      });
      this.setData({
        recipeName: recipe.recipeName || "",
        recipeImg,
        recipeImgDisplay: recipeImgDisplay || recipeImg,
        ingredients: recipe.ingredients || [],
        seasonings: recipe.seasonings || [],
        prepareSteps: recipe.prepareSteps || [],
        cookingSteps: recipe.cookingSteps || [],
      });
    }
  },

  async onLoad(options) {
    const app = getApp();
    const familyId = app && app.globalData ? app.globalData.currentFamilyId : "";
    const recipeId = options && options.recipeId ? options.recipeId : "";
    this.setData({ recipeId, familyId: familyId || "" });
    if (!recipeId) {
      this.setData({ pageLoading: false });
      return;
    }

    try {
      await this.fetchRecipeDetail();
    } catch (e) {
      // ignore
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  async onShow() {
    if (this.data.pageLoading || !this.data.recipeId) return;
    try {
      await this.fetchRecipeDetail();
    } catch (e) {
      // ignore
    }
  },

  onBack() {
    wx.navigateBack();
  },

  goEdit() {
    const { recipeId } = this.data;
    if (!recipeId) return;
    wx.navigateTo({ url: `/pages/recipe/edit/index?recipeId=${recipeId}` });
  },

  onAskDeleteRecipe() {
    const { recipeId, recipeName } = this.data;
    if (!recipeId) return;
    wx.showModal({
      title: "删除菜谱",
      content: `确定删除「${recipeName || "该菜谱"}」？删除后不可恢复。`,
      confirmText: "删除",
      confirmColor: "#e64545",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await ui.withLoading(async () => {
            await cloud.callFunctionWithErrorToast("recipeFunctions", {
              type: "deleteRecipe",
              recipeId,
            });
          }, "删除中…");
          wx.showToast({ title: "已删除", icon: "none" });
          wx.navigateBack();
        } catch (e) {}
      },
    });
  },
});

