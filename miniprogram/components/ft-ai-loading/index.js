const STAGES = [
  "清洗食材中…",
  "切配备料中…",
  "热锅下油中…",
  "大火翻炒中…",
  "小火慢炖中…",
  "调味收汁中…",
  "摆盘装饰中…",
];

Component({
  options: {
    styleIsolation: "shared",
  },
  data: {
    visible: false,
    finishing: false,
    stageText: STAGES[0],
    progress: 0,
    elapsed: 0,
  },
  methods: {
    show() {
      this._stageIndex = 0;
      this._clearTimers();
      this.setData({
        visible: true,
        finishing: false,
        stageText: STAGES[0],
        progress: 0,
        elapsed: 0,
      });
      // 阶段文案轮转
      this._stageTimer = setInterval(() => {
        this._stageIndex = (this._stageIndex + 1) % STAGES.length;
        this.setData({ stageText: STAGES[this._stageIndex] });
      }, 2400);
      // 等待计时
      this._elapsedTimer = setInterval(() => {
        this.setData({ elapsed: this.data.elapsed + 1 });
      }, 1000);
      // 假进度：缓动逼近 92%，永不自满
      this._progressTimer = setInterval(() => {
        const p = this.data.progress;
        if (p >= 92) return;
        this.setData({ progress: Math.min(92, p + Math.max(0.6, (92 - p) * 0.045)) });
      }, 500);
    },
    hide() {
      if (!this.data.visible) return;
      this._clearTimers();
      this.setData({ finishing: true, progress: 100, stageText: "出锅啦！" });
      setTimeout(() => {
        this.setData({ visible: false, finishing: false, progress: 0, elapsed: 0 });
      }, 650);
    },
    _clearTimers() {
      ["_stageTimer", "_elapsedTimer", "_progressTimer"].forEach((k) => {
        if (this[k]) {
          clearInterval(this[k]);
          this[k] = null;
        }
      });
    },
    noop() {},
  },
  lifetimes: {
    detached() {
      this._clearTimers();
    },
  },
});
