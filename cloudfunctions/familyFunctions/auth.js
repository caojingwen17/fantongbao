function getOpenidOrThrow(ctx) {
  const openid = ctx && ctx.OPENID;
  if (!openid) throw new Error("未登录或无法识别用户");
  return openid;
}

function isNotMemberError(e) {
  const msg = String((e && e.message) || "");
  return msg === "没有家庭访问权限";
}

module.exports = {
  getOpenidOrThrow,
  isNotMemberError,
};
