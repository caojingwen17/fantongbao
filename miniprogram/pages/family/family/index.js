const cloud = require("../../../utils/cloud");
const auth = require("../../../utils/auth");
const share = require("../../../utils/share");
const invite = require("../../../utils/invite");
const { resolveBatch, attachRecipeImgDisplay } = require("../../../utils/cloudDisplay");

/** cloud:// 不能直接作 image src（开发者工具会拼成页面相对路径）；仅使用解析后的 https 或原 http(s) */
function avatarUrlForDisplay(raw, fileIdToHttps) {
  const u = raw || "";
  if (!u) return "";
  if (String(u).indexOf("cloud://") === 0) {
    const resolved = fileIdToHttps && fileIdToHttps[u];
    if (resolved && /^https?:\/\//i.test(String(resolved))) return resolved;
    return "";
  }
  return u;
}

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
    recipes: [],
    recipeTotalCount: 0,
    /** 首屏拉取家庭/成员 */
    pageBooting: true,
    /** 切换家庭/加载详情时 */
    detailLoading: false,
    membersLoading: false,
    recipesLoading: false,
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
  },

  async onLoad() {
    const app = getApp();
    const ui = app && app.globalData && app.globalData.userInfo ? app.globalData.userInfo : null;
    this.setData({
      userNickName: (ui && (ui.nickName || ui.nickname)) || "",
      userAvatarUrl: (ui && (ui.avatarUrl || ui.avatar)) || "",
    });
    try {
      await this.refreshFamiliesList();
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

    const ids = families.map((f) => f && f._id).filter(Boolean);
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
    this.setData({ recipeCounts });

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
      recipesLoading: true,
      members: [],
      recipes: [],
      recipeTotalCount: 0,
      mealCalYear: calNow.getFullYear(),
      mealCalMonth: calNow.getMonth() + 1,
      calendarCells: [],
      mealCalDayMap: {},
    });

    try {
      const [membersResp, recipesResp, orderCountResp] = await Promise.all([
        cloud
          .callFunction("familyFunctions", { type: "getFamilyMembers", familyId })
          .catch(() => ({})),
        cloud
          .callFunction("recipeFunctions", { type: "listRecipes", familyId, keyword: "" })
          .catch(() => ({})),
        cloud
          .callFunction("orderFunctions", { type: "countRecipeOrdersInFamily", familyId })
          .catch(() => ({})),
      ]);

      const rawMembers = (membersResp && membersResp.members) || [];
      const sortedRawMembers = (() => {
        const adminId = family && family.adminId ? family.adminId : "";
        if (!adminId) return rawMembers;
        const admin = rawMembers.find((m) => m && m._id === adminId);
        const rest = rawMembers.filter((m) => !(m && m._id === adminId));
        return admin ? [admin, ...rest] : rawMembers;
      })();

      const quickMembers = sortedRawMembers.map((m) => {
        if (!m) return m;
        return { ...m, avatarUrlDisplay: avatarUrlForDisplay(m.avatarUrl, {}) };
      });
      this.setData({ members: quickMembers, membersLoading: false });

      const urls = sortedRawMembers.map((m) => m && m.avatarUrl).filter(Boolean);
      const map = await resolveBatch(urls, { familyId });
      const members = sortedRawMembers.map((m) => {
        if (!m) return m;
        return { ...m, avatarUrlDisplay: avatarUrlForDisplay(m.avatarUrl, map) };
      });

      const rawRecipes = (recipesResp && recipesResp.recipes) || [];
      const recipeTotalCount = rawRecipes.length;
      const orderCounts = (orderCountResp && orderCountResp.counts) || {};
      const sorted = [...rawRecipes].sort((a, b) => {
        const ida = a && a.id ? a.id : "";
        const idb = b && b.id ? b.id : "";
        const ca = typeof orderCounts[ida] === "number" ? orderCounts[ida] : 0;
        const cb = typeof orderCounts[idb] === "number" ? orderCounts[idb] : 0;
        if (cb !== ca) return cb - ca;
        const ta = a && a.createTime ? new Date(a.createTime).getTime() : 0;
        const tb = b && b.createTime ? new Date(b.createTime).getTime() : 0;
        return tb - ta;
      });
      const top7 = sorted.slice(0, 7);
      const recipes = await attachRecipeImgDisplay(top7);

      this.setData({ members, recipes, recipeTotalCount, recipesLoading: false });
      await this.fetchMealCalendar();
    } finally {
      this.setData({ detailLoading: false, membersLoading: false, recipesLoading: false });
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

  async fetchMealCalendar() {
    const familyId = this.data.currentFamily && this.data.currentFamily._id;
    if (!familyId || this.data.viewMode !== "detail") return;
    const { mealCalYear, mealCalMonth } = this.data;
    if (!mealCalYear || !mealCalMonth) return;
    this.setData({ calendarLoading: true });
    try {
      const res = await cloud.callFunction("orderFunctions", {
        type: "listCompletedOrdersInMonth",
        familyId,
        year: mealCalYear,
        month: mealCalMonth,
      });
      const list = (res && res.orders) || [];
      const byDay = {};
      list.forEach((o) => {
        const t = o.shoppingCompletedAt || o.completedAt;
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
        typeof res.monthExpenseTotal === "number"
          ? res.monthExpenseTotal
          : list.reduce((sum, o) => sum + this.parseShoppingExpense(o && o.shoppingExpense), 0);
      const calendarCells = this.buildCalendarCells(mealCalYear, mealCalMonth, byDay);
      this.setData({
        calendarCells,
        mealCalDayMap: byDay,
        mealCalMonthExpense: monthExpenseTotal,
        mealCalMonthExpenseText: this.formatExpenseFull(monthExpenseTotal),
      });
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
    wx.showLoading({ title: "创建中…", mask: true });
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
      wx.showToast({ title: "已创建家庭", icon: "success" });
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/index/index?onboard=1" });
      }, 500);
    } finally {
      wx.hideLoading();
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
    wx.showLoading({ title: "加入中…", mask: true });
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
      wx.showToast({ title: "已加入家庭", icon: "success" });
      setTimeout(() => {
        wx.reLaunch({ url: "/pages/index/index?onboard=1" });
      }, 500);
    } finally {
      wx.hideLoading();
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
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "switchFamily",
        familyId,
      });
      await this.refreshFamiliesList();
      await this.fetchFamilyDetail(familyId);
    } catch (e) {
      await this.refreshFamiliesList();
      await this.fetchFamilyDetail(familyId);
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

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: "移除成员",
        content: `确定将「${nickName}」移出家庭吗？移除后对方将无法查看本家庭菜谱与点菜单。`,
        confirmText: "移除",
        confirmColor: "#dc2626",
        cancelText: "取消",
        success: (res) => resolve(!!(res && res.confirm)),
        fail: () => resolve(false),
      });
    });
    if (!confirmed) return;

    this.setData({ actionBusy: true });
    wx.showLoading({ title: "移除中…", mask: true });
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "kickMember",
        familyId: currentFamily._id,
        memberId,
      });
      wx.showToast({ title: "已移除成员", icon: "success" });
      await this.refreshFamiliesList();
      await this.fetchFamilyDetail(currentFamily._id);
    } finally {
      wx.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  async onExitFamily() {
    const r = await auth.requireLoggedIn({ content: "退出家庭需要先登录。" });
    if (!r.ok) return;
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    wx.showLoading({ title: "退出中…", mask: true });
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "exitFamily",
        familyId: currentFamily._id,
      });
      await this.refreshFamiliesList();
      this.setData({ viewMode: "list" });
    } finally {
      wx.hideLoading();
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

