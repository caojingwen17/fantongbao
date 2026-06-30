function getOpenidOrThrow(ctx) {
  const openid = ctx && ctx.OPENID;
  if (!openid) throw new Error("未登录或无法识别用户");
  return openid;
}

module.exports = {
  getOpenidOrThrow,
};
