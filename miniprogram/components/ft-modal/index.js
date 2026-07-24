Component({
  options: {
    styleIsolation: "shared",
  },
  properties: {
    visible: { type: Boolean, value: false },
    kicker: { type: String, value: "" },
    title: { type: String, value: "" },
    content: { type: String, value: "" },
    confirmText: { type: String, value: "确认" },
    cancelText: { type: String, value: "取消" },
    danger: { type: Boolean, value: false },
    showCancel: { type: Boolean, value: true },
    /** 点击遮罩是否关闭（触发 cancel） */
    maskClosable: { type: Boolean, value: true },
  },
  data: {
    /** 内部挂载态：visible 关闭后保留 200ms 播放退出动画 */
    inner: false,
    closing: false,
  },
  observers: {
    visible(v) {
      if (v) {
        this.setData({ inner: true, closing: false });
        return;
      }
      if (this.data.inner) {
        this.setData({ closing: true });
        setTimeout(() => {
          this.setData({ inner: false, closing: false });
        }, 200);
      }
    },
  },
  methods: {
    onMaskTap() {
      if (!this.data.maskClosable) return;
      this.triggerEvent("cancel");
    },
    onContentTap() {},
    onConfirm() {
      this.triggerEvent("confirm");
    },
    onCancel() {
      this.triggerEvent("cancel");
    },
  },
});
