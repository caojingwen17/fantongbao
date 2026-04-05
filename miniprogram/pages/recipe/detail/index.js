const cloud = require("../../../utils/cloud");
const ui = require("../../../utils/ui");
const { resolveForImage } = require("../../../utils/cloudDisplay");
const { renderRecipeSharePoster } = require("../../../utils/recipeSharePoster");

Page({
  data: {
    pageLoading: true,
    recipeId: "",
    familyId: "",
    recipeName: "",
    recipeImg: "",
    recipeImgDisplay: "",
    ingredients: [],
    seasonings: [],
    prepareSteps: [],
    cookingSteps: [],
    posterWorking: false,
  },

  async fetchRecipeDetail() {
    const { recipeId } = this.data;
    if (!recipeId) return;
    const result = await cloud.callFunction("recipeFunctions", {
      type: "getRecipe",
      recipeId,
    });
    if (result && result.recipe) {
      const recipe = result.recipe;
      const recipeImg = recipe.recipeImg || "";
      const recipeImgDisplay = await resolveForImage(recipeImg, {
        familyId: recipe.familyId,
      });
      this.setData({
        familyId: recipe.familyId || "",
        recipeName: recipe.recipeName || "",
        recipeImg,
        recipeImgDisplay: recipeImgDisplay || recipeImg,
        ingredients: recipe.ingredients || [],
        seasonings: recipe.seasonings || [],
        prepareSteps: recipe.prepareSteps || [],
        cookingSteps: recipe.cookingSteps || [],
      });
    }
  },

  async onLoad(options) {
    const app = getApp();
    const familyId = app && app.globalData ? app.globalData.currentFamilyId : "";
    const recipeId = options && options.recipeId ? options.recipeId : "";
    this.setData({ recipeId, familyId: familyId || "" });
    if (!recipeId) {
      this.setData({ pageLoading: false });
      return;
    }

    try {
      await this.fetchRecipeDetail();
    } catch (e) {
      // ignore
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  async onShow() {
    if (this.data.pageLoading || !this.data.recipeId || this.data.posterWorking) return;
    try {
      await this.fetchRecipeDetail();
    } catch (e) {
      // ignore
    }
  },

  onBack() {
    const pages = getCurrentPages();
    if (!pages || pages.length <= 1) {
      wx.reLaunch({ url: "/pages/index/index" });
      return;
    }
    wx.navigateBack();
  },

  goEdit() {
    const { recipeId } = this.data;
    if (!recipeId) return;
    wx.navigateTo({ url: `/pages/recipe/edit/index?recipeId=${recipeId}` });
  },

  downloadHttpsToTemp(url) {
    return new Promise((resolve) => {
      const u = String(url || "").trim();
      if (!u || (u.indexOf("http://") !== 0 && u.indexOf("https://") !== 0)) {
        resolve("");
        return;
      }
      wx.downloadFile({
        url: u,
        success: (r) => resolve((r && r.tempFilePath) || ""),
        fail: () => resolve(""),
      });
    });
  },

  /** 小程序码：优先云文件 ID 直下到临时路径（不依赖 downloadFile 合法域名） */
  async downloadQrLocalPath(prep) {
    const fileId = prep && prep.qrFileId ? String(prep.qrFileId).trim() : "";
    if (fileId && wx.cloud && typeof wx.cloud.downloadFile === "function") {
      try {
        const r = await wx.cloud.downloadFile({ fileID: fileId });
        if (r && r.tempFilePath) return r.tempFilePath;
      } catch (e) {
        /* 回退 HTTPS */
      }
    }
    const url = prep && prep.qrTempUrl ? String(prep.qrTempUrl).trim() : "";
    return this.downloadHttpsToTemp(url);
  },

  async onShareAsImage() {
    if (this.data.posterWorking || !this.data.recipeId) return;
    this.setData({ posterWorking: true });
    let prep = null;
    let qrPath = "";
    let tempPath = "";
    try {
      await ui.withLoading(async () => {
        let envVersion = "release";
        try {
          const info = wx.getAccountInfoSync();
          const v = info && info.miniProgram && info.miniProgram.envVersion;
          if (v === "develop" || v === "trial" || v === "release") {
            envVersion = v;
          }
        } catch (e) {
          /* 默认 release */
        }
        prep = await cloud.callFunction("recipeFunctions", {
          type: "prepareRecipeShare",
          recipeId: this.data.recipeId,
          envVersion,
        });
        if (!prep || prep.success === false) {
          const msg =
            (prep && (prep.errMsg || prep.message)) || "准备分享失败，请稍后重试";
          throw new Error(msg);
        }
        const coverUrl = this.data.recipeImgDisplay || this.data.recipeImg;
        const [coverPath, qPath] = await Promise.all([
          this.downloadHttpsToTemp(coverUrl),
          this.downloadQrLocalPath(prep),
        ]);
        qrPath = qPath;
        await new Promise((r) => setTimeout(r, 50));
        tempPath = await renderRecipeSharePoster(this, {
          recipeName: this.data.recipeName,
          coverLocalPath: coverPath,
          qrLocalPath: qrPath,
          prepareSteps: this.data.prepareSteps,
          cookingSteps: this.data.cookingSteps,
        });
      }, "生成分享图…");

      if (!qrPath && prep && prep.qrError) {
        const msg = String(prep.qrError);
        const tip = msg.slice(0, 36);
        wx.showToast({
          title: tip.length < msg.length ? `${tip}…` : tip,
          icon: "none",
          duration: 4000,
        });
      }

      // 调起系统分享图菜单：保存相册、转发好友等由用户自选（基础库过低时回退为仅保存相册）
      if (tempPath && wx.showShareImageMenu) {
        wx.showShareImageMenu({
          path: tempPath,
          fail() {},
        });
      } else if (tempPath && wx.saveImageToPhotosAlbum) {
        await new Promise((resolve) => {
          wx.saveImageToPhotosAlbum({
            filePath: tempPath,
            success: () => {
              wx.showToast({ title: "已保存到相册", icon: "none" });
              resolve();
            },
            fail: (err) => {
              const msg = String((err && err.errMsg) || "");
              if (msg.indexOf("cancel") !== -1) {
                resolve();
                return;
              }
              const needAuth =
                /auth deny|authorize|permission denied/i.test(msg) ||
                msg.indexOf("auth") !== -1;
              if (needAuth) {
                wx.showModal({
                  title: "需要相册权限",
                  content: "保存分享图需要允许写入相册。",
                  confirmText: "去设置",
                  cancelText: "取消",
                  success: (r) => {
                    if (r.confirm && wx.openSetting) wx.openSetting({});
                  },
                });
              } else {
                wx.showToast({ title: "保存失败", icon: "none" });
              }
              resolve();
            },
          });
        });
      }
    } catch (e) {
      const t =
        (e && e.errMsg) ||
        (e && e.message) ||
        "生成失败";
      wx.showToast({ title: t, icon: "none" });
    } finally {
      this.setData({ posterWorking: false });
    }
  },

  onAskDeleteRecipe() {
    const { recipeId, recipeName } = this.data;
    if (!recipeId) return;
    wx.showModal({
      title: "删除菜谱",
      content: `确定删除「${recipeName || "该菜谱"}」？删除后不可恢复。`,
      confirmText: "删除",
      confirmColor: "#e64545",
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await ui.withLoading(async () => {
            await cloud.callFunctionWithErrorToast("recipeFunctions", {
              type: "deleteRecipe",
              recipeId,
            });
          }, "删除中…");
          wx.showToast({ title: "已删除", icon: "none" });
          wx.navigateBack();
        } catch (e) {}
      },
    });
  },
});

