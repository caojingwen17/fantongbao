const cloud = require("../../../utils/cloud");

Page({
  data: {
    recipeId: "",
    recipeName: "",
    recipeImg: "",
    ingredients: [],
    prepareSteps: [],
    cookingSteps: [],
  },

  async onLoad(options) {
    const recipeId = options && options.recipeId ? options.recipeId : "";
    this.setData({ recipeId });
    if (!recipeId) return;

    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "getRecipe",
        recipeId,
      });
      if (result && result.recipe) {
        const recipe = result.recipe;
        this.setData({
          recipeName: recipe.recipeName || "",
          recipeImg: recipe.recipeImg || "",
          ingredients: recipe.ingredients || [],
          prepareSteps: recipe.prepareSteps || [],
          cookingSteps: recipe.cookingSteps || [],
        });
      }
    } catch (e) {
      // ignore
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

