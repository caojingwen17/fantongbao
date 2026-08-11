const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");

const KEYWORD_DEBOUNCE_MS = 320;
const PAGE_SIZE = 30;

Page({
  data: {
    keyword: "",
    recipes: [],
    viewRecipes: [],
    familyId: null,
    listLoading: false,
    refreshing: false,
    /** 分页：是否还有下一页 / 是否正在加载更多 */
    hasMore: false,
    loadingMore: false,
    sheetVisible: false,
    selectedRecipeId: "",
    selectedRecipeName: "",
    confirmModal: {
      visible: false,
      kicker: "",
      title: "",
      content: "",
      confirmText: "确认",
      danger: false,
    },
  },

  openConfirm(opts, action) {
    this._confirmAction = action || null;
    this.setData({
      confirmModal: {
        visible: true,
        kicker: opts.kicker || "",
        title: opts.title || "",
        content: opts.content || "",
        confirmText: opts.confirmText || "确认",
        danger: !!opts.danger,
      },
    });
  },

  async onConfirmModalOk() {
    const action = this._confirmAction;
    this._confirmAction = null;
    this.setData({ "confirmModal.visible": false });
    if (action) await action();
  },

  onConfirmModalCancel() {
    this._confirmAction = null;
    this.setData({ "confirmModal.visible": false });
  },

  async onLoad() {
    const ok = await auth.requireLoggedInOrBack({ content: "查看家庭菜谱需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });
  },

  onUnload() {
    clearTimeout(this._keywordTimer);
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/pages/index/index" }),
    });
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.fetchRecipes();
    } finally {
      this.setData({ refreshing: false });
    }
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
    return (raw || []).map((item) => {
      const time = item && item.createTime ? item.createTime : "";
      const createDateText = this.formatDate(time);
      return {
        ...item,
        createDateText,
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
        lite: true,
        skip: 0,
        limit: PAGE_SIZE,
      });
      const raw = result && result.recipes ? result.recipes : [];
      // 图片由 ft-cloud-image 组件各自解析/自愈，列表直接渲染原始数据
      this.setData({
        recipes: raw,
        viewRecipes: this.buildViewRecipes(raw),
        hasMore: !!(result && result.hasMore),
      });
    } catch (e) {
      // 已由封装处理提示
    } finally {
      this.setData({ listLoading: false });
    }
  },

  /** 滚动到底加载下一页 */
  async loadMoreRecipes() {
    const { familyId, listLoading, loadingMore, hasMore, recipes } = this.data;
    if (!familyId || listLoading || loadingMore || !hasMore) return;
    this.setData({ loadingMore: true });
    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "listRecipes",
        familyId,
        keyword: this.data.keyword,
        lite: true,
        skip: (recipes || []).length,
        limit: PAGE_SIZE,
      });
      const raw = result && result.recipes ? result.recipes : [];
      if (raw.length) {
        const merged = (recipes || []).concat(raw);
        this.setData({
          recipes: merged,
          viewRecipes: this.buildViewRecipes(merged),
        });
      }
      this.setData({ hasMore: !!(result && result.hasMore) });
    } catch (e) {
      // 已由封装处理提示
    } finally {
      this.setData({ loadingMore: false });
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
    });
    this.askDeleteSelected();
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
    this.setData({ sheetVisible: false });
    this.askDeleteSelected();
  },

  askDeleteSelected() {
    const recipeId = this.data.selectedRecipeId;
    if (!recipeId) return;
    this.openConfirm(
      {
        kicker: "确认删除",
        title: "删除后不可恢复",
        content: `你确定要删除「${this.data.selectedRecipeName}」吗？`,
        confirmText: "删除",
        danger: true,
      },
      async () => {
        await ui.withLoading(async () => {
          await cloud.callFunctionWithErrorToast("recipeFunctions", {
            type: "deleteRecipe",
            recipeId,
          });
        }, "删除中…");
        wx.showToast({ title: "删除成功", icon: "none" });
        await this.fetchRecipes();
      }
    );
  },
});

