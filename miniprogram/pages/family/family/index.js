const cloud = require("../../../utils/cloud");
const { resolveBatch } = require("../../../utils/cloudDisplay");

Page({
  data: {
    familyName: "",
    inviteCode: "",
    families: [],
    currentFamily: null,
    members: [],
  },

  async onLoad() {
    await this.refreshFamilies();
    await this.refreshMembers();
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
      this.setData({ members: [] });
      return;
    }
    const resp = await cloud.callFunction("familyFunctions", {
      type: "getFamilyMembers",
      familyId: currentFamily._id,
    });
    const raw = (resp && resp.members) || [];
    const urls = raw.map((m) => m && m.avatarUrl).filter(Boolean);
    const map = await resolveBatch(urls, { familyId: currentFamily._id });
    const members = raw.map((m) => {
      if (!m) return m;
      const u = m.avatarUrl;
      const display = u && map[u] ? map[u] : u;
      return { ...m, avatarUrlDisplay: display || u };
    });
    this.setData({ members });
  },

  async onCreateFamily() {
    if (!this.data.familyName) {
      wx.showToast({ title: "请输入家庭名称", icon: "none" });
      return;
    }
    await cloud.callFunctionWithErrorToast("familyFunctions", {
      type: "createFamily",
      familyName: this.data.familyName,
    });

    this.setData({ familyName: "" });
    await this.refreshFamilies();
    await this.refreshMembers();
  },

  async onJoinFamily() {
    if (!this.data.inviteCode) {
      wx.showToast({ title: "请输入家庭邀请码", icon: "none" });
      return;
    }
    await cloud.callFunctionWithErrorToast("familyFunctions", {
      type: "joinFamily",
      inviteCode: this.data.inviteCode,
    });

    this.setData({ inviteCode: "" });
    await this.refreshFamilies();
    await this.refreshMembers();
  },

  async onSwitchFamily(e) {
    const familyId = e.currentTarget.dataset.familyid;
    await cloud.callFunctionWithErrorToast("familyFunctions", {
      type: "switchFamily",
      familyId,
    });
    const app = getApp();
    app.globalData.currentFamilyId = familyId;
    await this.refreshFamilies();
    await this.refreshMembers();
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
    const memberId = e.currentTarget.dataset.memberid;
    await cloud.callFunctionWithErrorToast("familyFunctions", {
      type: "kickMember",
      familyId: currentFamily._id,
      memberId,
    });
    await this.refreshMembers();
  },

  async onExitFamily() {
    const { currentFamily } = this.data;
    if (!currentFamily) return;
    await cloud.callFunctionWithErrorToast("familyFunctions", {
      type: "exitFamily",
      familyId: currentFamily._id,
    });
    await this.refreshFamilies();
    await this.refreshMembers();
  },

  // 判断是否管理员（前端仅用于展示；真实权限由云端校验）
  isAdmin() {
    const app = getApp();
    const openid = app.globalData.openid;
    const { currentFamily } = this.data;
    return !!(openid && currentFamily && currentFamily.adminId === openid);
  },
});

