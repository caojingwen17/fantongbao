const cloud = require("../../../utils/cloud");
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

  async onLoad(options) {
    const recipeId = options && options.recipeId ? options.recipeId : "";
    this.setData({ recipeId });
    if (!recipeId) {
      this.setData({ pageLoading: false });
      return;
    }

    try {
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
    } catch (e) {
      // ignore
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  goNote() {
    if (!this.data.recipeId) return;
    wx.showModal({
      title: "确认点这道菜吗？",
      content: "你可以在下一页添加口味偏好或食材替换备注（选填）。",
      confirmText: "确认点菜",
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: `/pages/recipe/note/index?recipeId=${this.data.recipeId}`,
          });
        }
      },
    });
  },
});

