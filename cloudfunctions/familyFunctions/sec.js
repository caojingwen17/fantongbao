/**
 * 微信内容安全：文本 msgSecCheck、图片 imgSecCheck
 * @see https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/sec-check/security.msgSecCheck.html
 */

function safeStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

const VIOLATION_MSG = "内容包含违规信息，请修改后重试";
const IMAGE_VIOLATION_MSG = "图片包含违规信息，请更换后重试";
const SEC_FAIL_MSG = "内容安全检测失败，请稍后重试";

function isRiskySuggest(suggest) {
  return suggest === "risky" || suggest === "review";
}

function isViolationError(e) {
  const msg = safeStr((e && e.errMsg) || (e && e.message) || e);
  return msg.includes("87014") || msg.includes("risky") || msg.includes("违规");
}

async function msgSecCheckChunk(cloud, { openid, content, scene }) {
  const res = await cloud.openapi.security.msgSecCheck({
    openid,
    scene,
    version: 2,
    content,
  });
  const suggest = res && res.result && res.result.suggest;
  if (isRiskySuggest(suggest)) {
    throw new Error(VIOLATION_MSG);
  }
}

async function assertTextsSafe(cloud, { openid, texts, scene = 3 }) {
  const parts = (texts || []).map((t) => safeStr(t).trim()).filter(Boolean);
  if (!parts.length) return;

  const content = parts.join("\n");
  const CHUNK = 2500;
  try {
    for (let i = 0; i < content.length; i += CHUNK) {
      await msgSecCheckChunk(cloud, {
        openid,
        scene,
        content: content.slice(i, i + CHUNK),
      });
    }
  } catch (e) {
    if (e.message === VIOLATION_MSG) throw e;
    if (isViolationError(e)) throw new Error(VIOLATION_MSG);
    console.warn("[sec] msgSecCheck:", safeStr(e.errMsg || e.message));
    throw new Error(SEC_FAIL_MSG);
  }
}

async function assertImageBufferSafe(cloud, buffer) {
  if (!buffer || !buffer.length) return;
  try {
    await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: "image/png",
        value: buffer,
      },
    });
  } catch (e) {
    if (isViolationError(e)) throw new Error(IMAGE_VIOLATION_MSG);
    console.warn("[sec] imgSecCheck:", safeStr(e.errMsg || e.message));
    throw new Error(SEC_FAIL_MSG);
  }
}

async function assertCloudImageSafe(cloud, fileID) {
  const id = safeStr(fileID).trim();
  if (!id || id.indexOf("cloud://") !== 0) return;
  const dl = await cloud.downloadFile({ fileID: id });
  const buf = dl && dl.fileContent;
  if (!buf) throw new Error("图片下载失败");
  await assertImageBufferSafe(cloud, buf);
}

module.exports = {
  assertTextsSafe,
  assertImageBufferSafe,
  assertCloudImageSafe,
  VIOLATION_MSG,
  IMAGE_VIOLATION_MSG,
};
