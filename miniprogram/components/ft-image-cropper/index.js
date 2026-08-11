/**
 * 固定 4:3 图片裁切组件
 *
 * 用法：
 *   wxml: <ft-image-cropper id="cropper" bind:confirm="onCropConfirm" bind:cancel="onCropCancel" />
 *   js:   this.selectComponent("#cropper").open({ src: tempFilePath })
 *
 * 事件：
 *   confirm  e.detail.tempFilePath 裁切后的本地临时文件（JPEG, quality 0.9）
 *   cancel   用户取消
 *
 * 实现要点：
 * - movable-view 的盒子尺寸 = 图片「铺满取景框（cover）」的显示尺寸，因此 scale-min 固定为 1，
 *   盒子被 movable-area 钳制在取景框内时，缩放后的图片必然完整覆盖取景框；
 * - 缩放以盒子中心为原点，裁剪区域换算到原图像素坐标后用 canvas(type=2d) 导出。
 */

/** 取景框宽度（rpx），高 = 宽 * 3/4 */
const FRAME_W_RPX = 686;
/** 导出图最大宽度（px），防止文件过大 */
const MAX_EXPORT_WIDTH = 1200;
/** 缩放范围：1 = 刚好铺满取景框 */
const SCALE_MIN = 1;
const SCALE_MAX = 4;

