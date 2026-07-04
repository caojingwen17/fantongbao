const cloud = require("wx-server-sdk");
const { getOpenidOrThrow, isNotMemberError } = require("./auth");
const { assertTextsSafe, assertCloudImageSafe } = require("./sec");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function now() {
  return new Date();
}

function getWXContext() {
  return cloud.getWXContext();
}

function isCollectionNotExistError(e) {
  const msg = (e && (e.errMsg || e.message)) || "";
  return (
    String(msg).includes("DATABASE_COLLECTION_NOT_EXIST") ||
    String(msg).includes("Db or Table not exist") ||
    String(msg).includes("collection not exists")
  );
}

function isCollectionAlreadyExistsError(e) {
  const msg = String((e && (e.errMsg || e.message)) || "");
  return (
    msg.includes("already exists") ||
    msg.includes("Collection already exists") ||
    msg.includes("collection exists") ||
    msg.includes("ResourceExist") ||
    msg.includes("Table exist") ||
    msg.includes("-501001") ||
    msg.includes("RESOURCE_EXIST")
  );
}

async function ensureCollection(collectionName) {
  // 关键目标：避免因“集合已存在”这类错误直接中断登录。
  // 后续如果集合仍不存在，getUser 等逻辑会再触发兜底并返回更明确的错误。
  try {
    await db.createCollection(collectionName);
  } catch (e) {
    // ignore all createCollection errors (already exists / no permission / transient)
  }
}

let _baseCollectionsEnsured = false;

async function ensureBaseCollections() {
  if (_baseCollectionsEnsured) return;
  const collections = [
    "users",
    "families",
    "recipes",
    "orders",
    "order_shopping_items",
    "order_cooking_steps",
  ];
  await Promise.all(collections.map((name) => ensureCollection(name)));
  _baseCollectionsEnsured = true;
}

