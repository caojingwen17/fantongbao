const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const auth = require("../../../utils/auth");
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
    /** 封面已重新上传但未保存（仅本地预览，点「保存修改」才落库） */
    coverDirty: false,
    accordion: {
      ingredients: true,
      seasonings: true,
      prep: true,
      cook: true,
    },
    stepDrag: {
      active: false,
      listKey: "",
      index: -1,
      offsetY: 0,
      targetIndex: -1,
      shiftY: [],
    },
    /** 当前编辑中的步骤输入框（listKey-index），失焦切回纯文本展示 */
    stepFocusKey: "",
    /** 编辑态 textarea 的估算高度（px） */
    stepFocusHeight: 60,
    /** 键盘高度（px），>0 时用于撑开底部留白并滚动定位 */
    keyboardHeight: 0,
    /** scroll-view 的 scroll-top 定位值，聚焦步骤时仅滚动到键盘上方所需的最小距离 */
    stepScrollTop: 0,
  },

  onStepFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const list = ds.list;
    const index = Number(ds.index);
    const items = this.data[list] || [];
    const text = (items[index] && items[index].text) || "";
    this.setData({
      stepFocusKey: `${list}-${index}`,
      stepFocusHeight: this.estimateStepHeight(text),
    });
    // 键盘已弹出时（从一行切到另一行），keyboardheightchange 不会再触发，这里直接定位
    if (this.data.keyboardHeight > 0) {
      setTimeout(() => this._scrollFocusedStepAboveKeyboard(), 100);
    }
  },

  /**
   * 键盘弹出时把聚焦的步骤行滚动到键盘上方：
   * 只滚「被键盘遮住的距离 + 间距」，未被遮挡则不滚动。
   */
  _scrollFocusedStepAboveKeyboard() {
    const key = this.data.stepFocusKey;
    const kb = this.data.keyboardHeight;
    if (!key || kb <= 0) return;
    const win = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const keyboardTop = (win.windowHeight || 667) - kb;
    const margin = 12; // 输入框底部与键盘顶部的间距(px)
    wx.createSelectorQuery()
      .in(this)
      .select("#step-row-" + key)
      .boundingClientRect()
      .select(".main")
      .scrollOffset()
      .exec((res) => {
        const rect = res && res[0];
        const offset = res && res[1];
        if (!rect || !offset) return;
        const overflow = rect.bottom - (keyboardTop - margin);
        if (overflow <= 0) return; // 未被键盘遮挡，不滚动
        this.setData({ stepScrollTop: offset.scrollTop + overflow });
      });
  },

  onStepBlur() {
    this.setData({ stepFocusKey: "" });
  },

  /**
   * 按文本估算编辑态高度（px）：iOS 原生 textarea 的 auto-height 会算错，
   * 这里按行数估算。输入框实际可用宽度约 15 字/行，估算取更窄值并加行高余量，
   * 保证聚焦态高度 ≥ 失焦展示高度，切换不「缩水」。
   */
  estimateStepHeight(text) {
    const lines = String(text || "")
      .split("\n")
      .reduce((acc, s) => acc + Math.max(1, Math.ceil(s.length / 15)), 0);
    const clamped = Math.min(Math.max(lines, 1), 10);
    const win = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const rpx = (win.windowWidth || 375) / 750;
    return Math.max(Math.round(96 * rpx), Math.round((clamped * 38 + 60) * rpx));
  },

  _stepDrag: null,

  onUnload() {
    if (this._onKeyboardHeight && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this._onKeyboardHeight);
    }
    this._onKeyboardHeight = null;
  },

  async onLoad(options) {
    const ok = await auth.requireLoggedInOrBack({ content: "编辑菜谱需要先登录。" });
    if (!ok) return;
    const app = getApp();
    this.setData({
      familyId: app.globalData.currentFamilyId,
      recipeId: options && options.recipeId ? options.recipeId : "",
    });

    // 键盘弹出时：撑开底部留白，并把正在编辑的步骤行滚动到键盘上方
    this._onKeyboardHeight = (res) => {
      const h = (res && res.height) || 0;
      this.setData({ keyboardHeight: h });
      if (h > 0) {
        setTimeout(() => this._scrollFocusedStepAboveKeyboard(), 60);
      }
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this._onKeyboardHeight);
    }

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
        // 封面由 ft-cloud-image 组件按 recipeImg 自行解析换链，无需页面预解析
        this.setData({
          recipeName: r.recipeName || "",
          recipeImg,
          xiaohongshuUrl: r.xiaohongshuUrl || "",
          canImport: !!String(r.recipeName || "").trim(),
          ingredients: r.ingredients && r.ingredients.length ? r.ingredients : [{ name: "", amount: "" }],
          seasonings: r.seasonings || [{ name: "", amount: "" }],
          prepareSteps: normalizeStepItems(
            r.prepareSteps && r.prepareSteps.length ? r.prepareSteps : ["备菜步骤（1）"]
          ),
          cookingSteps: normalizeStepItems(
            r.cookingSteps && r.cookingSteps.length ? r.cookingSteps : ["做菜步骤（1）"]
          ),
        });
      }
    } catch (e) {
      // ignore
    } finally {
      this.setData({ pageLoading: false });
    }
  },


  toggleAccordion(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : "";
    if (!key) return;
    const next = { ...(this.data.accordion || {}) };
    next[key] = !next[key];
    this.setData({ accordion: next });
  },

  /** 校验失败：展开对应分组并滚动过去 */
  _scrollToSection(key) {
    const next = { ...(this.data.accordion || {}), [key]: true };
    this.setData({ accordion: next });
    setTimeout(() => {
      wx.pageScrollTo({ selector: `#acc-${key}`, duration: 220 });
    }, 80);
  },

  /** 上传展示图：未填菜名时给出提示 */
  onTapCoverUpload() {
    if (!this.data.canImport) {
      wx.showToast({ title: "请先填写菜名", icon: "none" });
      return;
    }
    this.onChooseImage();
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
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    ui.showLoading("检测中…", true);
    try {
      const fid = await uploadRecipeDisplayImage(filePath, this.data.familyId);
      // 用本地裁切图立即回显：刚上传的文件 CDN 可能未生效
      // 注意：此处只更新表单状态，不落库；用户点「保存修改」时才随其他字段一起提交
      this.setData({ recipeImg: fid, recipeImgDisplay: filePath, coverDirty: true });
      ui.hideLoading();
      wx.showToast({ title: "已替换，保存后生效", icon: "none" });
    } catch (err) {
      notifyPublishSecError(err);
    }
  },

  onCropCancel() {},

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
    haptics.light();
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
    haptics.light();
    const idx = e.currentTarget.dataset.index;
    const seasonings = this.data.seasonings || [];
    seasonings.splice(idx, 1);
    this.setData({ seasonings: seasonings.length ? seasonings : [{ name: "", amount: "" }] });
  },

  // 步骤
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
    haptics.light();
    const idx = e.currentTarget.dataset.index;
    const prepareSteps = [...(this.data.prepareSteps || [])];
    prepareSteps.splice(idx, 1);
    this.setData({ prepareSteps: prepareSteps.length ? prepareSteps : [createStepItem("")] });
  },
  removeCookingStep(e) {
    haptics.light();
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

    const { fromIndex, rects } = this._stepDrag;
    const offsetY = touch.clientY - this._stepDrag.startY;
    const targetIndex = calcDragTargetIndex(rects, touch.clientY, fromIndex);

    const update = {};
    if (this.data.stepDrag.offsetY !== offsetY) {
      update["stepDrag.offsetY"] = offsetY;
    }
    if (this.data.stepDrag.targetIndex !== targetIndex) {
      update["stepDrag.targetIndex"] = targetIndex;
      update["stepDrag.shiftY"] = this._computeShiftY(fromIndex, targetIndex, rects);
    }
    if (Object.keys(update).length) this.setData(update);
  },

  /** 其他行让位位移：被拖行高度 + 行间距，介于 from 与 target 之间的行反向平移 */
  _computeShiftY(fromIndex, targetIndex, rects) {
    const win = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const gapPx = (18 * (win.windowWidth || 375)) / 750;
    const rowH = ((rects[fromIndex] && rects[fromIndex].height) || 60) + gapPx;
    return (rects || []).map((_, i) => {
      if (i === fromIndex) return 0;
      if (fromIndex < targetIndex && i > fromIndex && i <= targetIndex) return -rowH;
      if (targetIndex < fromIndex && i >= targetIndex && i < fromIndex) return rowH;
      return 0;
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
        shiftY: [],
      },
    });
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
    const cleanedPrepareSteps = getStepTexts(prepareSteps).filter((s) => String(s).trim() !== "");
    const cleanedCookingSteps = getStepTexts(cookingSteps).filter((s) => String(s).trim() !== "");

    if (!cleanedIngredients.length) {
      this._scrollToSection("ingredients");
      wx.showToast({ title: "至少填写1种食材", icon: "none" });
      return;
    }
    if (!cleanedPrepareSteps.length || !cleanedCookingSteps.length) {
      this._scrollToSection(cleanedPrepareSteps.length ? "cook" : "prep");
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

    haptics.success();
    wx.showToast({ title: "保存成功", icon: "none" });
    wx.navigateBack();
  },
});