Component({
  options: {
    styleIsolation: "shared",
  },
  data: {
    visible: false,
    src: "",
    frameW: 0,
    frameH: 0,
    imgW: 0,
    imgH: 0,
    viewX: 0,
    viewY: 0,
    scaleMin: SCALE_MIN,
    scaleMax: SCALE_MAX,
    scaleValue: SCALE_MIN,
    canvasW: MAX_EXPORT_WIDTH,
    canvasH: (MAX_EXPORT_WIDTH * 3) / 4,
  },

  methods: {
    /**
     * 打开裁切层
     * @param {{ src: string }} options 本地图片路径
     */
    open(options) {
      const src = options && options.src;
      if (!src) return;
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const frameW = (FRAME_W_RPX * win.windowWidth) / 750;
      const frameH = (frameW * 3) / 4;
      wx.getImageInfo({
        src,
        success: (info) => {
          const iw = (info && info.width) || 0;
          const ih = (info && info.height) || 0;
          if (!iw || !ih) {
            wx.showToast({ title: "图片读取失败", icon: "none" });
            this.triggerEvent("cancel");
            return;
          }
          // cover：图片刚好铺满取景框的显示尺寸
          const cover = Math.max(frameW / iw, frameH / ih);
          const imgW = iw * cover;
          const imgH = ih * cover;
          const viewX = (frameW - imgW) / 2;
          const viewY = (frameH - imgH) / 2;
          this._img = { iw, ih };
          this._frame = { w: frameW, h: frameH };
          this._view = { x: viewX, y: viewY, scale: SCALE_MIN };
          this.setData({
            visible: true,
            src,
            frameW,
            frameH,
            imgW,
            imgH,
            viewX,
            viewY,
            scaleValue: SCALE_MIN,
          });
        },
        fail: () => {
          wx.showToast({ title: "图片读取失败", icon: "none" });
          this.triggerEvent("cancel");
        },
      });
    },

    onViewChange(e) {
      if (!e || !e.detail || !this._view) return;
      this._view.x = e.detail.x;
      this._view.y = e.detail.y;
    },

    onViewScale(e) {
      if (!e || !e.detail || !this._view) return;
      this._view.scale = e.detail.scale;
      if (typeof e.detail.x === "number") this._view.x = e.detail.x;
      if (typeof e.detail.y === "number") this._view.y = e.detail.y;
    },

    async onConfirm() {
      if (this._exporting || !this._img || !this._view) return;
      this._exporting = true;
      try {
        const tempFilePath = await this._exportCrop();
        this.setData({ visible: false });
        this.triggerEvent("confirm", { tempFilePath });
      } catch (e) {
        console.error("[ft-image-cropper] export failed:", e);
        wx.showToast({ title: "裁切失败，请重试", icon: "none" });
      } finally {
        this._exporting = false;
      }
    },

    onCancel() {
      this.setData({ visible: false });
      this.triggerEvent("cancel");
    },

    noop() {},

    /**
     * 按当前 view 的 x/y/scale 计算裁剪区域，canvas 导出 4:3 JPEG
     *
     * 坐标口径：movable-view 缩放后的 x/y 语义（缩放原点、事件返回值）各端表现不一致，
     * 直接按事件值推算会导致「预览 ≠ 导出」。这里优先用 boundingClientRect 实测
     * 图片的真实渲染矩形（含缩放/位移后的最终视觉位置）换算裁剪区域；
     * 仅当实测矩形明显不含缩放时，才回退到「盒子中心为缩放原点」的推算。
     *
     * @returns {Promise<string>} tempFilePath
     */
    _exportCrop() {
      return new Promise((resolve, reject) => {
        this.createSelectorQuery()
          .select("#ftCropCanvas")
          .fields({ node: true })
          .select(".ft-cropper-img")
          .boundingClientRect()
          .select(".ft-cropper-frame")
          .boundingClientRect()
          .exec((res) => {
            try {
              const canvas = res && res[0] && res[0].node;
              if (!canvas) {
                reject(new Error("canvas 初始化失败"));
                return;
              }
              const { iw, ih } = this._img;
              const { w: frameW, h: frameH } = this._frame;
              const { x, y, scale } = this._view;
              const { imgW, imgH } = this.data;
              const imgRect = res[1];
              const frameRect = res[2];

              const expectedW = imgW * scale;
              const rectReflectsScale =
                imgRect &&
                Math.abs(imgRect.width - expectedW) <= Math.max(3, expectedW * 0.02);

              let visualW, visualH, visualLeft, visualTop;
              if (imgRect && frameRect && (rectReflectsScale || scale <= 1.02)) {
                // 实测：图片渲染矩形相对取景框左上角
                visualW = imgRect.width;
                visualH = imgRect.height;
                visualLeft = imgRect.left - frameRect.left;
                visualTop = imgRect.top - frameRect.top;
              } else {
                // 回退：缩放以盒子中心为原点推算
                visualW = expectedW;
                visualH = imgH * scale;
                visualLeft = x + (imgW - visualW) / 2;
                visualTop = y + (imgH - visualH) / 2;
              }

              // 取景框在视觉图片坐标系中的位置 → 原图像素坐标
              const ratio = iw / visualW;
              const sx = Math.max(0, -visualLeft * ratio);
              const sy = Math.max(0, -visualTop * ratio);
              const sw = Math.min(iw - sx, frameW * ratio);
              const sh = Math.min(ih - sy, frameH * ratio);
              if (sw <= 0 || sh <= 0) {
                reject(new Error("裁剪区域无效"));
                return;
              }
              let canvasW = Math.round(sw);
              if (canvasW > MAX_EXPORT_WIDTH) canvasW = MAX_EXPORT_WIDTH;
              const canvasH = Math.round((canvasW * 3) / 4);
              // 同步 movable-view 当前位置/缩放，避免 setData 重渲染时预览跳回初始状态
              this.setData({
                canvasW,
                canvasH,
                viewX: x,
                viewY: y,
                scaleValue: scale,
              });
              canvas.width = canvasW;
              canvas.height = canvasH;

              const ctx = canvas.getContext("2d");
              const img = canvas.createImage();
              img.onload = () => {
                ctx.clearRect(0, 0, canvasW, canvasH);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
                wx.canvasToTempFilePath({
                  canvas,
                  fileType: "jpg",
                  quality: 0.9,
                  destWidth: canvasW,
                  destHeight: canvasH,
                  success: (r) =>
                    r && r.tempFilePath
                      ? resolve(r.tempFilePath)
                      : reject(new Error("导出失败")),
                  fail: reject,
                });
              };
              img.onerror = () => reject(new Error("图片加载失败"));
              img.src = this.data.src;
            } catch (err) {
              reject(err);
            }
          });
      });
    },
  },
});
