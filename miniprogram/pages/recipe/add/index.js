const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const { resolveForImage } = require("../../../utils/cloudDisplay");

Page({
  data: {
    xiaohongshuUrl: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    familyId: null,
    ingredients: [],
    seasonings: [],
    prepareSteps: [],
    cookingSteps: [],
    isExtracting: false,
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

  onUrlInput(e) {
    this.setData({ xiaohongshuUrl: e.detail.value || "" });
  },

  onRecipeNameInput(e) {
    const recipeName = e.detail.value || "";
    this.setData({ recipeName, canImport: !!String(recipeName).trim() });
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
          const fid = uploadRes.fileID || "";
          const recipeImgDisplay = await resolveForImage(fid, {
            familyId,
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

  async onExtract() {
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    if (!String(this.data.recipeName || "").trim()) {
      wx.showToast({ title: "请先输入菜谱名称，再进行解析", icon: "none" });
      return;
    }
    if (!this.data.xiaohongshuUrl) {
      wx.showToast({ title: "请输入小红书链接", icon: "none" });
      return;
    }

    if (this.data.isExtracting) return;
    this.setData({ isExtracting: true });
    ui.showLoading("解析链接中…");
    try {
      const result = await cloud.callFunction("aiFunctions", {
        type: "extractRecipe",
        xiaohongshuUrl: this.data.xiaohongshuUrl,
        recipeName: this.data.recipeName,
      });

      if (result && result.recipeName) {
        this.setData({
          ingredients: result.ingredients || [],
          seasonings: result.seasonings || [],
          prepareSteps: result.prepareSteps || [],
          cookingSteps: result.cookingSteps || [],
        });
        wx.showToast({
          title: result.tip || (result.mock ? "已填充通用菜谱，可继续编辑" : "解析完成"),
          icon: "none",
        });
      } else {
        wx.showToast({ title: "提炼失败，请手动添加", icon: "none" });
      }
    } finally {
      ui.hideLoading();
      this.setData({ isExtracting: false });
    }
  },

  async onImportFromLocalImage() {
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    if (!String(this.data.recipeName || "").trim()) {
      wx.showToast({ title: "请先输入菜谱名称", icon: "none" });
      return;
    }
    if (this.data.isImportingImage) return;

    wx.chooseImage({
      count: 9,
      sizeType: ["original", "compressed"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const paths = (res.tempFilePaths || []).filter(Boolean);
        if (!paths.length) return;
        this.setData({ isImportingImage: true });
        wx.showLoading({ title: "请耐心等待", mask: true });
        try {
          const okPaths = [];
          for (const filePath of paths) {
            const info = await new Promise((resolve) => {
              wx.getFileInfo({
                filePath,
                success: (r) => resolve(r || null),
                fail: () => resolve(null),
              });
            });
            const size = info && info.size ? info.size : 0;
            if (size > 10 * 1024 * 1024) continue;
            okPaths.push(filePath);
          }
          if (!okPaths.length) {
            wx.showToast({ title: "所选图片均超过10MB", icon: "none" });
            return;
          }

          wx.showLoading({ title: "请耐心等待", mask: true });
          const imageFileIds = [];
          for (let i = 0; i < okPaths.length; i++) {
            const filePath = okPaths[i];
            wx.showLoading({ title: "请耐心等待", mask: true });
            const cloudPath = `imports/recipe_ocr/${this.data.familyId || "unknown"}/${Date.now()}-${i}-${Math.random()
              .toString(16)
              .slice(2)}.png`;
            const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
            if (uploadRes.fileID) imageFileIds.push(uploadRes.fileID);
          }
          if (!imageFileIds.length) throw new Error("上传失败");

          wx.showLoading({ title: "请耐心等待", mask: true });
          const result = await cloud.callFunction("aiFunctions", {
            type: "extractRecipeFromImage",
            recipeName: this.data.recipeName,
            imageFileIds,
          });

          if (result && result.recipeName) {
            this.setData({
              ingredients: result.ingredients || [],
              seasonings: result.seasonings || [],
              prepareSteps: result.prepareSteps || [],
              cookingSteps: result.cookingSteps || [],
            });
            wx.showToast({
              title: result.tip || "已导入内容，可继续编辑",
              icon: "none",
            });
          } else {
            wx.showToast({ title: "识别失败，请手动添加", icon: "none" });
          }
        } catch (e) {
          wx.showToast({ title: "导入失败，请重试", icon: "none" });
        } finally {
          wx.hideLoading();
          this.setData({ isImportingImage: false });
        }
      },
      fail: () => {
        // 用户取消
      },
    });
  },

  async onGenerateCommonRecipe() {
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    if (!String(this.data.recipeName || "").trim()) {
      wx.showToast({ title: "请先输入菜谱名称", icon: "none" });
      return;
    }
    if (this.data.isGeneratingCommon) return;
    this.setData({ isGeneratingCommon: true });
    wx.showLoading({ title: "请耐心等待", mask: true });
    try {
      // 先尝试走云端生成；若云端暂未实现则回退本地模板，保证按钮可用。
      const result = await cloud
        .callFunction("aiFunctions", {
          type: "generateCommonRecipe",
          recipeName: this.data.recipeName,
        })
        .catch(() => null);

      const payload = result && result.recipeName ? result : null;
      if (payload) {
        this.setData({
          ingredients: payload.ingredients || [],
          seasonings: payload.seasonings || [],
          prepareSteps: payload.prepareSteps || [],
          cookingSteps: payload.cookingSteps || [],
        });
        wx.showToast({ title: payload.tip || "已生成常规菜谱", icon: "none" });
        return;
      }

      this.setData({
        ingredients: [
          { name: "主食材", amount: "300g" },
          { name: "辅料", amount: "适量" },
        ],
        seasonings: [
          { name: "盐", amount: "少许" },
          { name: "生抽", amount: "1勺" },
        ],
        prepareSteps: ["清洗并处理食材", "按块/片/丝切配，备齐调料"],
        cookingSteps: ["热锅下油，先下主食材翻炒", "加入辅料和调料，翻炒至熟后出锅"],
      });
      wx.showToast({ title: "已生成家常菜模板，可继续编辑", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ isGeneratingCommon: false });
    }
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
    }, "提交中…");

    wx.showToast({ title: "提交成功", icon: "none" });
    wx.navigateBack();
  },
});

