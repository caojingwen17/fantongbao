Component({
  options: {
    multipleSlots: true,
    styleIsolation: "shared",
  },
  properties: {
    title: { type: String, value: "" },
    showBack: { type: Boolean, value: true },
    /** true 时仅触发 back 事件，由页面自定义返回逻辑 */
    customBack: { type: Boolean, value: false },
  },
  data: {
    /** 状态栏高度（px） */
    statusBarHeightPx: 20,
    /** 胶囊按钮距状态栏的间距（px） */
    capsuleGapPx: 6,
    /** 胶囊按钮高度（px），顶栏内容行与之等高 */
    capsuleHeightPx: 32,
  },
  lifetimes: {
    attached() {
      try {
        const info =
          typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = info.statusBarHeight || 0;
        const menu =
          typeof wx.getMenuButtonBoundingClientRect === "function"
            ? wx.getMenuButtonBoundingClientRect()
            : null;
        if (menu && menu.top != null) {
          this.setData({
            statusBarHeightPx: statusBarHeight,
            capsuleGapPx: Math.max(0, menu.top - statusBarHeight),
            capsuleHeightPx: menu.height || 32,
          });
        } else {
          this.setData({ statusBarHeightPx: statusBarHeight });
        }
      } catch (e) {
        /* 用默认值 */
      }
    },
  },
  methods: {
    onBack() {
      if (this.data.customBack) {
        this.triggerEvent("back");
        return;
      }
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({
          fail: () => this._goHome(),
        });
        return;
      }
      this._goHome();
    },
    _goHome() {
      wx.reLaunch({ url: "/pages/index/index" });
    },
  },
});
