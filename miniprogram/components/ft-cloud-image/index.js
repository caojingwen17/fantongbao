/**
 * 统一云图展示组件：把「换链解析 + 占位 + 失效自愈 + 退避重试」收拢到一处，
 * 页面只需传 src（cloud:// fileID / http(s) / 本地路径），不再各自写补丁。
 *
 * 状态机：
 *   idle      src 为空 → 「暂无图片」占位
 *   resolving 解析中/重试中 → 素色占位（无文字，避免尴尬期）
 *   ok        渲染 <image>
 *   failed    重试耗尽 → 「图片加载失败」占位 + console.warn 埋点
 *
 * 自愈：
 *   - 解析返回空（竞速超时/临时失败）→ 按 RETRY_DELAYS 退避重试
 *   - <image> binderror（临时链失效/CDN 抖动）→ invalidate 缓存后重试
 *   - 重试底层走 resolveForImageQueued 微批聚合 + inflight 去重，成本极低
 */

const { resolveForImageQueued, invalidate } = require("../../utils/cloudDisplay");

const RETRY_DELAYS = [3000, 8000, 20000, 40000, 60000];

Component({
  options: {
    styleIsolation: "shared",
  },
  properties: {
    /** cloud:// fileID、http(s) URL 或本地临时路径；空串显示「暂无图片」 */
    src: { type: String, value: "", observer: "onSrcChange" },
    /** 换链上下文（可选）：家庭成员 / 点餐邀请客人 */
    familyId: { type: String, value: "" },
    inviteToken: { type: String, value: "" },
    mode: { type: String, value: "aspectFill" },
    /** 尺寸/圆角复用页面现有类名（如 recipe-img、hero-img） */
    imgClass: { type: String, value: "" },
  },
  data: {
    status: "idle",
    displayUrl: "",
  },
  lifetimes: {
    detached() {
      this._clearTimer();
      // 使进行中的异步回调失效
      this._gen = (this._gen || 0) + 1;
    },
  },
  methods: {
    onSrcChange(src) {
      this._start(String(src || ""));
    },

    _start(src) {
      this._clearTimer();
      this._retryRound = 0;
      this._gen = (this._gen || 0) + 1;
      const gen = this._gen;
      if (!src) {
        this.setData({ status: "idle", displayUrl: "" });
        return;
      }
      if (src.indexOf("cloud://") !== 0) {
        // http(s)/本地路径直渲，无需换链
        this.setData({ status: "ok", displayUrl: src });
        return;
      }
      this.setData({ status: "resolving", displayUrl: "" });
      this._resolve(src, gen);
    },

    async _resolve(fileId, gen) {
      const options = {};
      if (this.data.familyId) options.familyId = this.data.familyId;
      if (this.data.inviteToken) options.inviteToken = this.data.inviteToken;
      let url = "";
      try {
        url = await resolveForImageQueued(fileId, options);
      } catch (e) {
        /* 走重试 */
      }
      if (gen !== this._gen) return;
      if (url) {
        this.setData({ status: "ok", displayUrl: url });
        return;
      }
      this._scheduleRetry(fileId, gen);
    },

    /** 图片加载失败：临时链失效/CDN 抖动，清缓存后较快重试一轮（同样计入总轮次） */
    onImgError() {
      const src = String(this.data.src || "");
      if (src.indexOf("cloud://") !== 0) {
        this.setData({ status: "failed" });
        return;
      }
      invalidate(src);
      this.setData({ status: "resolving", displayUrl: "" });
      const gen = this._gen;
      const round = this._retryRound++;
      if (round >= RETRY_DELAYS.length) {
        console.warn("[ft-cloud-image] 图片最终加载失败:", src);
        this.setData({ status: "failed" });
        return;
      }
      this._clearTimer();
      this._timer = setTimeout(() => {
        if (gen === this._gen) this._resolve(src, gen);
      }, 600);
    },

    _scheduleRetry(fileId, gen) {
      const round = this._retryRound++;
      if (round >= RETRY_DELAYS.length) {
        console.warn("[ft-cloud-image] 图片最终加载失败:", fileId);
        if (gen === this._gen) this.setData({ status: "failed" });
        return;
      }
      this._clearTimer();
      this._timer = setTimeout(() => {
        if (gen === this._gen) this._resolve(fileId, gen);
      }, RETRY_DELAYS[round]);
    },

    _clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    },
  },
});
