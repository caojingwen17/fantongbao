/**
 * 统一 loading：优先使用页面内挂载的 <ft-loading id="ft-loading" /> 品牌弹层，
 * 页面未挂载组件时回退原生 wx.showLoading，保证任何页面调用都不报错。
 */

function getPageLoading() {
  try {
    const pages = getCurrentPages();
    const page = pages && pages.length ? pages[pages.length - 1] : null;
    if (!page || typeof page.selectComponent !== "function") return null;
    return page.selectComponent("#ft-loading");
  } catch (e) {
    return null;
  }
}

function showLoading(title = "加载中…", mask = true) {
  const comp = getPageLoading();
  if (comp && typeof comp.show === "function") {
    comp.show({ title, mask });
    return;
  }
  wx.showLoading({ title, mask });
}

function hideLoading() {
  const comp = getPageLoading();
  if (comp && typeof comp.hide === "function") {
    comp.hide();
    return;
  }
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
