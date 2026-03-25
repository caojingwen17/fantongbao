/**
 * 云存储 fileID（cloud://）在部分真机（尤其 iOS）上 image 组件可能不稳定，
 * 转为临时 HTTPS 后再展示更可靠。临时链接约 2 小时有效，列表页在 onShow 会重新拉取。
 *
 * 若控制台云存储为「仅创建者可读」，客户端 wx.cloud.getTempFileURL 无法解析他人上传的文件，
 * 需传入 familyId，由云函数 recipeFunctions.getTempFileURLs 换链（家庭成员均可访问）。
 */

const cloud = require("./cloud");

function clientResolveBatch(ids) {
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: ids,
      success: (res) => {
        const map = {};
        (res.fileList || []).forEach((item) => {
          if (item && item.fileID) {
            map[item.fileID] = item.tempFileURL || item.fileID;
          }
        });
        resolve(map);
      },
      fail: () => resolve({}),
    });
  });
}

/**
 * @param {string[]} fileIds
 * @param {{ familyId?: string }} [options] 有 familyId 时优先走云函数换链
 * @returns {Promise<Record<string, string>>} fileID -> tempFileURL
 */
async function resolveBatch(fileIds, options) {
  const familyId = options && options.familyId;
  const ids = [...new Set((fileIds || []).filter((x) => x && String(x).indexOf("cloud://") === 0))];
  if (!ids.length) return {};

  if (familyId) {
    try {
      const res = await cloud.callFunction("recipeFunctions", {
        type: "getTempFileURLs",
        familyId,
        fileIds: ids,
      });
      if (res && res.map && typeof res.map === "object") return res.map;
    } catch (e) {
      // 回退客户端
    }
  }

  return clientResolveBatch(ids);
}

/**
 * @param {string} src
 * @param {{ familyId?: string }} [options]
 */
async function resolveForImage(src, options) {
  if (!src || typeof src !== "string") return "";
  if (src.indexOf("cloud://") !== 0) return src;
  const familyId = options && options.familyId;
  if (familyId) {
    try {
      const res = await cloud.callFunction("recipeFunctions", {
        type: "getTempFileURLs",
        familyId,
        fileIds: [src],
      });
      if (res && res.map && res.map[src]) return res.map[src];
    } catch (e) {
      // 回退客户端
    }
  }
  return new Promise((resolve) => {
    wx.cloud.getTempFileURL({
      fileList: [src],
      success: (res) => {
        const item = res.fileList && res.fileList[0];
        resolve((item && item.tempFileURL) || src);
      },
      fail: () => resolve(src),
    });
  });
}

/**
 * 菜谱列表项增加 recipeImgDisplay（供 image src 使用）
 */
async function attachRecipeImgDisplay(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  const withFam = list.find((r) => r && r.familyId);
  const familyId = withFam ? withFam.familyId : "";
  const map = await resolveBatch(
    list.map((r) => r && r.recipeImg).filter(Boolean),
    familyId ? { familyId } : {}
  );
  return list.map((r) => {
    const id = r && r.recipeImg;
    const display = id && map[id] ? map[id] : id;
    return { ...r, recipeImgDisplay: display || id || "" };
  });
}

module.exports = {
  resolveForImage,
  resolveBatch,
  attachRecipeImgDisplay,
};