function randInviteCode(len = 6) {
  // 只使用数字+大写字母，便于口述/输入
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const PLACEHOLDER_NICKNAMES = ["微信用户", "WeChat User"];

function pickRestorableUserProfile(user) {
  if (!user) return null;
  const nested = user.data || {};
  const nickName = String(user.nickName || nested.nickName || "").trim();
  const avatarUrl = String(user.avatarUrl || nested.avatarUrl || "").trim();
  if (!nickName || !avatarUrl) return null;
  if (PLACEHOLDER_NICKNAMES.includes(nickName)) return null;
  if (avatarUrl.indexOf("mmbiz/icTdbqWNOwNRna42") !== -1) return null;
  return { nickName, avatarUrl };
}

async function getUser(openid) {
  try {
    const snap = await db.collection("users").doc(openid).get();
    return snap && snap.data ? snap.data : null;
  } catch (e) {
    const msg = String((e && (e.errMsg || e.message)) || "");
    // 用户文档不存在：返回 null，走创建分支
    if (
      msg.includes("document with _id") &&
      (msg.includes("does not exist") || msg.includes("not exist"))
    ) {
      return null;
    }
    if (isCollectionNotExistError(e)) {
      await ensureCollection("users");
      const snap2 = await db.collection("users").doc(openid).get();
      return snap2 && snap2.data ? snap2.data : null;
    }
    throw e;
  }
}

async function assertFamilyMember({ openid, familyId }) {
  await ensureCollection("families");
  const family = await db.collection("families").where({ _id: familyId }).get();
  const fam = family && family.data && family.data[0] ? family.data[0] : null;
  if (!fam) throw new Error("家庭不存在");
  if (!Array.isArray(fam.memberIds) || !fam.memberIds.includes(openid)) {
    throw new Error("没有家庭访问权限");
  }
  return fam;
}

async function assertFamilyAdmin({ openid, familyId }) {
  const fam = await assertFamilyMember({ openid, familyId });
  if (fam.adminId !== openid) throw new Error("仅管理员可操作");
  return fam;
}

async function handleFamilyEvent(event) {
  if (event.type === "login" || event.type === "createFamily" || event.type === "joinFamily" || event.type === "previewFamilyInvite" || event.type === "restoreSession") {
    await ensureBaseCollections();
  }

  const ctx = getWXContext();
  const openid = ctx.OPENID;

  if (!event || !event.type) {
    throw new Error("缺少 type");
  }

  if (event.type !== "login" && event.type !== "previewFamilyInvite") {
    getOpenidOrThrow(ctx);
  }

  switch (event.type) {
    case "login": {
      const { nickName, avatarUrl } = event;

      if (!openid) throw new Error("缺少 openid");
      if (!nickName) throw new Error("缺少 nickName");
      if (!avatarUrl) throw new Error("缺少 avatarUrl");

      await assertTextsSafe(cloud, { openid, texts: [nickName], scene: 1 });
      if (String(avatarUrl).indexOf("cloud://") === 0) {
        await assertCloudImageSafe(cloud, avatarUrl);
      }

      const existing = await getUser(openid);
      if (existing) {
        await db.collection("users").doc(openid).update({
          data: { nickName, avatarUrl },
        });
      } else {
        await db.collection("users").doc(openid).set({
          data: {
            nickName,
            avatarUrl,
            familyIds: [],
            currentFamilyId: null,
            familyRoles: {},
            createTime: now(),
          },
        });
      }

      const afterLogin = await getUser(openid);
      return {
        success: true,
        openid,
        currentFamilyId: afterLogin && afterLogin.currentFamilyId ? afterLogin.currentFamilyId : null,
      };
    }

    /** 本地缓存清空后：凭 openid 恢复已注册用户的登录态 */
    case "restoreSession": {
      if (!openid) throw new Error("缺少 openid");

      const user = await getUser(openid);
      const profile = pickRestorableUserProfile(user);
      if (!profile) {
        return { success: true, restored: false, needManualLogin: true };
      }

      return {
        success: true,
        restored: true,
        openid,
        userInfo: profile,
        currentFamilyId: (user && user.currentFamilyId) || null,
      };
    }

    case "createFamily": {
      const { familyName } = event;
      if (!familyName) throw new Error("缺少 familyName");

      await assertTextsSafe(cloud, { openid, texts: [familyName], scene: 1 });

      // 确保用户存在（未登录先创建时）
      const existingUser = await getUser(openid);
      if (!existingUser) {
        throw new Error("请先完成登录");
      }

      // 生成唯一邀请码
      let inviteCode = randInviteCode(6);
      for (let i = 0; i < 5; i++) {
        const hit = await db.collection("families").where({ inviteCode }).get();
        if (!hit || !hit.data || hit.data.length === 0) break;
        inviteCode = randInviteCode(6);
      }

      const addRes = await db.collection("families").add({
        data: {
          familyName,
          inviteCode,
          adminId: openid,
          memberIds: [openid],
          createTime: now(),
        },
      });

      const familyId = addRes && addRes._id ? addRes._id : null;
      if (!familyId) throw new Error("创建家庭失败");

      // 更新 users：加入家庭并设置为当前家庭
      await db.collection("users").doc(openid).update({
        data: {
          familyIds: db.command.addToSet(familyId),
          currentFamilyId: familyId,
          [`familyRoles.${familyId}`]: "admin",
        },
      });

      return {
        success: true,
        familyId,
        inviteCode,
      };
    }

    case "previewFamilyInvite": {
      const { inviteCode } = event;
      if (!inviteCode) throw new Error("缺少 inviteCode");

      const famRes = await db.collection("families").where({ inviteCode }).get();
      const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
      if (!fam) throw new Error("邀请链接无效");

      return {
        success: true,
        familyName: fam.familyName || "家庭",
        inviteCode: fam.inviteCode,
      };
    }

    case "joinFamily": {
      const { inviteCode } = event;
      if (!inviteCode) throw new Error("缺少 inviteCode");

      const famRes = await db.collection("families").where({ inviteCode }).get();
      const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
      if (!fam) throw new Error("邀请码无效");

      const familyId = fam._id;

      const existingUser = await getUser(openid);
      if (!existingUser) throw new Error("请先完成登录");

      try {
        await assertFamilyMember({ openid, familyId });
        await db.collection("users").doc(openid).update({
          data: { currentFamilyId: familyId },
        });
      } catch (e) {
        if (!isNotMemberError(e)) throw e;
        await db.collection("families").where({ _id: familyId }).update({
          data: {
            memberIds: db.command.addToSet(openid),
          },
        });
        await db.collection("users").doc(openid).update({
          data: {
            familyIds: db.command.addToSet(familyId),
            currentFamilyId: familyId,
            [`familyRoles.${familyId}`]: "member",
          },
        });
      }

      return {
        success: true,
        familyId,
        inviteCode,
      };
    }

    case "switchFamily": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");

      await assertFamilyMember({ openid, familyId });
      await db.collection("users").doc(openid).update({
        data: { currentFamilyId: familyId },
      });

      return { success: true, familyId };
    }

    case "getMyFamilies": {
      // 查询：memberIds 数组包含 openid 的家庭
      const famRes = await db
        .collection("families")
        .where({
        memberIds: db.command.elemMatch(db.command.eq(openid)),
        })
        .orderBy("createTime", "desc")
        .get()
        .catch(async () => {
        // 兜底：部分版本 elemMatch 不生效时，退而求其次拉取再过滤
        const all = await db.collection("families").get();
        const list = (all && all.data ? all.data : [])
          .filter((f) => (Array.isArray(f.memberIds) ? f.memberIds.includes(openid) : false))
          .sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
        return { data: list };
      });

      return {
        success: true,
        families: (famRes && famRes.data) || [],
      };
    }

    case "getFamilyMembers": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      const fam = await db.collection("families").where({ _id: familyId }).get();
      const family = fam.data && fam.data[0] ? fam.data[0] : null;
      const memberIds = family && family.memberIds ? family.memberIds : [];
      if (memberIds.length === 0) {
        return { success: true, members: [] };
      }

      const membersRes = await db
        .collection("users")
        .where({ _id: db.command.in(memberIds) })
        .get();

      return {
        success: true,
        members: (membersRes.data || []).map((m) => {
          // 兼容旧数据结构：之前可能把字段写在 m.data.xxx 下
          const nested = m && m.data ? m.data : null;
          return {
            ...m,
            nickName: m.nickName || (nested ? nested.nickName : ""),
            avatarUrl: m.avatarUrl || (nested ? nested.avatarUrl : ""),
          };
        }),
      };
    }

    case "kickMember": {
      const { familyId, memberId } = event;
      if (!familyId || !memberId) throw new Error("缺少 familyId/memberId");
      const fam = await assertFamilyAdmin({ openid, familyId });

      if (memberId === openid) throw new Error("管理员不能移除自己");
      if (fam.adminId === memberId) throw new Error("不能移除管理员");

      const memberIds = Array.isArray(fam.memberIds) ? fam.memberIds : [];
      if (!memberIds.includes(memberId)) throw new Error("该成员不在当前家庭");

      await db.collection("families").where({ _id: familyId }).update({
        data: {
          memberIds: db.command.pull(memberId),
        },
      });

      let kickedUser = null;
      try {
        const userRes = await db.collection("users").doc(memberId).get();
        kickedUser = userRes && userRes.data ? userRes.data : null;
      } catch (e) {
        // 用户文档可能已不存在，仍继续从家庭中移除
      }

      const updateData = {
        familyIds: db.command.pull(familyId),
        [`familyRoles.${familyId}`]: db.command.remove(),
      };
      if (kickedUser && kickedUser.currentFamilyId === familyId) {
        const remaining = (Array.isArray(kickedUser.familyIds) ? kickedUser.familyIds : []).filter(
          (id) => id !== familyId
        );
        updateData.currentFamilyId = remaining[0] || null;
      }

      try {
        await db.collection("users").doc(memberId).update({ data: updateData });
      } catch (e) {
        console.warn("[familyFunctions] kickMember update user:", (e && e.message) || e);
      }

      return { success: true };
    }

    case "exitFamily": {
      const { familyId } = event;
      if (!familyId) throw new Error("缺少 familyId");
      await assertFamilyMember({ openid, familyId });

      await db.collection("families").where({ _id: familyId }).update({
        data: {
          memberIds: db.command.pull(openid),
        },
      });

      await db.collection("users").doc(openid).update({
        data: {
          familyIds: db.command.pull(familyId),
          [`familyRoles.${familyId}`]: undefined,
          currentFamilyId: null,
        },
      });

      return { success: true };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
}

exports.main = async (event) => {
  try {
    return await handleFamilyEvent(event);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error("[familyFunctions]", event && event.type, msg);
    return { success: false, errMsg: msg };
  }
};

