const cloud = require("../../../utils/cloud");
const { resolveBatch } = require("../../../utils/cloudDisplay");

Page({
  data: {
    familyName: "",
    inviteCode: "",
    families: [],
    currentFamily: null,
    members: [],
    /** 首屏拉取家庭/成员 */
    pageBooting: true,
    /** 切换家庭后、成员列表尚未返回时 */
    membersLoading: false,
    /** 防止重复点击：切换 / 创建 / 加入 / 踢人 / 退出 */
    actionBusy: false,
    /** 正在切换到的家庭 id，用于切换按钮 loading */
    switchingFamilyId: "",
  },

  async onLoad() {
    try {
      await this.refreshFamilies();
      await this.refreshMembers();
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

  async refreshFamilies() {
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
    this.setData({ currentFamily: current });
  },

  async refreshMembers() {
    const { currentFamily } = this.data;
    if (!currentFamily || !currentFamily._id) {
      this.setData({ members: [], membersLoading: false });
      return;
    }
    try {
      const resp = await cloud.callFunction("familyFunctions", {
        type: "getFamilyMembers",
        familyId: currentFamily._id,
      });
      const raw = (resp && resp.members) || [];
      const quickMembers = raw.map((m) => {
        if (!m) return m;
        return { ...m, avatarUrlDisplay: m.avatarUrl };
      });
      this.setData({ members: quickMembers, membersLoading: false });

      const urls = raw.map((m) => m && m.avatarUrl).filter(Boolean);
      const map = await resolveBatch(urls, { familyId: currentFamily._id });
      const members = raw.map((m) => {
        if (!m) return m;
        const u = m.avatarUrl;
        const display = u && map[u] ? map[u] : u;
        return { ...m, avatarUrlDisplay: display || u };
      });
      this.setData({ members });
    } catch (e) {
      this.setData({ members: [], membersLoading: false });
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
      await this.refreshFamilies();
      await this.refreshMembers();
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
      await this.refreshFamilies();
      await this.refreshMembers();
    } finally {
      wx.hideLoading();
      this.setData({ actionBusy: false });
    }
  },

  async onSwitchFamily(e) {
    const familyId = e.currentTarget.dataset.familyid;
    if (!familyId || this.data.actionBusy) return;
    const families = this.data.families || [];
    const next = families.find((f) => f._id === familyId) || null;
    const app = getApp();
    app.globalData.currentFamilyId = familyId;
    this.setData({
      actionBusy: true,
      membersLoading: true,
      members: [],
      currentFamily: next || this.data.currentFamily,
      switchingFamilyId: familyId,
    });
    try {
      await cloud.callFunctionWithErrorToast("familyFunctions", {
        type: "switchFamily",
        familyId,
      });
      await this.refreshFamilies();
      await this.refreshMembers();
    } catch (e) {
      await this.refreshFamilies();
      await this.refreshMembers();
    } finally {
      this.setData({
        actionBusy: false,
        membersLoading: false,
        switchingFamilyId: "",
      });
    }
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
      await this.refreshMembers();
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
      await this.refreshFamilies();
      await this.refreshMembers();
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

