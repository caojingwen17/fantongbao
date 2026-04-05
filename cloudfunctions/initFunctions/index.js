const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

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
  const collections = [
    "users",
    "families",
    "recipes",
    "orders",
    "order_shopping_items",
    "order_cooking_steps",
    "recipe_share_tokens",
    "feedback",
  ];

  for (const name of collections) {
    await safeCreateCollection(name);
  }

  // 常用查询索引（最佳实践：确保云数据库查询性能）
  await safeCreateIndex("families", { inviteCode: 1 }, { unique: true });
  await safeCreateIndex("families", { adminId: 1 });
  await safeCreateIndex("recipes", { familyId: 1, recipeName: 1 });
  await safeCreateIndex("orders", { familyId: 1, status: 1 });
  await safeCreateIndex("order_shopping_items", { familyId: 1, orderId: 1 });
  await safeCreateIndex("order_cooking_steps", { familyId: 1, orderId: 1 });
  await safeCreateIndex("recipe_share_tokens", { token: 1 }, { unique: true });
  await safeCreateIndex("recipe_share_tokens", { recipeId: 1 }, { unique: true });
  await safeCreateIndex("feedback", { createTime: -1 });

  return {
    success: true,
    created: collections,
  };
};

