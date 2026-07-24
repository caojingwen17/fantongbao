Component({
  options: {
    styleIsolation: "shared",
  },
  data: {
    visible: false,
    closing: false,
    title: "加载中…",
    mask: true,
  },
  methods: {
    show(options) {
      const opts = options || {};
      this.setData({
        visible: true,
        closing: false,
        title: opts.title || "加载中…",
        mask: opts.mask !== false,
      });
    },
    hide() {
      if (!this.data.visible) return;
      this.setData({ closing: true });
      setTimeout(() => {
        this.setData({ visible: false, closing: false });
      }, 160);
    },
    noop() {},
  },
});
