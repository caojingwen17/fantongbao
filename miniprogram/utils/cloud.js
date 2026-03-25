/**
 * 统一封装 wx.cloud.callFunction，减少各页面重复代码。
 */

function callFunction(name, data = {}) {
  if (!wx.cloud) {
    return Promise.reject(new Error("wx.cloud 未初始化"));
  }
  return wx.cloud
    .callFunction({
      name,
      data,
    })
    .then((resp) => resp && resp.result);
}

function callFunctionWithErrorToast(name, data = {}) {
  return callFunction(name, data).catch((e) => {
    // 兜底提示：云端报错或网络错误
    wx.showToast({
      title: e && e.errMsg ? e.errMsg : "请求失败",
      icon: "none",
    });
    throw e;
  });
}

module.exports = {
  callFunction,
  callFunctionWithErrorToast,
};

