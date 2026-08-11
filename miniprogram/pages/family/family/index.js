const cloud = require("../../../utils/cloud");
const auth = require("../../../utils/auth");
const share = require("../../../utils/share");
const invite = require("../../../utils/invite");
const haptics = require("../../../utils/haptics");
const ui = require("../../../utils/ui");

Page({
  data: {
    userNickName: "",
    userAvatarUrl: "",
    familyName: "",
    inviteCode: "",
    families: [],
    familiesDisplay: [],
    recipeCounts: {},
    currentFamily: null,
    members: [],
    /** 首屏拉取家庭/成员 */
    pageBooting: true,
    /** 切换家庭/加载详情时 */
    detailLoading: false,
    membersLoading: false,
    /** 防止重复点击：切换 / 创建 / 加入 / 踢人 / 退出 */
    actionBusy: false,
    /** 正在切换到的家庭 id，用于切换按钮 loading */
    switchingFamilyId: "",
    /** 页面模式：先列表，再详情 */
    viewMode: "list",
    /** 干饭日历：当前展示的年月与格子 */
    mealCalYear: 0,
    mealCalMonth: 0,
    mealWeekdayLabels: ["日", "一", "二", "三", "四", "五", "六"],
    calendarCells: [],
    calendarLoading: false,
    calAnimFlip: false,
    mealCalMonthExpense: 0,
    mealCalMonthExpenseText: "0",
    /** 干饭日历：按日聚合的订单详情（弹窗用） */
    mealCalDayMap: {},
    mealCalModalVisible: false,
    mealCalModalTitle: "",
    mealCalModalOrders: [],
    /** 弹窗：创建/加入家庭 */
    dialogVisible: false,
    dialogMode: "",
    dialogValue: "",
    /** 当前用户是否为家庭管理员（详情页展示移除按钮） */
    isCurrentFamilyAdmin: false,
    currentOpenid: "",
    /** 下拉刷新 */
    refreshing: false,
    confirmModal: {
      visible: false,
      kicker: "",
      title: "",
      content: "",
      confirmText: "确认",
      danger: false,
    },
  },

  openConfirm(opts, action) {
    this._confirmAction = action || null;
    this.setData({
      confirmModal: {
        visible: true,
        kicker: opts.kicker || "",
        title: opts.title || "",
        content: opts.content || "",
        confirmText: opts.confirmText || "确认",
        danger: !!opts.danger,
      },
    });
  },

  async onConfirmModalOk() {
    const action = this._confirmAction;
    this._confirmAction = null;
    this.setData({ "confirmModal.visible": false });
    if (action) await action();
  },

  onConfirmModalCancel() {
    this._confirmAction = null;
    this.setData({ "confirmModal.visible": false });
  },

  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      if (this.data.viewMode === "detail" && this.data.currentFamily) {
        await this.fetchFamilyDetail(this.data.currentFamily._id);
      } else {
        await this.refreshFamiliesList();
      }
    } finally {
      this.setData({ refreshing: false });
    }
  },

  async onLoad() {
    const app = getApp();
    const ui = app && app.globalData && app.globalData.userInfo ? app.globalData.userInfo : null;
    this.setData({
      userNickName: (ui && (ui.nickName || ui.nickname)) || "",
      userAvatarUrl: (ui && (ui.avatarUrl || ui.avatar)) || "",
    });

    // 登录流程已拉过家庭列表：先用缓存渲染首屏，后台再刷新校验
    const cached = (app.globalData && app.globalData.families) || [];
    if (cached.length) {
      const currentFamilyId = app.globalData.currentFamilyId;
      const current = cached.find((f) => f && f._id === currentFamilyId) || cached[0] || null;
      this.setData({ families: cached, currentFamily: current, pageBooting: false });
      this.applyFamiliesDisplay(cached, current, this.data.recipeCounts);
      this._prefetchDetail(current);
      this.refreshFamiliesList().catch(() => {});
      return;
    }

    try {
      await this.refreshFamiliesList();
    } catch (e) {
      /* 保留空态，可下拉重试 */
    } finally {
      this.setData({ pageBooting: false });
    }
  },

  onShow() {
    if (this.data.viewMode === "detail" && this.data.currentFamily && this.data.currentFamily._id) {
      this.fetchMealCalendar();
    }
  },

  onBack() {
    if (this.data.viewMode === "detail") {
      this.onBackToList();
      return;
    }
    wx.navigateBack();
  },

  onFamilyNameInput(e) {
    this.setData({ familyName: e.detail.value || "" });
  },

  onInviteCodeInput(e) {
    this.setData({ inviteCode: e.detail.value || "" });
  },

  async openJoinDialog() {
    if (this.data.actionBusy) return;
    const r = await auth.requireLoggedIn({ content: "加入家庭需要先登录。" });
    if (!r.ok) return;
    this.setData({ dialogVisible: true, dialogMode: "join", dialogValue: "" });
  },

  async openCreateDialog() {
    if (this.data.actionBusy) return;
    const r = await auth.requireLoggedIn({ content: "创建家庭需要先登录。" });
    if (!r.ok) return;
    this.setData({ dialogVisible: true, dialogMode: "create", dialogValue: "" });
  },

  closeDialog() {
    if (!this.data.dialogVisible) return;
    this.setData({ dialogVisible: false, dialogMode: "", dialogValue: "" });
  },

  onDialogValueInput(e) {
    this.setData({ dialogValue: (e && e.detail && e.detail.value) || "" });
  },

  async onDialogConfirm() {
    const v = (this.data.dialogValue || "").trim();
    if (!v) {
      wx.showToast({
        title: this.data.dialogMode === "create" ? "请输入家庭名称" : "请输入家庭邀请码",
        icon: "none",
      });
      return;
    }
    if (this.data.dialogMode === "create") {
      this.setData({ familyName: v });
      await this.onCreateFamily();
    } else if (this.data.dialogMode === "join") {
      this.setData({ inviteCode: v });
      await this.onJoinFamily();
    }
    this.closeDialog();
  },

  async refreshFamiliesList() {
    const app = getApp();
    const resp = await cloud.callFunction("familyFunctions", {
      type: "getMyFamilies",
    });

    const families = (resp && resp.families) || [];
    app.globalData.families = families;
    this.setData({ families });

    const currentFamilyId = app.globalData.currentFamilyId;
    let current = null;
    if (currentFamilyId) {
      current = families.find((f) => f._id === currentFamilyId) || null;
    }
    if (!current && families[0]) {
      app.globalData.currentFamilyId = families[0]._id;
      current = families[0];
    }
    this.setData({ currentFamily: current || null });

    // 先渲染列表壳（角色/人数/名称已齐），菜谱计数随后补上，不再阻塞首屏
    this.applyFamiliesDisplay(families, current, this.data.recipeCounts);

    const recipeCounts = await this.fetchRecipeCounts(families, current);
    this.setData({ recipeCounts });
    this.applyFamiliesDisplay(families, current, recipeCounts);

    // 列表数据就绪后后台预取详情（成员 + 当月月历），点进详情秒开
    this._prefetchDetail(current);
  },

  /** 拉取各家庭菜谱计数（批量统计为 0 时对当前家庭兜底一次） */
  async fetchRecipeCounts(families, current) {
    const ids = families.map((f) => f && f._id).filter(Boolean);
    if (!ids.length) return {};
    const countsResp = await cloud
      .callFunction("recipeFunctions", {
        type: "countRecipesByFamilyIds",
        familyIds: ids,
      })
      .catch(() => ({}));
    const recipeCountsFromBatch = (countsResp && countsResp.counts) || {};
    const recipeCounts = { ...recipeCountsFromBatch };

    // 批量统计为 0 时，仅对「当前家庭」拉一次列表兜底，避免多家庭并发全表 listRecipes 拖慢首屏
    const currentId = current && current._id ? current._id : "";
    await Promise.all(
      ids.map(async (familyId) => {
        const batchCount =
          recipeCountsFromBatch && typeof recipeCountsFromBatch[familyId] === "number"
            ? recipeCountsFromBatch[familyId]
            : null;
        if (typeof batchCount === "number" && batchCount > 0) return;
        if (!currentId || familyId !== currentId) {
          if (typeof batchCount === "number") recipeCounts[familyId] = batchCount;
          return;
        }
        const listResp = await cloud
          .callFunction("recipeFunctions", { type: "listRecipesForHome", familyId, limit: 1 })
          .catch(() => ({}));
        const total =
          listResp && typeof listResp.totalCount === "number"
            ? listResp.totalCount
            : ((listResp && listResp.recipes) || []).length;
        recipeCounts[familyId] = total;
      })
    );
    return recipeCounts;
  },

  /** 组装列表展示数据（计数缺失时先按家庭文档自带字段或 0 展示，计数到达后重调本方法刷新） */
  applyFamiliesDisplay(families, current, recipeCounts) {
    const app = getApp();
    const openid = app.globalData.openid;
    const familiesDisplay = families.map((f) => {
      const isAdmin = !!(openid && f && f.adminId === openid);
      const roleText = isAdmin ? "管理员" : "成员";
      const recipeCountFromCloud = recipeCounts && typeof recipeCounts[f._id] === "number" ? recipeCounts[f._id] : null;
      const recipeCountFromFamily =
        typeof f.recipeCount === "number"
          ? f.recipeCount
          : typeof f.recipesCount === "number"
            ? f.recipesCount
            : Array.isArray(f.recipeIds)
              ? f.recipeIds.length
              : null;
      const recipeCount =
        typeof recipeCountFromCloud === "number"
          ? recipeCountFromCloud
          : typeof recipeCountFromFamily === "number"
            ? recipeCountFromFamily
            : 0;
      const memberCount = Array.isArray(f && f.memberIds) ? f.memberIds.length : 0;
      return {
        ...f,
        isCurrent: !!(current && current._id === f._id),
        subtitle: `${roleText} · ${memberCount} 人 · ${recipeCount} 个菜谱`,
      };
    });
    this.setData({ familiesDisplay });
  },

  /** 列表页渲染后后台预取详情数据（成员 + 当月月历），点进详情时直接消费/命中缓存 */
  _prefetchDetail(family) {
    if (!family || !family._id) return;
    const familyId = family._id;
    this._detailPrefetch = {
      familyId,
      membersPromise: cloud
        .callFunction("familyFunctions", { type: "getFamilyMembers", familyId })
        .catch(() => ({})),
    };
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const key = `${familyId}:${y}:${m}`;
    if (this._calCache && this._calCache[key]) return; // 当月已预热过
    this._fetchMealCalendarData(familyId, y, m)
      .then((res) => {
        this._calCacheSet(key, this._processMealCalendar(res));
      })
      .catch(() => {});
  },

  async fetchFamilyDetail(familyId) {
    const app = getApp();
    const openid = app.globalData.openid || "";
    const families = this.data.families || app.globalData.families || [];
    const family = families.find((f) => f && f._id === familyId) || null;
    if (!family) return;

    const calNow = new Date();
    this.setData({
      currentFamily: family,
      isCurrentFamilyAdmin: !!(openid && family.adminId === openid),
      currentOpenid: openid,
      detailLoading: true,
      membersLoading: true,
      members: [],
      mealCalYear: calNow.getFullYear(),
      mealCalMonth: calNow.getMonth() + 1,
      calendarCells: [],
      mealCalDayMap: {},
    });

    // 预取命中（列表页渲染时已后台发出）则复用，否则现场发起
    const pre = this._detailPrefetch;
    this._detailPrefetch = null;
    const membersPromise =
      pre && pre.familyId === familyId && pre.membersPromise
        ? pre.membersPromise
        : cloud
            .callFunction("familyFunctions", { type: "getFamilyMembers", familyId })
            .catch(() => ({}));
    // 月历与成员互不依赖，立即并行（预取已写入缓存时这里直接命中）
    const calPromise = this.fetchMealCalendar();

    try {
      const membersResp = await membersPromise;

      const rawMembers = (membersResp && membersResp.members) || [];
      const sortedRawMembers = (() => {
        const adminId = family && family.adminId ? family.adminId : "";
        if (!adminId) return rawMembers;
        const admin = rawMembers.find((m) => m && m._id === adminId);
        const rest = rawMembers.filter((m) => !(m && m._id === adminId));
        return admin ? [admin, ...rest] : rawMembers;
      })();

      this.setData({ members: sortedRawMembers, membersLoading: false });

      await calPromise;
    } finally {
      this.setData({ detailLoading: false, membersLoading: false });
    }
  },

  buildCalendarCells(year, month, byDay) {
    const first = new Date(year, month - 1, 1);
    const firstWeekday = first.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ type: "pad", cellKey: `p-${i}` });
    }
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${ym}-${String(d).padStart(2, "0")}`;
      const orders = byDay[key] || [];
      const orderCount = orders.length;
      const dayExpense = orders.reduce((sum, o) => sum + this.parseShoppingExpense(o && o.shoppingExpense), 0);
      cells.push({
        type: "day",
        day: d,
        orders,
        cellKey: key,
        orderCount,
        dayExpense,
        isToday: key === todayKey,
        expenseText: orderCount > 0 ? this.formatExpenseShort(dayExpense, true) : "",
      });
    }
    const remainder = cells.length % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) {
        cells.push({ type: "pad", cellKey: `e-${i}` });
      }
    }
    return cells;
  },

  formatExpenseShort(amount, allowZero) {
    if (!amount || amount <= 0) return allowZero ? "0" : "";
    if (amount >= 1000) return `${Math.round(amount)}`;
    if (amount >= 100) return String(Math.round(amount));
    if (Number.isInteger(amount)) return String(amount);
    return amount.toFixed(1).replace(/\.0$/, "");
  },

  parseShoppingExpense(val) {
    if (val == null || val === "") return 0;
    const n = typeof val === "number" ? val : parseFloat(String(val).trim());
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
  },

  formatExpenseFull(amount) {
    if (!amount || amount <= 0) return "0";
    const rounded = Math.round(amount * 100) / 100;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  },

  /** 拉取某月干饭日历原始数据（listCompletedOrdersInMonth） */
  async _fetchMealCalendarData(familyId, year, month) {
    const res = await cloud.callFunction("orderFunctions", {
      type: "listCompletedOrdersInMonth",
      familyId,
      year,
      month,
    });
    return res || {};
  },

  /** 原始返回 → 按日聚合 + 月度总消费（与渲染解耦，便于缓存/预取复用） */
  _processMealCalendar(res) {
    const list = (res && res.orders) || [];
    const byDay = {};
    list.forEach((o) => {
      // calendarDate = 开始制作日（云函数计算）；兜底旧字段
      const t = o.calendarDate || o.shoppingCompletedAt || o.completedAt;
      if (!t) return;
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!byDay[key]) byDay[key] = [];
      const expense = this.parseShoppingExpense(o.shoppingExpense);
      byDay[key].push({
        _id: o._id,
        orderName: o.orderName || "点菜单",
        recipeNames: Array.isArray(o.recipeNames) ? o.recipeNames : [],
        durationText: o.durationText || "—",
        timeRangeText: o.timeRangeText || "—",
        shoppingExpense: expense,
        expenseText: this.formatExpenseFull(expense),
      });
    });
    const monthExpenseTotal =
      res && typeof res.monthExpenseTotal === "number"
        ? res.monthExpenseTotal
        : list.reduce((sum, o) => sum + this.parseShoppingExpense(o && o.shoppingExpense), 0);
    return { byDay, monthExpenseTotal };
  },

  _calCacheSet(key, processed) {
    this._calCache = this._calCache || {};
    this._calCache[key] = processed;
  },

  _applyMealCalendar(processed, year, month) {
    const calendarCells = this.buildCalendarCells(year, month, processed.byDay);
    this.setData({
      calendarCells,
      mealCalDayMap: processed.byDay,
      mealCalMonthExpense: processed.monthExpenseTotal,
      mealCalMonthExpenseText: this.formatExpenseFull(processed.monthExpenseTotal),
      calAnimFlip: !this.data.calAnimFlip,
    });
  },

  /** 后台刷新某月数据并更新缓存；页面仍停留在该月时同步界面 */
  async _refreshMealCalendarData(familyId, year, month, key) {
    try {
      const res = await this._fetchMealCalendarData(familyId, year, month);
      const processed = this._processMealCalendar(res);
      this._calCacheSet(key, processed);
      if (
        this.data.viewMode === "detail" &&
        this.data.currentFamily &&
        this.data.currentFamily._id === familyId &&
        this.data.mealCalYear === year &&
        this.data.mealCalMonth === month
      ) {
        this._applyMealCalendar(processed, year, month);
      }
    } catch (e) {
      /* 保留缓存数据 */
    }
  },

  async fetchMealCalendar() {
    const familyId = this.data.currentFamily && this.data.currentFamily._id;
    if (!familyId || this.data.viewMode !== "detail") return;
    const { mealCalYear, mealCalMonth } = this.data;
    if (!mealCalYear || !mealCalMonth) return;

    const key = `${familyId}:${mealCalYear}:${mealCalMonth}`;
    const cached = this._calCache && this._calCache[key];
    if (cached) {
      // 命中缓存（含列表页预取）：立即渲染，后台静默刷新
      this._applyMealCalendar(cached, mealCalYear, mealCalMonth);
      this._refreshMealCalendarData(familyId, mealCalYear, mealCalMonth, key);
      return;
    }

    this.setData({ calendarLoading: true });
    try {
      const res = await this._fetchMealCalendarData(familyId, mealCalYear, mealCalMonth);
      const processed = this._processMealCalendar(res);
      this._calCacheSet(key, processed);
      this._applyMealCalendar(processed, mealCalYear, mealCalMonth);
    } catch (e) {
      this.setData({
        calendarCells: [],
        mealCalDayMap: {},
        mealCalMonthExpense: 0,
        mealCalMonthExpenseText: "0",
      });
    } finally {
      this.setData({ calendarLoading: false });
    }
  },

  onPrevMealMonth() {
    let { mealCalYear, mealCalMonth } = this.data;
    mealCalMonth -= 1;
    if (mealCalMonth < 1) {
      mealCalMonth = 12;
      mealCalYear -= 1;
    }
    this.setData({ mealCalYear, mealCalMonth });
    this.fetchMealCalendar();
  },

  onNextMealMonth() {
    let { mealCalYear, mealCalMonth } = this.data;
    mealCalMonth += 1;
    if (mealCalMonth > 12) {
      mealCalMonth = 1;
      mealCalYear += 1;
    }
    this.setData({ mealCalYear, mealCalMonth });
    this.fetchMealCalendar();
  },

  onMealCalDayTap(e) {
    const orderCount = Number(e.currentTarget.dataset.ordercount || 0);
    const key = e.currentTarget.dataset.daykey;
    if (!orderCount || !key) return;
    const map = this.data.mealCalDayMap || {};
    const raw = map[key] || [];
    const mealCalModalOrders = raw.map((o) => ({
      ...o,
      recipeNames: Array.isArray(o.recipeNames) ? o.recipeNames : [],
    }));
    const parts = String(key).split("-");
    const y = parts[0];
    const mo = parts[1];
    const day = parts[2];
    const dayTotal = raw.reduce((sum, o) => sum + this.parseShoppingExpense(o && o.shoppingExpense), 0);
    const mealCalModalTitle = `${y}年${Number(mo)}月${Number(day)}日 · ¥${this.formatExpenseFull(dayTotal)}`;
    this.setData({ mealCalModalVisible: true, mealCalModalTitle, mealCalModalOrders });
  },

  closeMealCalModal() {
    this.setData({ mealCalModalVisible: false });
  },

  noop() {},

  async onCreateFamily() {
    if (!this.data.familyName) {
      wx.showToast({ title: "请输入家庭名称", icon: "none" });
      return;
    }
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    ui.showLoading("创建中…", true);
    try {
      const resp = await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "createFamily",
        familyName: this.data.familyName,
      });
      const app = getApp();
      if (resp && resp.familyId) {
        app.globalData.currentFamilyId = resp.familyId;
      }
      this.setData({ familyName: "" });
      await this.refreshFamiliesList();
      haptics.success();
      wx.showToast({ title: "已创建家庭", icon: "success" });
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/index/index?onboard=1" });
      }, 500);
    } finally {
      ui.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  async onJoinFamily() {
    if (!this.data.inviteCode) {
      wx.showToast({ title: "请输入家庭邀请码", icon: "none" });
      return;
    }
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    ui.showLoading("加入中…", true);
    try {
      const resp = await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "joinFamily",
        inviteCode: this.data.inviteCode,
      });
      const app = getApp();
      if (resp && resp.familyId) {
        app.globalData.currentFamilyId = resp.familyId;
      }
      this.setData({ inviteCode: "" });
      await this.refreshFamiliesList();
      haptics.success();
      wx.showToast({ title: "已加入家庭", icon: "success" });
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/index/index?onboard=1" });
      }, 500);
    } finally {
      ui.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  async onOpenFamily(e) {
    const familyId = e.currentTarget.dataset.familyid;
    if (!familyId || this.data.actionBusy) return;
    const r = await auth.requireLoggedIn({ content: "查看与管理家庭详情需要先登录。" });
    if (!r.ok) return;
    const app = getApp();
    app.globalData.currentFamilyId = familyId;
    this.setData({
      actionBusy: true,
      switchingFamilyId: familyId,
      viewMode: "detail",
    });
    try {
      // 详情先行（预取/缓存直接命中即秒开）；切换与列表刷新后台进行，不再阻塞渲染
      await this.fetchFamilyDetail(familyId);
      cloud
        .callFunctionWithErrorToast("familyFunctions", {
          type: "switchFamily",
          familyId,
        })
        .then(() => this.refreshFamiliesList())
        .catch(() => {});
    } finally {
      this.setData({
        actionBusy: false,
        switchingFamilyId: "",
      });
    }
  },

  onBackToList() {
    this.setData({ viewMode: "list" });
  },

  onGoManage() {
    wx.pageScrollTo({ selector: "#manageAnchor", duration: 260 });
  },

  roleTextForMember(memberId) {
    const { currentFamily } = this.data;
    if (!currentFamily) return "成员";
    return currentFamily.adminId === memberId ? "管理员" : "成员";
  },

  async onCopyInviteCode() {
    const r = await auth.requireLoggedIn({ content: "复制邀请码需要先登录。" });
    if (!r.ok) return;
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    wx.setClipboardData({
      data: currentFamily.inviteCode || "",
    });
    wx.showToast({ title: "邀请码已复制", icon: "none" });
  },

  async onKickMember(e) {
    const r = await auth.requireLoggedIn({ content: "管理成员需要先登录。" });
    if (!r.ok) return;
    const { currentFamily } = this.data;
    if (!currentFamily || !this.data.isCurrentFamilyAdmin) return;
    if (this.data.actionBusy) return;

    const memberId = e.currentTarget.dataset.memberid;
    const nickName = (e.currentTarget.dataset.nickname || "该成员").trim();
    if (!memberId) return;
    if (memberId === this.data.currentOpenid) return;
    if (memberId === currentFamily.adminId) return;

    this.openConfirm(
      {
        kicker: "移除成员",
        title: `确定将「${nickName}」移出家庭吗？`,
        content: "移除后对方将无法查看本家庭菜谱与点菜单。",
        confirmText: "移除",
        danger: true,
      },
      async () => {
        this.setData({ actionBusy: true });
        ui.showLoading("移除中…", true);
        try {
          await cloud.callFunctionWithErrorToast("familyFunctions", {
            type: "kickMember",
            familyId: currentFamily._id,
            memberId,
          });
          haptics.medium();
          wx.showToast({ title: "已移除成员", icon: "success" });
          await this.refreshFamiliesList();
          await this.fetchFamilyDetail(currentFamily._id);
        } finally {
          ui.hideLoading();
          this.setData({ actionBusy: false });
        }
      }
    );
  },

  async onExitFamily() {
    const r = await auth.requireLoggedIn({ content: "退出家庭需要先登录。" });
    if (!r.ok) return;
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    ui.showLoading("退出中…", true);
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "exitFamily",
        familyId: currentFamily._id,
      });
      await this.refreshFamiliesList();
      this.setData({ viewMode: "list" });
    } finally {
      ui.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  // 判断是否管理员（前端仅用于展示；真实权限由云端校验）
  isAdmin() {
    const app = getApp();
    const openid = app.globalData.openid;
    const { currentFamily } = this.data;
    return !!(openid && currentFamily && currentFamily.adminId === openid);
  },

  onShareAppMessage() {
    const { currentFamily, viewMode } = this.data;
    if (viewMode !== "detail" || !currentFamily || !currentFamily.inviteCode) {
      return share.defaultShareAppMessage();
    }
    const name = currentFamily.familyName || "家庭";
    return {
      title: `邀请你加入「${name}」一起玩饭桶宝`,
      path: invite.buildFamilyInvitePath(currentFamily.inviteCode),
      imageUrl: share.FAMILY_INVITE_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    const { currentFamily, viewMode } = this.data;
    if (viewMode !== "detail" || !currentFamily || !currentFamily.inviteCode) {
      return share.defaultShareTimeline();
    }
    const name = currentFamily.familyName || "家庭";
    return {
      title: `邀请你加入「${name}」一起玩饭桶宝`,
      query: `inviteCode=${encodeURIComponent(currentFamily.inviteCode)}`,
    };
  },
});

