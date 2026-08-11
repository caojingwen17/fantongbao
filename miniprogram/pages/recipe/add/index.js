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
    pastedRecipeText: "",
    pastedLen: 0,
    isExtractingFromText: false,
    linkText: "",
    linkLen: 0,
    isExtractingFromLink: false,
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
    importTab: "link",
    canImport: false,
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
  },

  onUnload() {
    if (this._onKeyboardHeight && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this._onKeyboardHeight);
    }
    this._onKeyboardHeight = null;
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

  /** 导入区未解锁（未填菜名）时点击，给出解锁路径 */
  onImportLockedTap() {
    if (this.data.canImport) return;
    wx.showToast({ title: "先填写菜名，再使用 AI 导入", icon: "none" });
  },

  /** 上传展示图：未填菜名时给出提示 */
  onTapCoverUpload() {
    if (!this.data.canImport) {
      wx.showToast({ title: "请先填写菜名", icon: "none" });
      return;
    }
    this.onChooseImage();
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

  onLinkTextInput(e) {
    const v = e.detail.value || "";
    this.setData({ linkText: v, linkLen: v.length });
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
      // 用本地裁切图立即回显：刚上传的文件 CDN 可能未生效
      this.setData({ recipeImg: fid, recipeImgDisplay: filePath });
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
      }, { timeout: 60000 });

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

  /** 小红书分享链接识别：云函数解析笔记文案/图集后走 AI 提炼 */
  async onExtractFromLink() {
    if (!this.data.familyId) {
      wx.showToast({ title: "请先选择家庭", icon: "none" });
      return;
    }
    if (!String(this.data.recipeName || "").trim()) {
      wx.showToast({ title: "请先输入菜名", icon: "none" });
      return;
    }
    const raw = String(this.data.linkText || "").trim();
    if (!/(xhslink\.(?:com|cn)|xiaohongshu\.com)/i.test(raw)) {
      wx.showToast({ title: "请粘贴小红书分享口令或链接", icon: "none" });
      return;
    }
    if (this.data.isExtractingFromLink) return;
    this.setData({ isExtractingFromLink: true });
    this.showAiLoading();
    try {
      const result = await cloud.callFunction("aiFunctions", {
        type: "extractRecipeFromLink",
        recipeName: this.data.recipeName,
        shareText: raw,
        familyId: this.data.familyId,
      }, { timeout: 90000 });

      if (result && result.recipeName) {
        this.setData({
          ingredients: result.ingredients || [],
          seasonings: result.seasonings || [],
          prepareSteps: normalizeStepItems(result.prepareSteps || []),
          cookingSteps: normalizeStepItems(result.cookingSteps || []),
        });
        const tip =
          result.tip ||
          (result.mock ? "解析未完全成功，请核对后编辑" : "已提取内容，可继续编辑");
        haptics.medium();
        wx.showToast({
          title: tip.length > 28 ? tip.slice(0, 28) + "…" : tip,
          icon: "none",
          duration: result.mock ? 4500 : 2500,
        });
        if (result.mock && tip.length > 28) {
          wx.showModal({
            title: "解析提示",
            content: tip,
            showCancel: false,
            confirmText: "知道了",
          });
        }
      } else {
        wx.showToast({ title: "解析失败，请改用截图识别", icon: "none" });
      }
    } catch (e) {
      const msg =
        (e && e.message) ||
        (e && e.errMsg) ||
        "解析失败，请稍后重试";
      wx.showToast({ title: String(msg).slice(0, 32), icon: "none", duration: 4000 });
      console.error("[recipe/add] extract from link failed:", e);
    } finally {
      this.hideAiLoading();
      this.setData({ isExtractingFromLink: false });
    }
  },

  /* 旧小红书链接 onExtract 已移除；链接识别走 onExtractFromLink → aiFunctions.extractRecipeFromLink */

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
          }, { timeout: 90000 });

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
        }, { timeout: 60000 })
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
    haptics.light();
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
    haptics.light();
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

    const { listKey, fromIndex, startY, rects } = this._stepDrag;
    const offsetY = touch.clientY - startY;
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

