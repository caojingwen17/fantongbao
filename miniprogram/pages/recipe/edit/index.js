const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const { resolveForImage } = require("../../../utils/cloudDisplay");

Page({
  data: {
    pageLoading: true,
    recipeId: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    familyId: null,
    xiaohongshuUrl: "",
    ingredients: [{ name: "", amount: "" }],
    seasonings: [{ name: "", amount: "" }],
    prepareSteps: ["备菜步骤（1）"],
    cookingSteps: ["做菜步骤（1）"],
  },

  async onLoad(options) {
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

  onRecipeNameInput(e) {
    this.setData({ recipeName: e.detail.value || "" });
  },

  onImgInput(e) {
    // 兼容手填 fileID
    this.setData({ recipeImg: e.detail.value || "" });
  },

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      success: async (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0] ? res.tempFilePaths[0] : "";
        if (!filePath) return;
        wx.showLoading({ title: "上传中..." });
        try {
          const cloudPath = `recipes/${this.data.familyId || "unknown"}/${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}.png`;
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
          const fid = uploadRes.fileID || "";
          const recipeImgDisplay = await resolveForImage(fid, {
            familyId: this.data.familyId,
          });
          this.setData({ recipeImg: fid, recipeImgDisplay: recipeImgDisplay || fid });
          wx.showToast({ title: "图片上传成功", icon: "none" });
        } catch (e) {
          wx.showToast({ title: "图片上传失败", icon: "none" });
        } finally {
          wx.hideLoading();
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

  movePrepareStepUp(e) {
    const idx = e.currentTarget.dataset.index;
    const prepareSteps = this.data.prepareSteps || [];
    if (idx <= 0) return;
    [prepareSteps[idx - 1], prepareSteps[idx]] = [prepareSteps[idx], prepareSteps[idx - 1]];
    this.setData({ prepareSteps });
  },
  movePrepareStepDown(e) {
    const idx = e.currentTarget.dataset.index;
    const prepareSteps = this.data.prepareSteps || [];
    if (idx >= prepareSteps.length - 1) return;
    [prepareSteps[idx + 1], prepareSteps[idx]] = [prepareSteps[idx], prepareSteps[idx + 1]];
    this.setData({ prepareSteps });
  },
  moveCookingStepUp(e) {
    const idx = e.currentTarget.dataset.index;
    const cookingSteps = this.data.cookingSteps || [];
    if (idx <= 0) return;
    [cookingSteps[idx - 1], cookingSteps[idx]] = [cookingSteps[idx], cookingSteps[idx - 1]];
    this.setData({ cookingSteps });
  },
  moveCookingStepDown(e) {
    const idx = e.currentTarget.dataset.index;
    const cookingSteps = this.data.cookingSteps || [];
    if (idx >= cookingSteps.length - 1) return;
    [cookingSteps[idx + 1], cookingSteps[idx]] = [cookingSteps[idx], cookingSteps[idx + 1]];
    this.setData({ cookingSteps });
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
    if (!recipeImg) {
      wx.showToast({ title: "请上传/填写菜品图片", icon: "none" });
      return;
    }

    const cleanedIngredients = (ingredients || []).filter((i) => i && i.name);
    const cleanedSeasonings = (seasonings || []).filter((s) => s && s.name);
    const cleanedPrepareSteps = (prepareSteps || []).filter((s) => String(s).trim() !== "");
    const cleanedCookingSteps = (cookingSteps || []).filter((s) => String(s).trim() !== "");

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

