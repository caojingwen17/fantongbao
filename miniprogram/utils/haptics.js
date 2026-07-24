/**
 * 触觉反馈：关键时刻的轻震动，失败静默降级（部分机型/场景不支持）。
 */

function vibrateShort(type) {
  try {
    if (typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type, fail: () => {} });
    }
  } catch (e) {
    /* ignore */
  }
}

/** 轻触：勾选、加菜、切换 */
function light() {
  vibrateShort("light");
}

/** 中触：删除、提交 */
function medium() {
  vibrateShort("medium");
}

/** 重触：关键状态完成前慎用 */
function heavy() {
  vibrateShort("heavy");
}

/** 成功反馈：完成买菜/做菜、保存成功（中+轻两段） */
function success() {
  vibrateShort("medium");
  setTimeout(() => vibrateShort("light"), 120);
}

module.exports = {
  light,
  medium,
  heavy,
  success,
};
