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
