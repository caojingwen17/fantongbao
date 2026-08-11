const cloud = require("wx-server-sdk");
const { getOpenidOrThrow } = require("./auth");
const { assertTextsSafe } = require("./sec");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function now() {
  return new Date();
}

// 同一云函数实例只兜底创建一次，避免每次 submitFeedback 都白跑一次 createCollection 往返
const ensuredCollections = {};

async function ensureCollection(name) {
  if (ensuredCollections[name]) return;
  ensuredCollections[name] = true;
  try {
    await db.createCollection(name);
  } catch (e) {
    /* 已存在等 */
  }
}

exports.main = async (event) => {
  if (!event || !event.type) throw new Error("缺少 type");

  const ctx = cloud.getWXContext();
  const openid = getOpenidOrThrow(ctx);

  switch (event.type) {
    case "submitFeedback": {
      const { category, content, familyId } = event;
      const cat = String(category || "").trim();
      if (cat !== "rant" && cat !== "suggestion") {
        throw new Error("请选择吐槽或建议");
      }
      const text = String(content || "").trim();
      if (!text.length) throw new Error("请填写内容");
      if (text.length > 2000) throw new Error("内容不超过 2000 字");

      await assertTextsSafe(cloud, { openid, texts: [text], scene: 3 });

      await ensureCollection("feedback");
      await db.collection("feedback").add({
        data: {
          openid,
          category: cat,
          content: text,
          familyId: familyId ? String(familyId).trim() : "",
          createTime: now(),
        },
      });
      return { success: true };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};
