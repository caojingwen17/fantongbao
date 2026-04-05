const cloud = require("../../utils/cloud");

Page({
  data: {
    category: "rant",
    content: "",
    contentLen: 0,
    submitting: false,
  },

  onBack() {
    wx.navigateBack();
  },

  onPickCategory(e) {
    const cat = e.currentTarget.dataset.cat;
    if (cat === "rant" || cat === "suggestion") {
      this.setData({ category: cat });
    }
  },

  onContentInput(e) {
    const v = e.detail.value || "";
    this.setData({ content: v, contentLen: v.length });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const text = String(this.data.content || "").trim();
    if (!text.length) {
      wx.showToast({ title: "请填写内容", icon: "none" });
      return;
    }
    const app = getApp();
    const familyId = (app.globalData && app.globalData.currentFamilyId) || "";
    this.setData({ submitting: true });
    try {
      await cloud.callFunctionWithErrorToast("feedbackFunctions", {
        type: "submitFeedback",
        category: this.data.category,
        content: text,
        familyId,
      });
      wx.showToast({ title: "已收到，感谢！", icon: "success" });
      this.setData({ content: "", contentLen: 0 });
      setTimeout(() => wx.navigateBack(), 1200);
    } catch (e) {
      /* toast 已由 callFunctionWithErrorToast 处理 */
    } finally {
      this.setData({ submitting: false });
    }
  },
});
