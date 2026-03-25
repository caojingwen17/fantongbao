const cloud = require("../../../utils/cloud");
const { resolveForImage } = require("../../../utils/cloudDisplay");

Page({
  data: {
    recipeId: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    note: "",
    familyId: null,
    orderId: "",
  },

  async onLoad(options) {
    const app = getApp();
    this.setData({
      recipeId: options && options.recipeId ? options.recipeId : "",
      familyId: app.globalData.currentFamilyId,
    });

    if (!this.data.recipeId || !this.data.familyId) return;

    // 获取菜谱基础信息用于展示
    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "getRecipe",
        recipeId: this.data.recipeId,
      });
      if (result && result.recipe) {
        const recipeImg = result.recipe.recipeImg || "";
        const recipeImgDisplay = await resolveForImage(recipeImg, {
          familyId: result.recipe.familyId || this.data.familyId,
        });
        this.setData({
          recipeName: result.recipe.recipeName || "",
          recipeImg,
          recipeImgDisplay: recipeImgDisplay || recipeImg,
        });
      }
    } catch (e) {}

    // 找到或创建一个“待买菜”的点菜单
    await this.ensurePendingOrder();
  },

  async ensurePendingOrder() {
    try {
      const result = await cloud.callFunction("orderFunctions", {
        type: "ensurePendingShoppingOrder",
        familyId: this.data.familyId,
      });
      if (result && result.orderId) {
        this.setData({ orderId: result.orderId });
      }
    } catch (e) {}
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value || "" });
  },

  async onConfirm() {
    const { orderId, recipeId, note } = this.data;
    if (!orderId) {
      wx.showToast({ title: "未获取到待买菜点菜单", icon: "none" });
      return;
    }
    await cloud.callFunctionWithErrorToast("orderFunctions", {
      type: "addRecipeToOrder",
      orderId,
      recipeId,
      note,
    });
    wx.showToast({ title: "添加成功", icon: "none" });
    wx.navigateTo({ url: "/pages/order/list/index" });
  },

  onCancel() {
    wx.navigateBack();
  },
});

