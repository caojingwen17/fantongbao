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
    /** 状态栏高度 + 顶部留白（px），与首页 FANTONGBABY 品牌栏底部对齐 */
    paddingTopPx: 26,
  },
  lifetimes: {
    attached() {
      try {
        const info =
          typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const statusBarHeight = info.statusBarHeight || 0;
        const pxPerRpx = (info.windowWidth || 375) / 750;
        // 与首页 .topbar 视觉对齐：52rpx 顶部留白，内容 80rpx，底部 30rpx
        this.setData({
          paddingTopPx: Math.round(statusBarHeight + 52 * pxPerRpx),
        });
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
      wx.switchTab({
        url: "/pages/index/index",
        fail: () => wx.reLaunch({ url: "/pages/index/index" }),
      });
    },
  },
});
