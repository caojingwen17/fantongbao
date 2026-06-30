/**
 * 统一封装 wx.cloud.callFunction，减少各页面重复代码。
 */

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

function callFunction(name, data = {}) {
  if (!wx.cloud) {
    return Promise.reject(new Error("wx.cloud 未初始化"));
  }
  return wx.cloud
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
    })
    .catch((e) => Promise.reject(normalizeCloudError(e)));
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
