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
 * @param {string} [title]
 * @param {boolean|object} [maskOrOptions] 传 false 或 { mask: false } 时不锁全屏，点击响应更快
 * @returns {Promise<T>}
 */
async function withLoading(fn, title = "加载中…", maskOrOptions = true) {
  let mask = true;
  if (maskOrOptions === false) mask = false;
  else if (maskOrOptions && typeof maskOrOptions === "object" && maskOrOptions.mask === false) {
    mask = false;
  }
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
