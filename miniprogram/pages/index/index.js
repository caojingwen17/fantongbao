const cloud = require("../../utils/cloud");
const { resolveBatch, getCachedUrl } = require("../../utils/cloudDisplay");
const auth = require("../../utils/auth");
const invite = require("../../utils/invite");
const orderInvite = require("../../utils/orderInvite");

function getDefaultNewOrderName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const h = d.getHours();
  if (h >= 6 && h < 12) return `${ymd(d)}-午餐`;
  if (h >= 12 && h < 18) return `${ymd(d)}-晚餐`;
  if (h >= 18) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + 1);
    return `${ymd(nd)}-早餐`;
  }
  return `${ymd(d)}-早餐`;
}

Page({
  data: {
    currentFamily: null,
    families: [],
    membersCount: 0,
    memberAvatarDisplays: [],
    pendingShopping: null,
    pendingCooking: null,
    pendingOrders: [],
    recipes: [],
    /** 家庭菜谱总数（列表接口全量；首页只展示前 6 个卡片） */
    recipeTotalCount: 0,
    homeRefreshing: false,
    /** 首屏静默登录 + 首拉数据完成前全屏 loading */
    homeBootstrapping: true,
    showFamilyPicker: false,
    switchingFamilyId: "",
    showCreateOrderModal: false,
    newOrderName: "",
    createOrderBusy: false,
    /** 无点菜单且无菜谱时展示引导大卡片 */
    homeEmptyHero: false,
    /** 从家庭页创建/加入后带 ?onboard=1 打开的三步说明 */
    onboardSheetVisible: false,
    /** 未登录且静默登录失败：展示首页介绍，不强制跳转登录（符合平台审核「先体验后授权」） */
    homeGuest: false,
    /** 已登录但尚未加入任何家庭：可浏览本页提示，不强制跳转家庭页 */
    homeNeedFamily: false,
    /** 下拉刷新 */
    refreshing: false,
    /** 自定义顶栏/内容区顶部留白（statusBarHeight + 胶囊按钮位置注入，与 ft-topbar 同基准） */
    statusBarHeightPx: 20,
    capsuleGapPx: 6,
    capsuleHeightPx: 32,
    mainPadPx: 90,
  },

  /** 用真实状态栏高度 + 胶囊按钮位置计算顶栏与内容区留白，保证与 ft-topbar 对齐 */
  applyStatusBarPadding() {
    try {
      const info =
        typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = info.statusBarHeight || 0;
      const scale = (info.windowWidth || 375) / 750;
      const menu =
        typeof wx.getMenuButtonBoundingClientRect === "function"
          ? wx.getMenuButtonBoundingClientRect()
          : null;
      if (menu && menu.top != null) {
        const gap = Math.max(0, menu.top - statusBarHeight);
        this.setData({
          statusBarHeightPx: statusBarHeight,
          capsuleGapPx: gap,
          capsuleHeightPx: menu.height || 32,
          // 内容区从胶囊底部 + 32rpx 间距开始
          mainPadPx: Math.round((menu.bottom || statusBarHeight + gap + 32) + 32 * scale),
        });
      } else {
        this.setData({
          statusBarHeightPx: statusBarHeight,
          mainPadPx: Math.round(statusBarHeight + 6 + 32 + 32 * scale),
        });
      }
    } catch (e) {
      /* 用默认值 */
    }
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.refreshHome();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  /**
   * 主入口：新用户 → guest 体验浏览；老用户（本地 session 或云端 restoreSession）→ 静默登录
   * @returns {"ok"|"guest"|"needFamily"}
   */
  async ensureEntryContext() {
    const app = getApp();

    if (app.globalData.userInfo) {
      if (!app.globalData.currentFamilyId) return "needFamily";
      return "ok";
    }

    const r = await auth.trySilentLogin();
    if (!r.ok) {
      if (r.error) console.warn("[auth] silent login failed:", r.error);
      return "guest";
    }

    if (!app.globalData.userInfo) return "guest";
    if (!app.globalData.currentFamilyId) return "needFamily";
    return "ok";
  },

  /** 访客：与正式首页同一套布局，数据为空，仅顶部展示轻提示 */
  applyGuestBrowseState() {
    this.setData({
      homeBootstrapping: false,
      homeGuest: true,
      homeNeedFamily: false,
      currentFamily: null,
      families: [],
      membersCount: 0,
      memberAvatarDisplays: [],
      pendingShopping: null,
      pendingCooking: null,
      pendingOrders: [],
      recipes: [],
      recipeTotalCount: 0,
      homeEmptyHero: true,
      homeRefreshing: false,
    });
  },

  /** 访客登录返回后升级为已登录首页 */
  async tryUpgradeGuestSession() {
    try {
      const r = await auth.trySilentLogin();
      if (!r.ok) return;

      const app = getApp();
      if (!app.globalData.userInfo) return;

      if (!app.globalData.currentFamilyId) {
        this.setData({
          homeBootstrapping: false,
          homeGuest: false,
          homeNeedFamily: true,
        });
        return;
      }

      const families = app.globalData.families || [];
      const currentFamily =
        families.find((f) => f._id === app.globalData.currentFamilyId) || null;
      this.setData({
        homeGuest: false,
        homeNeedFamily: false,
        currentFamily,
        families,
      });
      await this.refreshHome();
    } catch (e) {
      /* 保持访客态 */
    }
  },

  /** 主入口启动页已完成身份判定后，应用到首页 */
  async applyMainEntryBoot(status, openOnboard) {
    if (status === "guest") {
      this.applyGuestBrowseState();
      return;
    }
    if (status === "needFamily") {
      this.setData({ homeBootstrapping: false, homeGuest: false, homeNeedFamily: true });
      return;
    }

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({
      homeGuest: false,
      homeNeedFamily: false,
      homeBootstrapping: false,
      currentFamily,
      families,
    });
    this._skipShowRefreshOnce = true;
    await this.refreshHome();
    if (openOnboard) {
      this.setData({ onboardSheetVisible: true });
    }
  },

  async onLoad(options) {
    this._mainEntryReady = false;
    this.applyStatusBarPadding();
    const app = getApp();
    const launch =
      typeof wx.getLaunchOptionsSync === "function" ? wx.getLaunchOptionsSync() : {};
    const opts = options || {};
    const skipLaunchInvite =
      String(opts.onboard) === "1" || orderInvite.isOrderInviteHandled();
    // 仅冷启动首次进首页时合并 launch.query；加入成功带 onboard=1 时勿用冷启动参数
    const mergedQuery =
      app._indexEverLoaded || skipLaunchInvite
        ? opts
        : Object.assign({}, launch.query || {}, opts);
    app._indexEverLoaded = true;

    if (skipLaunchInvite) {
      invite.clearPendingInviteCode();
    }

    const orderToken = skipLaunchInvite
      ? ""
      : orderInvite.parseTokenFromOptions(mergedQuery);
    if (orderToken) {
      this._mainEntryReady = true;
      orderInvite.rememberPendingOrderInviteToken(orderToken);
      await orderInvite.handlePendingOrderInviteOnEntry();
      return;
    }

    const inviteCode = invite.parseInviteCodeFromOptions(mergedQuery);
    if (inviteCode) {
      this._mainEntryReady = true;
      invite.rememberPendingInviteCode(inviteCode);
      wx.redirectTo({ url: invite.buildFamilyInvitePath(inviteCode) });
      return;
    }

    const isMainEntry = !app.globalData.entryFromInvite;

    // 普通主入口（无分享参数）：清除残留邀请态，保留访客浏览体验
    if (isMainEntry) {
      orderInvite.clearPendingOrderInviteToken();
      invite.clearPendingInviteCode();
    }

    const openOnboard = options && String(options.onboard) === "1";

    const boot = app.globalData.mainEntryBoot;
    if (isMainEntry && boot && boot.status) {
      app.globalData.mainEntryBoot = null;
      this._mainEntryReady = true;
      await this.applyMainEntryBoot(boot.status, openOnboard);
      return;
    }

    this._mainEntryReady = true;
    this.setData({ homeBootstrapping: true });

    const ctx = await this.ensureEntryContext();
    if (ctx === "guest") {
      this.applyGuestBrowseState();
      return;
    }
    if (ctx === "needFamily") {
      this.setData({ homeBootstrapping: false, homeGuest: false, homeNeedFamily: true });
      return;
    }

    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });

    this.setData({ homeGuest: false, homeNeedFamily: false });
    this._skipShowRefreshOnce = true;
    await this.refreshHome();
    if (openOnboard) {
      this.setData({ onboardSheetVisible: true });
    }
  },

  async onShow(options) {
    const opts = options || {};
    const orderToken = orderInvite.parseTokenFromOptions(opts);
    if (orderToken) {
      orderInvite.rememberPendingOrderInviteToken(orderToken);
      wx.redirectTo({ url: orderInvite.buildOrderInvitePath(orderToken) });
      return;
    }
    const inviteCode = invite.parseInviteCodeFromOptions(opts);
    if (inviteCode) {
      invite.rememberPendingInviteCode(inviteCode);
      wx.redirectTo({ url: invite.buildFamilyInvitePath(inviteCode) });
      return;
    }

    if (!this._mainEntryReady) return;

    if (this.data.homeGuest && auth.isLoggedIn()) {
      await this.tryUpgradeGuestSession();
      return;
    }

    if (this.data.homeGuest) return;

    const ctx = await this.ensureEntryContext();
    if (ctx === "guest") {
      this.applyGuestBrowseState();
      return;
    }
    if (ctx === "needFamily") {
      this.setData({ homeBootstrapping: false, homeGuest: false, homeNeedFamily: true });
      return;
    }

    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
    }

    this.setData({ homeGuest: false, homeNeedFamily: false });

    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    const families = app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ currentFamily, families });

    if (this._skipShowRefreshOnce) {
      this._skipShowRefreshOnce = false;
      return;
    }
    await this.refreshHome();
  },

  async guardGuestAction(content) {
    if (!this.data.homeGuest) return true;
    wx.navigateTo({ url: "/pages/login/login/index" });
    return false;
  },

  async refreshFamiliesIfNeeded() {
    const app = getApp();
    if (app.globalData.families && app.globalData.families.length) return;
    const resp = await cloud
      .callFunction("familyFunctions", { type: "getMyFamilies" })
      .catch(() => ({}));
    const families = (resp && resp.families) || [];
    app.globalData.families = families;
    const familyId = app.globalData.currentFamilyId;
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({ families, currentFamily });
  },

  async refreshHome() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    if (this._refreshPromise) return this._refreshPromise;

    this._refreshPromise = this._doRefreshHome().finally(() => {
      this._refreshPromise = null;
    });
    return this._refreshPromise;
  },

  async _doRefreshHome() {
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId) return;

    this.setData({ homeRefreshing: true });
    wx.showNavigationBarLoading();
    try {
      const [membersResp, ordersResp, recipeResp] = await Promise.all([
        cloud
          .callFunction("familyFunctions", {
            type: "getFamilyMembers",
            familyId,
          })
          .catch(() => ({})),
        cloud
          .callFunction("orderFunctions", {
            type: "listActiveOrders",
            familyId,
          })
          .catch(() => ({})),
        cloud
          .callFunction("recipeFunctions", {
            type: "listRecipesForHome",
            familyId,
            limit: 6,
          })
          .catch(() => ({})),
      ]);

      const members = (membersResp && membersResp.members) || [];
      const avatarIds = members
        .map((m) => (m && (m.avatarUrl || m.avatar || m.userAvatar || m.avatarFileId)) || "")
        .filter(Boolean);

      const rawOrders = (ordersResp && ordersResp.orders) || [];
      const pendingOrders = rawOrders.map((o) => {
        const rc = o.recipeCount || 0;
        let statusText = o.status === "pending_cooking" ? "待制作" : "待买菜";
        if (rc === 0) statusText = "待点菜";
        return { ...o, statusText };
      });

      const pendingShopping =
        pendingOrders.find((x) => x.status === "pending_shopping") || null;
      const pendingCooking =
        pendingOrders.find((x) => x.status === "pending_cooking") || null;

      const list = (recipeResp && recipeResp.recipes) || [];
      const recipeTotalCount =
        typeof recipeResp.totalCount === "number" ? recipeResp.totalCount : list.length;
      const homeEmptyHero =
        (!pendingOrders || pendingOrders.length === 0) && recipeTotalCount === 0;

      // 先渲染文字/结构，去掉全屏 loading，图片稍后补齐
      this.setData({
        membersCount: members.length,
        memberAvatarDisplays: [],
        pendingShopping,
        pendingCooking,
        pendingOrders,
        recipes: list,
        recipeTotalCount,
        homeEmptyHero,
        homeBootstrapping: false,
      });

      const recipeImgIds = list
        .map((r) => (r && r.recipeImg) || "")
        .filter((id) => id && String(id).indexOf("cloud://") === 0);
      const cloudIds = [
        ...new Set([
          ...avatarIds.filter((id) => String(id).indexOf("cloud://") === 0),
          ...recipeImgIds,
        ]),
      ];

      if (!cloudIds.length) return;

      const urlMap = await resolveBatch(cloudIds, { familyId });
      const memberAvatarDisplays = members
        .map((m) => {
          const id = (m && (m.avatarUrl || m.avatar || m.userAvatar || m.avatarFileId)) || "";
          if (!id) return "";
          if (typeof id === "string" && id.indexOf("cloud://") === 0) {
            return urlMap[id] || getCachedUrl(id) || id;
          }
          return id;
        })
        .filter(Boolean)
        .slice(0, 2);

      const recipes = list.map((r) => {
        const id = r && r.recipeImg;
        if (!id) return { ...r, recipeImgDisplay: r.recipeImgDisplay || "" };
        if (typeof id !== "string" || id.indexOf("cloud://") !== 0) {
          return { ...r, recipeImgDisplay: id };
        }
        const display = urlMap[id] || getCachedUrl(id) || r.recipeImgDisplay || id;
        return { ...r, recipeImgDisplay: display };
      });

      this.setData({ memberAvatarDisplays, recipes });
    } catch (e) {
      this.setData({
        membersCount: 0,
        memberAvatarDisplays: [],
        pendingShopping: null,
        pendingCooking: null,
        pendingOrders: [],
        recipes: [],
        recipeTotalCount: 0,
        homeEmptyHero: true,
        homeBootstrapping: false,
      });
    } finally {
      wx.hideNavigationBarLoading();
      this.setData({ homeRefreshing: false });
    }
  },

  goFamily() {
    // 跳转前收起浮层，避免返回后残留
    if (this.data.showFamilyPicker) this.setData({ showFamilyPicker: false });
    wx.navigateTo({ url: "/pages/family/family/index" });
  },

  goFeedback() {
    wx.navigateTo({ url: "/pages/feedback/index" });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login/index" });
  },

  onHide() {
    // 保险：页面隐藏时强制关闭浮层
    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
    }
  },

  async onToggleFamilyPicker() {
    if (this.data.showFamilyPicker) {
      this.setData({ showFamilyPicker: false });
      return;
    }
    if (!(await this.guardGuestAction("切换家庭需要先登录。"))) return;
    this.setData({ showFamilyPicker: true });
    this.refreshFamiliesIfNeeded().catch(() => {});
  },

  onCloseFamilyPicker() {
    if (!this.data.showFamilyPicker) return;
    this.setData({ showFamilyPicker: false });
  },

  async onSwitchFamily(e) {
    const familyId = e.currentTarget.dataset.familyid;
    if (!familyId || this.data.switchingFamilyId) return;
    if (!(await this.guardGuestAction("切换家庭需要先登录。"))) return;
    const app = getApp();
    app.globalData.currentFamilyId = familyId;
    const families = this.data.families || app.globalData.families || [];
    const currentFamily = families.find((f) => f._id === familyId) || null;
    this.setData({
      switchingFamilyId: familyId,
      currentFamily: currentFamily || this.data.currentFamily,
      showFamilyPicker: false,
    });
    wx.showNavigationBarLoading();
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "switchFamily",
        familyId,
      });
    } finally {
      wx.hideNavigationBarLoading();
      this.setData({ switchingFamilyId: "" });
    }
    await this.refreshHome();
  },

  noop() {},

  closeOnboardSheet() {
    this.setData({ onboardSheetVisible: false });
  },

  async onCopyInvite() {
    if (!(await this.guardGuestAction("复制邀请码需要先登录。"))) return;
    const code = this.data.currentFamily && this.data.currentFamily.inviteCode;
    if (!code) return;
    wx.setClipboardData({ data: code });
  },

  async goPendingOrder(e) {
    const orderId = e.currentTarget.dataset.orderid;
    if (!orderId) return;
    if (!(await this.guardGuestAction("查看点菜单需要先登录。"))) return;
    wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
  },

  async openCreateOrderModal() {
    if (!(await this.guardGuestAction("创建点菜单需要先登录。"))) return;
    if (this.data.showFamilyPicker) this.setData({ showFamilyPicker: false });
    this.setData({
      showCreateOrderModal: true,
      newOrderName: getDefaultNewOrderName(),
    });
  },

  closeCreateOrderModal() {
    if (this.data.createOrderBusy) return;
    this.setData({ showCreateOrderModal: false, newOrderName: "" });
  },

  onNewOrderNameInput(e) {
    this.setData({ newOrderName: (e.detail && e.detail.value) || "" });
  },

  async confirmCreateOrder() {
    if (!(await this.guardGuestAction("创建点菜单需要先登录。"))) return;
    const app = getApp();
    const familyId = app.globalData.currentFamilyId;
    if (!familyId || this.data.createOrderBusy) return;
    const orderName = (this.data.newOrderName || "").trim() || getDefaultNewOrderName();
    this.setData({ createOrderBusy: true });
    try {
      const res = await cloud.callFunctionWithErrorToast("orderFunctions", {
        type: "createOrder",
        familyId,
        orderName,
      });
      const orderId = res && res.orderId;
      this.setData({ showCreateOrderModal: false, newOrderName: "" });
      if (orderId) {
        getApp().globalData.homeDirty = true;
        wx.navigateTo({ url: `/pages/order/detail/index?orderId=${orderId}` });
      }
    } finally {
      this.setData({ createOrderBusy: false });
    }
  },

  async goRecipeList() {
    if (!(await this.guardGuestAction("查看菜谱需要先登录。"))) return;
    wx.navigateTo({ url: "/pages/recipe/list/index" });
  },

  async goRecipeAdd() {
    if (!(await this.guardGuestAction("添加菜谱需要先登录。"))) return;
    wx.navigateTo({ url: "/pages/recipe/add/index" });
  },

  async goRecipeDetail(e) {
    const recipeId = e.currentTarget.dataset.recipeid;
    if (!recipeId) return;
    if (!(await this.guardGuestAction("查看菜谱需要先登录。"))) return;
    wx.navigateTo({ url: `/pages/recipe/detail/index?recipeId=${recipeId}` });
  },
});
