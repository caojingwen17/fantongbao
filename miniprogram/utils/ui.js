/**
 * 统一 loading，避免各页重复写 wx.showLoading / hideLoading 与异常分支遗漏。
 */

function showLoading(title = "加载中…", mask = true) {
  wx.showLoading({ title, mask });
}

function hideLoading() {
  if (typeof wx.hideLoading !== "function") return;
  try {
    wx.hideLoading({ noConflict: true });
  } catch (e) {
    wx.hideLoading();
  }
}

/**
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withLoading(fn, title = "加载中…", mask = true) {
  showLoading(title, mask);
  try {
    return await fn();
  } finally {
    hideLoading();
  }
}

module.exports = {
  showLoading,
  hideLoading,
  withLoading,
};
