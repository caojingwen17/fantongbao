/**
 * 统一封装 wx.cloud.callFunction，减少各页面重复代码。
 */

/** 云调用超时：防止挂起的请求把页面刷新去重锁永久卡死（会话内图片/数据再也不更新） */
const DEFAULT_TIMEOUT_MS = 12000;

function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("网络超时，请检查网络后重试")), ms)
    ),
  ]);
}

function normalizeCloudError(err) {
  if (!err) return new Error("请求失败");
  if (err instanceof Error && err.message && !err.errMsg) return err;

  const raw = String((err && (err.errMsg || err.message)) || err);
  const patterns = [
    /cloud\.callFunction:fail(?:\s+\w+)?:?\s*(?:Error:\s*)?(.+?)(?:\s+at\s|$)/i,
    /Error:\s*(.+)$/,
    /FUNCTION_NOT_FOUND|FunctionName parameter could not be found/i,
  ];

  if (/FUNCTION_NOT_FOUND|FunctionName parameter could not be found/i.test(raw)) {
    return new Error("云函数未部署，请在开发者工具中上传对应云函数");
  }

  for (let i = 0; i < 2; i++) {
    const m = raw.match(patterns[i]);
    if (m && m[1]) return new Error(m[1].trim());
  }

  return new Error(raw);
}

function callFunction(name, data = {}, options = {}) {
  if (!wx.cloud) {
    return Promise.reject(new Error("wx.cloud 未初始化"));
  }
  const timeoutMs = typeof options.timeout === "number" ? options.timeout : DEFAULT_TIMEOUT_MS;
  return withTimeout(
    wx.cloud
      .callFunction({
        name,
        data,
      })
      .then((resp) => {
        const result = resp && resp.result;
        if (result && result.success === false) {
          throw new Error(result.errMsg || result.message || "云端处理失败");
        }
        return result;
      }),
    timeoutMs
  ).catch((e) => Promise.reject(normalizeCloudError(e)));
}

function callFunctionWithErrorToast(name, data = {}) {
  return callFunction(name, data).catch((e) => {
    const title = (e && e.message) || "请求失败";
    wx.showToast({
      title: title.length > 40 ? title.slice(0, 40) : title,
      icon: "none",
      duration: 3500,
    });
    throw e;
  });
}

module.exports = {
  callFunction,
  callFunctionWithErrorToast,
  normalizeCloudError,
};
