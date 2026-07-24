const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
const { resolveForImage } = require("../../../utils/cloudDisplay");
const { uploadRecipeDisplayImage, notifyPublishSecError } = require("../../../utils/sec");
const haptics = require("../../../utils/haptics");
const {
  createStepItem,
  normalizeStepItems,
  getStepTexts,
  reorderStepItems,
  calcDragTargetIndex,
} = require("../../../utils/recipeSteps");

Page({
  data: {
    pastedRecipeText: "",
    pastedLen: 0,
    isExtractingFromText: false,
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
    importTab: "image",
    canImport: false,
    accordion: {
      ingredients: true,
      seasonings: false,
      prep: false,
      cook: false,
    },
    stepDrag: {
      active: false,
      listKey: "",
      index: -1,
      offsetY: 0,
      targetIndex: -1,
    },
  },

  _stepDrag: null,

  showAiLoading() {
    const c = this.selectComponent("#aiLoading");
    if (c && typeof c.show === "function") c.show();
  },

  hideAiLoading() {
    const c = this.selectComponent("#aiLoading");
    if (c && typeof c.hide === "function") c.hide();
  },

  async onLoad() {
    const ok = await auth.requireLoggedInOrBack({ content: "添加菜谱需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({ familyId: app.globalData.currentFamilyId });

    // 默认给用户一个空行，减少“空白页面编辑困难”
    this.setData({
      ingredients: [{ name: "", amount: "" }],
      seasonings: [{ name: "", amount: "" }],
      prepareSteps: normalizeStepItems(["备菜步骤（1）"]),
      cookingSteps: normalizeStepItems(["做菜步骤（1）"]),
    });
  },

  toggleAccordion(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : "";
    if (!key) return;
    const next = { ...(this.data.accordion || {}) };
    next[key] = !next[key];
    this.setData({ accordion: next });
  },

  onImportTabChange(e) {
    const tab = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.tab : "";
    if (!tab || tab === this.data.importTab) return;
    this.setData({ importTab: tab });
  },

  onPastedRecipeTextInput(e) {
    const v = e.detail.value || "";
    this.setData({ pastedRecipeText: v, pastedLen: v.length });
  },

  onRecipeNameInput(e) {
    const recipeName = e.detail.value || "";
    this.setData({ recipeName, canImport: !!String(recipeName).trim() });
  },

  onChooseImage() {
    wx.chooseImage({
      count: 1,
      success: (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0] ? res.tempFilePaths[0] : "";
        if (!filePath) return;
        const cropper = this.selectComponent("#cropper");
        if (cropper) cropper.open({ src: filePath });
      },
    });
  },

  async onCropConfirm(e) {
    const filePath = e && e.detail && e.detail.tempFilePath ? e.detail.tempFilePath : "";
    if (!filePath) return;
    const app = getApp();
    const familyId = this.data.familyId || app.globalData.currentFamilyId;
    if (!familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    ui.showLoading("检测中…", true);
    try {
      const fid = await uploadRecipeDisplayImage(filePath, familyId);
      const recipeImgDisplay = await resolveForImage(fid, { familyId });
      this.setData({ recipeImg: fid, recipeImgDisplay });
      ui.hideLoading();
      wx.showToast({ title: "图片上传成功", icon: "none" });
    } catch (err) {
      notifyPublishSecError(err);
    }
  },

  onCropCancel() {},

  async onExtractFromPastedText() {
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    if (!String(this.data.recipeName || "").trim()) {
      wx.showToast({ title: "请先输入菜名", icon: "none" });
      return;
    }
    const raw = String(this.data.pastedRecipeText || "").trim();
    if (raw.length < 8) {
      wx.showToast({ title: "请先粘贴足够长的做法文案", icon: "none" });
      return;
    }
    if (this.data.isExtractingFromText) return;
    this.setData({ isExtractingFromText: true });
    this.showAiLoading();
    try {
      const result = await cloud.callFunction("aiFunctions", {
        type: "extractRecipeFromText",
        recipeName: this.data.recipeName,
        pastedText: raw,
        familyId: this.data.familyId,
      });

      if (result && result.recipeName) {
        this.setData({
          ingredients: result.ingredients || [],
          seasonings: result.seasonings || [],
          prepareSteps: normalizeStepItems(result.prepareSteps || []),
          cookingSteps: normalizeStepItems(result.cookingSteps || []),
        });
        haptics.medium();
        wx.showToast({
          title: result.tip || "已填充，可继续编辑",
          icon: "none",
        });
      } else {
        wx.showToast({ title: "提炼失败，请手动添加", icon: "none" });
      }
    } catch (e) {
      const msg =
        (e && e.message) ||
        (e && e.errMsg) ||
        "提炼失败，请稍后重试";
      wx.showToast({ title: String(msg).slice(0, 32), icon: "none" });
    } finally {
      this.hideAiLoading();
      this.setData({ isExtractingFromText: false });
    }
  },

  /* 小红书链接 onExtract 已移除；需要时从 git 恢复并对接 aiFunctions.extractRecipe */

  compressImagePath(filePath) {
    return new Promise((resolve) => {
      wx.getFileInfo({
        filePath,
        success: (info) => {
          const size = (info && info.size) || 0;
          if (size <= 400 * 1024 || typeof wx.compressImage !== "function") {
            resolve(filePath);
            return;
          }
          wx.compressImage({
            src: filePath,
            quality: 60,
            success: (r) => resolve((r && r.tempFilePath) || filePath),
            fail: () => resolve(filePath),
          });
        },
        fail: () => resolve(filePath),
      });
    });
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
      count: 6,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: async (res) => {
        const paths = (res.tempFilePaths || []).filter(Boolean);
        if (!paths.length) return;
        if (paths.length > 6) {
          wx.showToast({ title: "最多选择 6 张以加快识别", icon: "none" });
        }
        this.setData({ isImportingImage: true });
        this.showAiLoading();
        try {
          const sizeChecks = await Promise.all(
            paths.map(
              (filePath) =>
                new Promise((resolve) => {
                  wx.getFileInfo({
                    filePath,
                    success: (r) => resolve({ filePath, size: (r && r.size) || 0 }),
                    fail: () => resolve({ filePath, size: 0 }),
                  });
                })
            )
          );
          const validPaths = sizeChecks
            .filter((x) => x.size <= 10 * 1024 * 1024)
            .map((x) => x.filePath);
          if (!validPaths.length) {
            wx.showToast({ title: "所选图片均超过10MB", icon: "none" });
            return;
          }
          const okPaths = await Promise.all(validPaths.map((p) => this.compressImagePath(p)));

          const familyId = this.data.familyId || "unknown";
          const stamp = Date.now();
          const fileIds = (
            await Promise.all(
              okPaths.map((filePath, i) => {
                const cloudPath = `imports/recipe_ocr/${familyId}/${stamp}-${i}-${Math.random()
                  .toString(16)
                  .slice(2)}.jpg`;
                return wx.cloud
                  .uploadFile({ cloudPath, filePath })
                  .then((up) => (up && up.fileID ? up.fileID : ""))
                  .catch(() => "");
              })
            )
          ).filter(Boolean);
          if (!fileIds.length) throw new Error("上传失败");

          const result = await cloud.callFunction("aiFunctions", {
            type: "extractRecipeFromImage",
            recipeName: this.data.recipeName,
            imageFileIds: fileIds,
            familyId: this.data.familyId,
          });

          if (result && result.recipeName) {
            this.setData({
              ingredients: result.ingredients || [],
              seasonings: result.seasonings || [],
              prepareSteps: normalizeStepItems(result.prepareSteps || []),
              cookingSteps: normalizeStepItems(result.cookingSteps || []),
            });
            const tip =
              result.tip ||
              (result.mock ? "识别未完全成功，请核对后编辑" : "已导入内容，可继续编辑");
            haptics.medium();
            wx.showToast({
              title: tip.length > 28 ? tip.slice(0, 28) + "…" : tip,
              icon: "none",
              duration: result.mock ? 4500 : 2500,
            });
            if (result.mock && tip.length > 28) {
              wx.showModal({
                title: "识别提示",
                content: tip,
                showCancel: false,
                confirmText: "知道了",
              });
            }
          } else {
            wx.showToast({ title: "识别失败，请手动添加", icon: "none" });
          }
        } catch (e) {
          const msg =
            (e && e.message) ||
            (e && e.errMsg) ||
            "导入失败，请重试";
          wx.showToast({ title: String(msg).slice(0, 36), icon: "none", duration: 4000 });
          console.error("[recipe/add] import image failed:", e);
        } finally {
          this.hideAiLoading();
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
    this.showAiLoading();
    try {
      // 先尝试走云端生成；若云端暂未实现则回退本地模板，保证按钮可用。
      const result = await cloud
        .callFunction("aiFunctions", {
          type: "generateCommonRecipe",
          recipeName: this.data.recipeName,
          familyId: this.data.familyId,
        })
        .catch(() => null);

      const payload = result && result.recipeName ? result : null;
      if (payload) {
        this.setData({
          ingredients: payload.ingredients || [],
          seasonings: payload.seasonings || [],
          prepareSteps: normalizeStepItems(payload.prepareSteps || []),
          cookingSteps: normalizeStepItems(payload.cookingSteps || []),
        });
        haptics.medium();
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
        prepareSteps: normalizeStepItems(["清洗并处理食材", "按块/片/丝切配，备齐调料"]),
        cookingSteps: normalizeStepItems(["热锅下油，先下主食材翻炒", "加入辅料和调料，翻炒至熟后出锅"]),
      });
      wx.showToast({ title: "已生成家常菜模板，可继续编辑", icon: "none" });
    } finally {
      this.hideAiLoading();
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
    const prepareSteps = [...(this.data.prepareSteps || [])];
    if (!prepareSteps[idx]) return;
    prepareSteps[idx] = { ...prepareSteps[idx], text: e.detail.value || "" };
    this.setData({ prepareSteps });
  },
  onCookingStepInput(e) {
    const idx = e.currentTarget.dataset.index;
    const cookingSteps = [...(this.data.cookingSteps || [])];
    if (!cookingSteps[idx]) return;
    cookingSteps[idx] = { ...cookingSteps[idx], text: e.detail.value || "" };
    this.setData({ cookingSteps });
  },

  addPrepareStep() {
    const prepareSteps = [...(this.data.prepareSteps || [])];
    prepareSteps.push(createStepItem(""));
    this.setData({ prepareSteps });
  },
  addCookingStep() {
    const cookingSteps = [...(this.data.cookingSteps || [])];
    cookingSteps.push(createStepItem(""));
    this.setData({ cookingSteps });
  },
  removePrepareStep(e) {
    const idx = e.currentTarget.dataset.index;
    const prepareSteps = [...(this.data.prepareSteps || [])];
    prepareSteps.splice(idx, 1);
    this.setData({ prepareSteps: prepareSteps.length ? prepareSteps : [createStepItem("")] });
  },
  removeCookingStep(e) {
    const idx = e.currentTarget.dataset.index;
    const cookingSteps = [...(this.data.cookingSteps || [])];
    cookingSteps.splice(idx, 1);
    this.setData({ cookingSteps: cookingSteps.length ? cookingSteps : [createStepItem("")] });
  },

  onStepDragStart(e) {
    const listKey = e.currentTarget.dataset.list;
    const index = Number(e.currentTarget.dataset.index);
    if (!listKey || Number.isNaN(index)) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    const className = listKey === "prepareSteps" ? ".js-prep-step" : ".js-cook-step";
    wx.createSelectorQuery()
      .in(this)
      .selectAll(className)
      .boundingClientRect()
      .exec((res) => {
        const rects = (res && res[0]) || [];
        if (!rects.length || !rects[index]) return;
        this._stepDrag = {
          listKey,
          fromIndex: index,
          startY: touch.clientY,
          rects,
        };
        haptics.light();
        this.setData({
          stepDrag: {
            active: true,
            listKey,
            index,
            offsetY: 0,
            targetIndex: index,
          },
        });
      });
  },

  onStepDragMove(e) {
    if (!this._stepDrag || !this.data.stepDrag.active) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;

    const { listKey, fromIndex, startY, rects } = this._stepDrag;
    const offsetY = touch.clientY - startY;
    const targetIndex = calcDragTargetIndex(rects, touch.clientY, fromIndex);
    if (
      this.data.stepDrag.offsetY === offsetY &&
      this.data.stepDrag.targetIndex === targetIndex
    ) {
      return;
    }
    this.setData({
      "stepDrag.offsetY": offsetY,
      "stepDrag.targetIndex": targetIndex,
    });
  },

  onStepDragEnd() {
    if (!this._stepDrag || !this.data.stepDrag.active) {
      this._stepDrag = null;
      return;
    }
    const { listKey, fromIndex } = this._stepDrag;
    const targetIndex = this.data.stepDrag.targetIndex;
    const items = this.data[listKey] || [];
    const next = reorderStepItems(items, fromIndex, targetIndex);

    this._stepDrag = null;
    this.setData({
      [listKey]: next,
      stepDrag: {
        active: false,
        listKey: "",
        index: -1,
        offsetY: 0,
        targetIndex: -1,
      },
    });
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
    const cleanedPrepareSteps = getStepTexts(prepareSteps).filter((s) => String(s).trim() !== "");
    const cleanedCookingSteps = getStepTexts(cookingSteps).filter((s) => String(s).trim() !== "");

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
        xiaohongshuUrl: "",
        ingredients: cleanedIngredients,
        seasonings: cleanedSeasonings,
        prepareSteps: cleanedPrepareSteps,
        cookingSteps: cleanedCookingSteps,
      });
    }, "提交中…");

    haptics.success();
    wx.showToast({ title: "提交成功", icon: "none" });
    wx.navigateBack();
  },
});

