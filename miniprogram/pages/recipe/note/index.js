const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");

Page({
  data: {
    pageLoading: true,
    recipeId: "",
    recipeName: "",
    recipeImg: "",
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
      const recipeResult = await cloud.callFunction("recipeFunctions", {
        type: "getRecipe",
        recipeId: this.data.recipeId,
      });

      if (recipeResult && recipeResult.recipe) {
        const recipeImg = recipeResult.recipe.recipeImg || "";
        // 头图由 ft-cloud-image 组件按 recipeImg 自行解析换链
        this.setData({
          recipeName: recipeResult.recipe.recipeName || "",
          recipeImg,
        });
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
    const { recipeId, note } = this.data;
    // 点菜单延迟到确认时才 ensure：首屏不再为一个写操作空等
    await ui.withLoading(async () => {
      let orderId = this.data.orderId;
      if (!orderId) {
        const res = await cloud.callFunctionWithErrorToast("orderFunctions", {
          type: "ensurePendingShoppingOrder",
          familyId: this.data.familyId,
        });
        orderId = res && res.orderId;
        if (!orderId) throw new Error("未获取到待买菜点菜单");
        this.setData({ orderId });
      }
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

