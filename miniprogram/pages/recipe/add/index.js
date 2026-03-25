const cloud = require("../../../utils/cloud");

Page({
  data: {
    xiaohongshuUrl: "",
    recipeName: "",
    recipeImg: "",
    familyId: null,
    ingredients: [],
    seasonings: [],
    prepareSteps: [],
    cookingSteps: [],
    isExtracting: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });

    // 默认给用户一个空行，减少“空白页面编辑困难”
    this.setData({
      ingredients: [{ name: "", amount: "" }],
      seasonings: [{ name: "", amount: "" }],
      prepareSteps: ["备菜步骤（1）"],
      cookingSteps: ["做菜步骤（1）"],
    });
  },

  onUrlInput(e) {
    this.setData({ xiaohongshuUrl: e.detail.value || "" });
  },

  onRecipeNameInput(e) {
    this.setData({ recipeName: e.detail.value || "" });
  },

  onImgInput(e) {
    // 兼容你之前的占位输入：允许直接填 fileID
    this.setData({ recipeImg: e.detail.value || "" });
  },

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      success: async (res) => {
        const app = getApp();
        const familyId = this.data.familyId || app.globalData.currentFamilyId;
        const filePath = res.tempFilePaths && res.tempFilePaths[0] ? res.tempFilePaths[0] : "";
        if (!filePath) return;
        wx.showLoading({ title: "上传中..." });
        try {
          const cloudPath = `recipes/${familyId || "unknown"}/${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}.png`;
          const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
          this.setData({ recipeImg: uploadRes.fileID || "" });
          wx.showToast({ title: "图片上传成功", icon: "none" });
        } catch (e) {
          wx.showToast({ title: "图片上传失败", icon: "none" });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  async onGenerateImage() {
    if (!this.data.recipeName) {
      wx.showToast({ title: "请先填写菜名", icon: "none" });
      return;
    }
    try {
      wx.showLoading({ title: "AI生成中..." });
      const result = await cloud.callFunction("aiFunctions", {
        type: "generateRecipeImage",
        recipeName: this.data.recipeName,
      });
      if (result && result.recipeImg) {
        this.setData({ recipeImg: result.recipeImg });
        wx.showToast({ title: "AI图片已生成", icon: "none" });
      } else {
        wx.showToast({ title: "当前为占位实现，无法生成图片", icon: "none" });
      }
    } catch (e) {
      wx.showToast({ title: "图片生成失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  async onExtract() {
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    if (!this.data.xiaohongshuUrl) {
      wx.showToast({ title: "请输入小红书链接", icon: "none" });
      return;
    }

    if (this.data.isExtracting) return;
    this.setData({ isExtracting: true });
    const result = await cloud.callFunction("aiFunctions", {
      type: "extractRecipe",
      xiaohongshuUrl: this.data.xiaohongshuUrl,
    });

    if (result && result.recipeName) {
      this.setData({
        recipeName: result.recipeName || "",
        ingredients: result.ingredients || [],
        seasonings: result.seasonings || [],
        prepareSteps: result.prepareSteps || [],
        cookingSteps: result.cookingSteps || [],
      });
      wx.showToast({
        title: result.mock ? "已填充示例数据，可继续编辑" : "提炼完成",
        icon: "none",
      });
    } else {
      wx.showToast({ title: "提炼失败，请手动添加", icon: "none" });
    }
    this.setData({ isExtracting: false });
  },

  // ---------- 食材/调料增删改 ----------
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

  // ---------- 步骤增删改 ----------
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
      familyId,
      recipeName,
      recipeImg,
      ingredients,
      seasonings,
      prepareSteps,
      cookingSteps,
      xiaohongshuUrl,
    } = this.data;

    if (!familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
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

    await cloud.callFunctionWithErrorToast("recipeFunctions", {
      type: "addRecipe",
      familyId,
      recipeName,
      recipeImg,
      xiaohongshuUrl: xiaohongshuUrl || "",
      ingredients: cleanedIngredients,
      seasonings: cleanedSeasonings,
      prepareSteps: cleanedPrepareSteps,
      cookingSteps: cleanedCookingSteps,
    });

    wx.showToast({ title: "提交成功", icon: "none" });
    wx.navigateBack();
  },
});

