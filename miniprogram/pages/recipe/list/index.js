const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const { attachRecipeImgDisplay } = require("../../../utils/cloudDisplay");

const KEYWORD_DEBOUNCE_MS = 320;
const TAGS = ["家常快手", "微辣下饭", "适合聚餐", "慢炖浓香", "轻食健康", "主厨推荐"];

Page({
  data: {
    keyword: "",
    recipes: [],
    viewRecipes: [],
    familyId: null,
    listLoading: false,
    sheetVisible: false,
    confirmVisible: false,
    selectedRecipeId: "",
    selectedRecipeName: "",
  },

  async onLoad() {
    const ok = await auth.requireLoggedInOrBack({ content: "查看家庭菜谱需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });
  },

  onBack() {
    wx.navigateBack();
  },

  onShow() {
    if (!auth.isLoggedIn()) return;
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

  onClearKeyword() {
    if (!this.data.keyword) return;
    this.setData({ keyword: "" });
    this.fetchRecipes();
  },

  buildViewRecipes(raw) {
    return (raw || []).map((item, index) => {
      const time = item && item.createTime ? item.createTime : "";
      const createDateText = this.formatDate(time);
      return {
        ...item,
        createDateText,
        tagText: TAGS[index % TAGS.length],
      };
    });
  },

  formatDate(v) {
    if (!v) return "—";
    if (typeof v === "string") {
      const m = v.match(/\d{4}-\d{2}-\d{2}/);
      if (m) return m[0];
      return v.slice(0, 10);
    }
    try {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = `${d.getMonth() + 1}`.padStart(2, "0");
        const day = `${d.getDate()}`.padStart(2, "0");
        return `${y}-${m}-${day}`;
      }
    } catch (e) {}
    return "—";
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
      this.setData({
        recipes: withImg,
        viewRecipes: this.buildViewRecipes(withImg),
      });
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
    const target = (this.data.viewRecipes || []).find((x) => x && x.id === recipeId);
    this.setData({
      selectedRecipeId: recipeId,
      selectedRecipeName: (target && target.recipeName) || "",
      sheetVisible: true,
    });
  },

  onTapDeleteRecipe(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    const target = (this.data.viewRecipes || []).find((x) => x && x.id === recipeId);
    this.setData({
      selectedRecipeId: recipeId,
      selectedRecipeName: (target && target.recipeName) || "",
      confirmVisible: true,
    });
  },

  closeSheet() {
    if (!this.data.sheetVisible) return;
    this.setData({ sheetVisible: false });
  },

  onEditSelected() {
    const recipeId = this.data.selectedRecipeId;
    this.closeSheet();
    if (!recipeId) return;
    wx.navigateTo({ url: `/pages/recipe/edit/index?recipeId=${recipeId}` });
  },

  onAskDeleteSelected() {
    this.setData({ sheetVisible: false, confirmVisible: true });
  },

  closeConfirm() {
    if (!this.data.confirmVisible) return;
    this.setData({ confirmVisible: false });
  },

  async onConfirmDelete() {
    const recipeId = this.data.selectedRecipeId;
    if (!recipeId) return;
    this.setData({ confirmVisible: false });
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

