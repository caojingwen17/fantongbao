const invite = require("../../utils/invite");
const orderInvite = require("../../utils/orderInvite");
const { resolveMainEntryStatus, startOptimisticHomePrefetch, startHomePrefetch, delay } = require("../../utils/entryBoot");

Page({
  data: {
    progress: 0,
  },

  setProgress(value) {
    const p = Math.max(0, Math.min(100, Math.round(value)));
    this.setData({ progress: p });
  },

  async onLoad(options) {
    const app = getApp();
    if (app.globalData && app.globalData.entryFromInvite) {
      await this.routeInviteEntry(options || {});
      return;
    }
    await this.runMainEntryBoot(options || {});
  },

  /** 分享/邀请若落到启动页，走原邀请链路（不展示启动屏） */
  async routeInviteEntry(options) {
    const launch =
      typeof wx.getLaunchOptionsSync === "function" ? wx.getLaunchOptionsSync() : {};
    const merged = Object.assign({}, launch.query || {}, options || {});

    const orderToken = orderInvite.parseTokenFromOptions(merged);
    if (orderToken) {
      orderInvite.rememberPendingOrderInviteToken(orderToken);
      await orderInvite.handlePendingOrderInviteOnEntry();
      return;
    }

    const inviteCode = invite.parseInviteCodeFromOptions(merged);
    if (inviteCode) {
      invite.rememberPendingInviteCode(inviteCode);
      wx.redirectTo({ url: invite.buildFamilyInvitePath(inviteCode) });
      return;
    }

    await this.runMainEntryBoot(options);
  },

  async runMainEntryBoot(options) {
    const app = getApp();
    orderInvite.clearPendingOrderInviteToken();
    invite.clearPendingInviteCode();

    this.setProgress(12);
    // 用上次会话的 familyId 乐观预取首页数据，与静默登录全程并行
    startOptimisticHomePrefetch();
    const bootPromise = resolveMainEntryStatus();
    const minDelayPromise = delay(900);

    this.setProgress(36);
    const status = await bootPromise;
    this.setProgress(Math.min(88, status === "ok" ? 82 : 72));
    // 身份判定为 ok 后立刻预取首页数据，与最短展示时长 + 页面跳转并行
    if (status === "ok") startHomePrefetch();
    await minDelayPromise;
    this.setProgress(100);
    await delay(120);

    app.globalData.mainEntryBoot = { status, ts: Date.now() };

    const openOnboard = String(options.onboard) === "1";
    const url = openOnboard ? "/pages/index/index?onboard=1" : "/pages/index/index";
    wx.reLaunch({ url });
  },
});
