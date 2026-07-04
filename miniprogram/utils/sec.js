/**
 * 内容安全：展示图上传后即时检测（云端 imgSecCheck）
 */
const cloud = require("./cloud");
const ui = require("./ui");

const PUBLISH_VIOLATION_MSG = "所发布内容含违规信息";

function isSecViolationMessage(msg) {
  const s = String(msg || "");
  return (
    s.includes(PUBLISH_VIOLATION_MSG) ||
    s.includes("违规") ||
    s.includes("内容安全") ||
    s.includes("87014") ||
    s.includes("risky")
  );
}

function formatSecError(err) {
  if (!err) return "操作失败，请稍后重试";
  const raw = err.message || err.errMsg || String(err);
  const m = raw.match(/Error:\s*(.+)$/);
  const core = (m && m[1] ? m[1].trim() : raw).trim();
  if (isSecViolationMessage(core)) return PUBLISH_VIOLATION_MSG;
  return core.slice(0, 36) || "操作失败，请稍后重试";
}

/** 先关 loading 再提示，避免 hideLoading 吞掉 toast */
function notifyPublishSecError(err) {
  const msg = formatSecError(err);
  ui.hideLoading();
  if (msg === PUBLISH_VIOLATION_MSG) {
    wx.showModal({
      title: "无法上传",
      content: msg,
      showCancel: false,
      confirmText: "知道了",
    });
    return;
  }
  wx.showToast({ title: msg, icon: "none", duration: 3500 });
}

async function checkRecipeDisplayImage(fileID, familyId) {
  if (!fileID || !familyId) throw new Error("缺少图片或家庭信息");
  const res = await cloud.callFunction("recipeFunctions", {
    type: "checkRecipeImage",
    fileID,
    familyId,
  });
  if (res && res.success === false) {
    throw new Error(res.errMsg || res.message || PUBLISH_VIOLATION_MSG);
  }
}

/**
 * 上传菜谱展示图并做内容安全检测
 * @returns {Promise<string>} fileID
 */
async function uploadRecipeDisplayImage(filePath, familyId) {
  if (!filePath) throw new Error("未选择图片");
  if (!familyId) throw new Error("请先选择家庭");

  const cloudPath = `recipes/${familyId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
  const fileID = (uploadRes && uploadRes.fileID) || "";
  if (!fileID) throw new Error("上传失败");

  try {
    await checkRecipeDisplayImage(fileID, familyId);
  } catch (e) {
    wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
    throw e;
  }
  return fileID;
}

module.exports = {
  PUBLISH_VIOLATION_MSG,
  formatSecError,
  notifyPublishSecError,
  checkRecipeDisplayImage,
  uploadRecipeDisplayImage,
};
