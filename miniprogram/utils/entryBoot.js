const auth = require("./auth");

/**
 * 主入口启动判定：新用户 guest / 已登录无家庭 needFamily / 已登录有家庭 ok
 * @returns {"guest"|"needFamily"|"ok"}
 */
async function resolveMainEntryStatus() {
  const app = getApp();

  if (app.globalData.userInfo) {
    if (!app.globalData.currentFamilyId) return "needFamily";
    return "ok";
  }

  const r = await auth.trySilentLogin();
  if (!r.ok || !app.globalData.userInfo) return "guest";
  if (!app.globalData.currentFamilyId) return "needFamily";
  return "ok";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  resolveMainEntryStatus,
  delay,
};
