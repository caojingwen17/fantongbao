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
    pendingOrder: null,
    pendingLoading: false,
    actionBusy: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });
  },

  onShow() {
    this.fetchRecipes();
    this.fetchPendingOrder();
  },

  async fetchPendingOrder() {
    if (!this.data.familyId) return;
    this.setData({ pendingLoading: true });
    try {
      const result = await cloud.callFunction("orderFunctions", {
        type: "getPendingShoppingOrderDetail",
        familyId: this.data.familyId,
      });
      this.setData({ pendingOrder: (result && result.order) || null });
    } catch (e) {
      this.setData({ pendingOrder: null });
    } finally {
      this.setData({ pendingLoading: false });
    }
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
      const raw = (result && result.recipes) || [];
      const withImg = await attachRecipeImgDisplay(raw);
      this.setData({ recipes: withImg });
    } catch (e) {
    } finally {
      this.setData({ listLoading: false });
    }
  },

  onAddWithNote(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    wx.navigateTo({ url: `/pages/recipe/note/index?recipeId=${recipeId}` });
  },

  async onAddSkipNote(e) {
    if (!this.data.familyId) return;
    const recipeId = e.currentTarget.dataset.recipeid;
    try {
      await ui.withLoading(async () => {
        await cloud.callFunctionWithErrorToast("orderFunctions", {
          type: "addRecipeToPendingShoppingOrder",
          familyId: this.data.familyId,
          recipeId,
          note: "",
        });
      }, "添加中…");
      wx.showToast({ title: "添加成功", icon: "none" });
      await this.fetchPendingOrder();
    } catch (err) {}
  },

  onRemoveRecipe(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    const orderId = this.data.pendingOrder && this.data.pendingOrder._id;
    if (!recipeId || !orderId || this.data.actionBusy) return;

    wx.showModal({
      title: "确认删除",
      content: "确认删除该菜品？删除后将同步更新买菜清单。",
      confirmText: "删除",
      confirmColor: "#e64545",
      success: async (r) => {
        if (!r.confirm) return;
        this.setData({ actionBusy: true });
        try {
          const resp = await ui.withLoading(async () => {
            return await cloud.callFunctionWithErrorToast("orderFunctions", {
              type: "removeRecipeFromPendingShoppingOrder",
              orderId,
              recipeId,
            });
          }, "删除中…");

          await this.fetchPendingOrder();

          if (resp && resp.isEmpty) {
            wx.showModal({
              title: "点菜单已空",
              content: "该点菜单已无菜品，是否一并删除点菜单？",
              confirmText: "删除点菜单",
              confirmColor: "#e64545",
              success: async (rr) => {
                if (!rr.confirm) return;
                await ui.withLoading(async () => {
                  await cloud.callFunctionWithErrorToast("orderFunctions", {
                    type: "deleteOrderIfEmpty",
                    orderId,
                  });
                }, "删除中…");
                wx.showToast({ title: "已删除", icon: "none" });
                await this.fetchPendingOrder();
              },
            });
          } else {
            wx.showToast({ title: "已删除", icon: "none" });
          }
        } finally {
          this.setData({ actionBusy: false });
        }
      },
    });
  },
});

