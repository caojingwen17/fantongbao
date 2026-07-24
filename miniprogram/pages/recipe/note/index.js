const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const { resolveForImage } = require("../../../utils/cloudDisplay");

Page({
  data: {
    pageLoading: true,
    recipeId: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    note: "",
    familyId: null,
    orderId: "",
  },

  async onLoad(options) {
    const ok = await auth.requireLoggedInOrBack({ content: "记录笔记需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({
      recipeId: options && options.recipeId ? options.recipeId : "",
      familyId: app.globalData.currentFamilyId,
    });

    if (!this.data.recipeId || !this.data.familyId) {
      this.setData({ pageLoading: false });
      return;
    }

    try {
      const [recipeResult, orderResult] = await Promise.all([
        cloud.callFunction("recipeFunctions", {
          type: "getRecipe",
          recipeId: this.data.recipeId,
        }),
        cloud.callFunction("orderFunctions", {
          type: "ensurePendingShoppingOrder",
          familyId: this.data.familyId,
        }),
      ]);

      if (recipeResult && recipeResult.recipe) {
        const recipeImg = recipeResult.recipe.recipeImg || "";
        const recipeImgDisplay = await resolveForImage(recipeImg, {
          familyId: recipeResult.recipe.familyId || this.data.familyId,
        });
        this.setData({
          recipeName: recipeResult.recipe.recipeName || "",
          recipeImg,
          recipeImgDisplay,
        });
      }

      if (orderResult && orderResult.orderId) {
        this.setData({ orderId: orderResult.orderId });
      }
    } catch (e) {
    } finally {
      this.setData({ pageLoading: false });
    }
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
    await ui.withLoading(async () => {
      await cloud.callFunctionWithErrorToast("orderFunctions", {
        type: "addRecipeToOrder",
        orderId,
        recipeId,
        note,
      });
    }, "提交中…");
    wx.showToast({ title: "添加成功", icon: "none" });
    wx.navigateTo({ url: "/pages/order/list/index" });
  },

  onCancel() {
    wx.navigateBack();
  },
});

