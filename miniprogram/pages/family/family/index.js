const cloud = require("../../../utils/cloud");
const { resolveBatch, attachRecipeImgDisplay } = require("../../../utils/cloudDisplay");

Page({
  data: {
    familyName: "",
    inviteCode: "",
    families: [],
    familiesDisplay: [],
    recipeCounts: {},
    currentFamily: null,
    members: [],
    recipes: [],
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
    /** 弹窗：创建/加入家庭 */
    dialogVisible: false,
    dialogMode: "",
    dialogValue: "",
  },

  async onLoad() {
    try {
      await this.refreshFamiliesList();
    } finally {
      this.setData({ pageBooting: false });
    }
  },

  onFamilyNameInput(e) {
    this.setData({ familyName: e.detail.value || "" });
  },

  onInviteCodeInput(e) {
    this.setData({ inviteCode: e.detail.value || "" });
  },

  openJoinDialog() {
    if (this.data.actionBusy) return;
    this.setData({ dialogVisible: true, dialogMode: "join", dialogValue: "" });
  },

  openCreateDialog() {
    if (this.data.actionBusy) return;
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
    const recipeCounts = (countsResp && countsResp.counts) || {};
    this.setData({ recipeCounts });

    const openid = app.globalData.openid;
    const familiesDisplay = families.map((f) => {
      const isAdmin = !!(openid && f && f.adminId === openid);
      const roleText = isAdmin ? "管理员" : "成员";
      const recipeCount = recipeCounts && typeof recipeCounts[f._id] === "number" ? recipeCounts[f._id] : 0;
      return {
        ...f,
        isCurrent: !!(current && current._id === f._id),
        subtitle: `${roleText} | ${recipeCount}个菜谱`,
      };
    });
    this.setData({ familiesDisplay });
  },

  async fetchFamilyDetail(familyId) {
    const app = getApp();
    const families = this.data.families || app.globalData.families || [];
    const family = families.find((f) => f && f._id === familyId) || null;
    if (!family) return;

    this.setData({
      currentFamily: family,
      detailLoading: true,
      membersLoading: true,
      recipesLoading: true,
      members: [],
      recipes: [],
    });

    try {
      const [membersResp, recipesResp] = await Promise.all([
        cloud
          .callFunction("familyFunctions", { type: "getFamilyMembers", familyId })
          .catch(() => ({})),
        cloud
          .callFunction("recipeFunctions", { type: "listRecipes", familyId, keyword: "" })
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
        return { ...m, avatarUrlDisplay: m.avatarUrl };
      });
      this.setData({ members: quickMembers, membersLoading: false });

      const urls = sortedRawMembers.map((m) => m && m.avatarUrl).filter(Boolean);
      const map = await resolveBatch(urls, { familyId });
      const members = sortedRawMembers.map((m) => {
        if (!m) return m;
        const u = m.avatarUrl;
        const display = u && map[u] ? map[u] : u;
        return { ...m, avatarUrlDisplay: display || u };
      });

      const rawRecipes = (recipesResp && recipesResp.recipes) || [];
      const recipes = await attachRecipeImgDisplay(rawRecipes.slice(0, 60));

      this.setData({ members, recipes, recipesLoading: false });
    } finally {
      this.setData({ detailLoading: false, membersLoading: false, recipesLoading: false });
    }
  },

  async onCreateFamily() {
    if (!this.data.familyName) {
      wx.showToast({ title: "请输入家庭名称", icon: "none" });
      return;
    }
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    wx.showLoading({ title: "创建中…", mask: true });
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "createFamily",
        familyName: this.data.familyName,
      });
      this.setData({ familyName: "" });
      await this.refreshFamiliesList();
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
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "joinFamily",
        inviteCode: this.data.inviteCode,
      });
      this.setData({ inviteCode: "" });
      await this.refreshFamiliesList();
    } finally {
      wx.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  async onOpenFamily(e) {
    const familyId = e.currentTarget.dataset.familyid;
    if (!familyId || this.data.actionBusy) return;
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
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    wx.setClipboardData({
      data: currentFamily.inviteCode || "",
    });
    wx.showToast({ title: "邀请码已复制", icon: "none" });
  },

  async onKickMember(e) {
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    if (this.data.actionBusy) return;
    const memberId = e.currentTarget.dataset.memberid;
    this.setData({ actionBusy: true });
    wx.showLoading({ title: "处理中…", mask: true });
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "kickMember",
        familyId: currentFamily._id,
        memberId,
      });
      await this.fetchFamilyDetail(currentFamily._id);
    } finally {
      wx.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  async onExitFamily() {
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
});

