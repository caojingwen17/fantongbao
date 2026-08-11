const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const INIT_ADMIN_SECRET = process.env.INIT_ADMIN_SECRET || "";

async function safeCreateCollection(collectionName) {
  try {
    await db.createCollection(collectionName);
  } catch (e) {
    // 集合已存在，忽略
  }
}

async function safeCreateIndex(collectionName, keys, options) {
  try {
    await db.collection(collectionName).createIndex(keys, options || {});
  } catch (e) {
    // 索引已存在或创建失败，忽略，避免影响业务
  }
}

exports.main = async (event) => {
  const secret = event && event.adminSecret ? String(event.adminSecret) : "";
  if (!INIT_ADMIN_SECRET || secret !== INIT_ADMIN_SECRET) {
    throw new Error("无权执行初始化，请在云函数环境变量配置 INIT_ADMIN_SECRET 后由管理员调用");
  }

  const collections = [
    "users",
    "families",
    "recipes",
    "orders",
    "order_shopping_items",
    "order_cooking_steps",
    "recipe_share_tokens",
    "feedback",
    "ai_usage_logs",
  ];

  // 各集合创建互不依赖，并行执行
  await Promise.all(collections.map((name) => safeCreateCollection(name)));

  // 各索引创建互不依赖，并行执行
  await Promise.all([
    safeCreateIndex("families", { inviteCode: 1 }, { unique: true }),
    safeCreateIndex("families", { adminId: 1 }),
    safeCreateIndex("recipes", { familyId: 1, recipeName: 1 }),
    safeCreateIndex("orders", { familyId: 1, status: 1 }),
    safeCreateIndex("order_shopping_items", { familyId: 1, orderId: 1 }),
    safeCreateIndex("order_cooking_steps", { familyId: 1, orderId: 1 }),
    safeCreateIndex("recipe_share_tokens", { token: 1 }, { unique: true }),
    safeCreateIndex("recipe_share_tokens", { recipeId: 1 }, { unique: true }),
    safeCreateIndex("feedback", { createTime: -1 }),
    safeCreateIndex("ai_usage_logs", { openid: 1, createTime: -1 }),
  ]);

  return {
    success: true,
    created: collections,
  };
};
