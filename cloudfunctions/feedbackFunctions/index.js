const cloud = require("wx-server-sdk");
const { getOpenidOrThrow } = require("./auth");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

function now() {
  return new Date();
}

async function ensureCollection(name) {
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
