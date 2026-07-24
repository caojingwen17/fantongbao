const cloud = require("../../../utils/cloud");
const auth = require("../../../utils/auth");
const share = require("../../../utils/share");

function normalizeNameAmountRows(arr) {
  return (Array.isArray(arr) ? arr : []).map((x) => {
    if (x == null) return { name: "", amount: "" };
    if (typeof x === "string") return { name: x, amount: "" };
    return {
      name: String(x.name != null ? x.name : "").trim(),
      amount: String(x.amount != null ? x.amount : "").trim(),
    };
  });
}

function parseTokenFromScene(options) {
  let raw = options && options.scene != null ? String(options.scene) : "";
  if (raw) {
    try {
      raw = decodeURIComponent(raw);
    } catch (e) {
      /* 已是明文 */
    }
    const m = raw.match(/^t=([a-z0-9]+)$/i);
    if (m) return m[1];
  }
  if (options && options.token) {
    return String(options.token).trim();
  }
  return "";
}

Page({
  data: {
    loading: true,
    errMsg: "",
    token: "",
    preview: null,
    ingredientCount: 0,
    prepareCount: 0,
    cookingCount: 0,
    families: [],
    familyIndex: 0,
    selectedFamilyName: "",
    selectedFamilyId: "",
    importing: false,
    /** 未登录：可浏览分享快照，导入时再登录 */
    shareGuest: false,
    expandIngredients: false,
    expandPrepare: false,
    expandCooking: false,
    ingredientRows: [],
    seasoningRows: [],
    prepareStepList: [],
    cookingStepList: [],
  },

  resolveFamilyLabel(f) {
    if (!f) return "家庭";
    return f.familyName || "未命名家庭";
  },

  syncFamilyPicker(index) {
    const app = getApp();
    const families = (app.globalData && app.globalData.families) || [];
    const i = Math.max(0, Math.min(index, Math.max(0, families.length - 1)));
    const f = families[i];
    this.setData({
      families,
      familyIndex: i,
      selectedFamilyId: f ? f._id : "",
      selectedFamilyName: this.resolveFamilyLabel(f),
    });
  },

  async onLoad(options) {
    const app = getApp();
    if (!app.globalData.pendingShareToken) app.globalData.pendingShareToken = null;

    let token = parseTokenFromScene(options);
    if (!token && app.globalData.pendingShareToken) {
      token = app.globalData.pendingShareToken;
    }
    if (token) {
      app.globalData.pendingShareToken = token;
    }

    if (!token) {
      this.setData({
        loading: false,
        errMsg: "无效的分享链接",
      });
      return;
    }

    this.setData({ token });

    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "getRecipeSharePreview",
        token,
      });
      if (!result || !result.success) {
        this.setData({
          loading: false,
          errMsg: (result && result.errMsg) || "加载失败",
        });
        return;
      }
      const p = result.preview || {};
      const ings = p.ingredients || [];
      const prep = p.prepareSteps || [];
      const cook = p.cookingSteps || [];
      const seas = p.seasonings || [];
      const ingredientRows = normalizeNameAmountRows(ings);
      const seasoningRows = normalizeNameAmountRows(seas);
      const prepareStepList = prep.map((s) => String(s == null ? "" : s).trim()).filter(Boolean);
      const cookingStepList = cook.map((s) => String(s == null ? "" : s).trim()).filter(Boolean);

      this.setData({
        loading: false,
        shareGuest: !getApp().globalData.userInfo,
        preview: p,
        ingredientCount: ings.length,
        prepareCount: prep.length,
        cookingCount: cook.length,
        ingredientRows,
        seasoningRows,
        prepareStepList,
        cookingStepList,
        expandIngredients: false,
        expandPrepare: false,
        expandCooking: false,
        families: [],
        familyIndex: 0,
        selectedFamilyId: "",
        selectedFamilyName: "",
      });

      auth.trySilentLogin().then(() => {
        const app2 = getApp();
        if (!app2.globalData.userInfo) return;
        const cid = app2.globalData.currentFamilyId;
        const fams = app2.globalData.families || [];
        let idx = 0;
        if (cid && fams.length) {
          const found = fams.findIndex((x) => x._id === cid);
          if (found >= 0) idx = found;
        }
        this.syncFamilyPicker(idx);
        this.setData({ shareGuest: false });
      }).catch(() => {});
    } catch (e) {
      this.setData({
        loading: false,
        errMsg: "网络异常，请稍后重试",
      });
    }
  },

  onShow() {
    if (this.data.loading || this.data.errMsg || !this.data.token) return;
    if (this.data.shareGuest) return;
    const fams = getApp().globalData.families || [];
    if (fams.length !== (this.data.families || []).length) {
      this.syncFamilyPicker(this.data.familyIndex || 0);
    }
  },

  onShareAppMessage() {
    const { token, preview } = this.data;
    if (!token) return share.defaultShareAppMessage();
    const name = preview && preview.recipeName ? preview.recipeName : "菜谱";
    return {
      title: `分享菜谱：${name}`,
      path: share.buildRecipeSharePath(token),
      imageUrl: (preview && preview.recipeImgDisplay) || "",
    };
  },

  onShareTimeline() {
    const { token, preview } = this.data;
    if (!token) return share.defaultShareTimeline();
    const name = preview && preview.recipeName ? preview.recipeName : "菜谱";
    return {
      title: `分享菜谱：${name}`,
      query: `token=${encodeURIComponent(token)}`,
    };
  },

  onFamilyPick(e) {
    const i = parseInt(e.detail.value, 10) || 0;
    this.syncFamilyPicker(i);
  },

  toggleShareSection(e) {
    const key = e.currentTarget.dataset.key;
    const map = {
      ing: "expandIngredients",
      prep: "expandPrepare",
      cook: "expandCooking",
    };
    const field = map[key];
    if (!field) return;
    const cur = this.data[field];
    this.setData({ [field]: !cur });
  },

  goHome() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  goFamily() {
    wx.navigateTo({ url: "/pages/family/family/index" });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login/index" });
  },

  async onImport() {
    const { token, selectedFamilyId, importing } = this.data;
    if (!token || !selectedFamilyId || importing) return;
    this.setData({ importing: true });
    try {
      const r = await cloud.callFunctionWithErrorToast("recipeFunctions", {
        type: "importSharedRecipe",
        token,
        familyId: selectedFamilyId,
      });
      wx.showToast({ title: "已加入家庭菜谱", icon: "success" });
      const id = r && r.recipeId ? r.recipeId : "";
      if (id) {
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/recipe/detail/index?recipeId=${id}`,
          });
        }, 600);
      } else {
        this.setData({ importing: false });
      }
      const app = getApp();
      app.globalData.pendingShareToken = null;
    } catch (e) {
      this.setData({ importing: false });
    }
  },
});
