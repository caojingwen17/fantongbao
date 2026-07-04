const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const { resolveForImage } = require("../../../utils/cloudDisplay");
const { uploadRecipeDisplayImage, notifyPublishSecError } = require("../../../utils/sec");

Page({
  data: {
    pageLoading: true,
    recipeId: "",
    xiaohongshuUrl: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    familyId: null,
    ingredients: [],
    seasonings: [],
    prepareSteps: [],
    cookingSteps: [],
    isImportingImage: false,
    isGeneratingCommon: false,
    canImport: false,
    accordion: {
      ingredients: true,
      seasonings: false,
      prep: false,
      cook: false,
    },
  },

  async onLoad(options) {
    const ok = await auth.requireLoggedInOrBack({ content: "编辑菜谱需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({
      familyId: app.globalData.currentFamilyId,
      recipeId: options && options.recipeId ? options.recipeId : "",
    });

    if (!this.data.recipeId) {
      this.setData({ pageLoading: false });
      return;
    }

    try {
      const result = await cloud.callFunction("recipeFunctions", {
        type: "getRecipe",
        recipeId: this.data.recipeId,
      });
      if (result && result.recipe) {
        const r = result.recipe;
        const recipeImg = r.recipeImg || "";
        const recipeImgDisplay = await resolveForImage(recipeImg, {
          familyId: r.familyId || this.data.familyId,
        });
        this.setData({
          recipeName: r.recipeName || "",
          recipeImg,
          recipeImgDisplay: recipeImgDisplay || recipeImg,
          xiaohongshuUrl: r.xiaohongshuUrl || "",
          canImport: !!String(r.recipeName || "").trim(),
          ingredients: r.ingredients && r.ingredients.length ? r.ingredients : [{ name: "", amount: "" }],
          seasonings: r.seasonings || [{ name: "", amount: "" }],
          prepareSteps: r.prepareSteps && r.prepareSteps.length ? r.prepareSteps : ["备菜步骤（1）"],
          cookingSteps: r.cookingSteps && r.cookingSteps.length ? r.cookingSteps : ["做菜步骤（1）"],
        });
      }
    } catch (e) {
      // ignore
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  onBack() {
    wx.navigateBack();
  },

  toggleAccordion(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : "";
    if (!key) return;
    const next = { ...(this.data.accordion || {}) };
    next[key] = !next[key];
    this.setData({ accordion: next });
  },

  onRecipeNameInput(e) {
    const recipeName = e.detail.value || "";
    this.setData({ recipeName, canImport: !!String(recipeName).trim() });
  },

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      success: async (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0] ? res.tempFilePaths[0] : "";
        if (!filePath) return;
        if (!this.data.familyId) {
          wx.showToast({ title: "请先选择家庭", icon: "none" });
          return;
        }
        ui.showLoading("检测中…", true);
        try {
          const fid = await uploadRecipeDisplayImage(filePath, this.data.familyId);
          const recipeImgDisplay = await resolveForImage(fid, {
            familyId: this.data.familyId,
          });
          this.setData({ recipeImg: fid, recipeImgDisplay: recipeImgDisplay || fid });
          ui.hideLoading();
          wx.showToast({ title: "图片上传成功", icon: "none" });
        } catch (e) {
          notifyPublishSecError(e);
        }
      },
    });
  },

  // 食材
  onIngredientNameInput(e) {
    const idx = e.currentTarget.dataset.index;
    const ingredients = this.data.ingredients || [];
    ingredients[idx].name = e.detail.value || "";
    this.setData({ ingredients });
  },
  onIngredientAmountInput(e) {
    const idx = e.currentTarget.dataset.index;
    const ingredients = this.data.ingredients || [];
    ingredients[idx].amount = e.detail.value || "";
    this.setData({ ingredients });
  },
  addIngredient() {
    const ingredients = this.data.ingredients || [];
    ingredients.push({ name: "", amount: "" });
    this.setData({ ingredients });
  },
  removeIngredient(e) {
    const idx = e.currentTarget.dataset.index;
    const ingredients = this.data.ingredients || [];
    ingredients.splice(idx, 1);
    this.setData({ ingredients: ingredients.length ? ingredients : [{ name: "", amount: "" }] });
  },

  // 调料
  onSeasoningNameInput(e) {
    const idx = e.currentTarget.dataset.index;
    const seasonings = this.data.seasonings || [];
    seasonings[idx].name = e.detail.value || "";
    this.setData({ seasonings });
  },
  onSeasoningAmountInput(e) {
    const idx = e.currentTarget.dataset.index;
    const seasonings = this.data.seasonings || [];
    seasonings[idx].amount = e.detail.value || "";
    this.setData({ seasonings });
  },
  addSeasoning() {
    const seasonings = this.data.seasonings || [];
    seasonings.push({ name: "", amount: "" });
    this.setData({ seasonings });
  },
  removeSeasoning(e) {
    const idx = e.currentTarget.dataset.index;
    const seasonings = this.data.seasonings || [];
    seasonings.splice(idx, 1);
    this.setData({ seasonings: seasonings.length ? seasonings : [{ name: "", amount: "" }] });
  },

  // 步骤
  onPrepareStepInput(e) {
    const idx = e.currentTarget.dataset.index;
    const prepareSteps = this.data.prepareSteps || [];
    prepareSteps[idx] = e.detail.value || "";
    this.setData({ prepareSteps });
  },
  onCookingStepInput(e) {
    const idx = e.currentTarget.dataset.index;
    const cookingSteps = this.data.cookingSteps || [];
    cookingSteps[idx] = e.detail.value || "";
    this.setData({ cookingSteps });
  },

  addPrepareStep() {
    const prepareSteps = this.data.prepareSteps || [];
    prepareSteps.push("");
    this.setData({ prepareSteps });
  },
  addCookingStep() {
    const cookingSteps = this.data.cookingSteps || [];
    cookingSteps.push("");
    this.setData({ cookingSteps });
  },
  removePrepareStep(e) {
    const idx = e.currentTarget.dataset.index;
    const prepareSteps = this.data.prepareSteps || [];
    prepareSteps.splice(idx, 1);
    this.setData({ prepareSteps: prepareSteps.length ? prepareSteps : [""] });
  },
  removeCookingStep(e) {
    const idx = e.currentTarget.dataset.index;
    const cookingSteps = this.data.cookingSteps || [];
    cookingSteps.splice(idx, 1);
    this.setData({ cookingSteps: cookingSteps.length ? cookingSteps : [""] });
  },

  async onSubmit() {
    const {
      recipeId,
      recipeName,
      recipeImg,
      ingredients,
      seasonings,
      prepareSteps,
      cookingSteps,
      xiaohongshuUrl,
    } = this.data;

    if (!recipeId) {
      wx.showToast({ title: "缺少 recipeId", icon: "none" });
      return;
    }
    if (!recipeName) {
      wx.showToast({ title: "请填写菜名", icon: "none" });
      return;
    }
    const cleanedIngredients = (ingredients || []).filter((i) => i && i.name);
    const cleanedSeasonings = (seasonings || []).filter((s) => s && s.name);
    const cleanedPrepareSteps = (prepareSteps || []).filter((s) => s !== undefined && String(s).trim() !== "");
    const cleanedCookingSteps = (cookingSteps || []).filter((s) => s !== undefined && String(s).trim() !== "");

    if (!cleanedIngredients.length) {
      wx.showToast({ title: "至少填写1种食材", icon: "none" });
      return;
    }
    if (!cleanedPrepareSteps.length || !cleanedCookingSteps.length) {
      wx.showToast({ title: "备菜和做菜步骤都至少填写1条", icon: "none" });
      return;
    }

    await ui.withLoading(async () => {
      await cloud.callFunctionWithErrorToast("recipeFunctions", {
        type: "updateRecipe",
        recipeId,
        recipeName,
        recipeImg,
        xiaohongshuUrl: xiaohongshuUrl || "",
        ingredients: cleanedIngredients,
        seasonings: cleanedSeasonings,
        prepareSteps: cleanedPrepareSteps,
        cookingSteps: cleanedCookingSteps,
      });
    }, "保存中…");

    wx.showToast({ title: "保存成功", icon: "none" });
    wx.navigateBack();
  },
});

