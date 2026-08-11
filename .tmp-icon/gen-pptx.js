/* 生成「饭桶宝」宣传 PPT（16:9，截图位留空占位） */
const pptxgen = require("pptxgenjs");
const path = require("path");

const ROOT = "D:/code/fantongbao";
const OUT = path.join(ROOT, "宣传物料", "饭桶宝-宣传.pptx");
const LOGO = path.join(ROOT, "miniprogram/images/icons/launch-logo.png");
const SHARE_DIR = path.join(ROOT, "miniprogram/images/share");
const QR_CODE = path.join(ROOT, "宣传物料/小程序码.jpg");

const BROWN = "874E00";
const DARK = "432900";
const ORANGE = "FF9800";
const CREAM = "FFF5EC";
const CREAM2 = "FFE3C2";
const TEXT_SUB = "765524";
const PLACEHOLDER_BG = "F4EADB";
const FONT = "Microsoft YaHei";

const pptx = new pptxgen();
pptx.defineLayout({ name: "W16x9", width: 13.33, height: 7.5 });
pptx.layout = "W16x9";

/* ---------- helpers ---------- */
function bg(slide, color = CREAM) {
  slide.background = { color };
}
function blob(slide, x, y, w, color, transparency = 60) {
  slide.addShape(pptx.shapes.OVAL, { x, y, w, h: w, fill: { color, transparency }, line: { type: "none" } });
}
function title(slide, text, opts = {}) {
  slide.addText(text, {
    x: opts.x ?? 0.7, y: opts.y ?? 0.45, w: opts.w ?? 11.9, h: 0.9,
    fontFace: FONT, fontSize: opts.size ?? 32, bold: true, color: opts.color ?? BROWN,
    align: opts.align ?? "left",
  });
}
function kicker(slide, text, x = 0.72, y = 0.38) {
  slide.addText(text, { x, y, w: 6, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: ORANGE, charSpacing: 4 });
}
/** 截图占位框 */
function shotPlaceholder(slide, x, y, w, h, label) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.12,
    fill: { color: PLACEHOLDER_BG },
    line: { color: "D8C3A5", width: 1.5, dashType: "dash" },
  });
  slide.addText(label, {
    x, y: y + h / 2 - 0.3, w, h: 0.6, align: "center",
    fontFace: FONT, fontSize: 13, bold: true, color: "B3803F",
  });
}
function pill(slide, x, y, w, text) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h: 0.42, rectRadius: 0.21, fill: { color: "FFE8D2" }, line: { type: "none" },
  });
  slide.addText(text, { x, y, w, h: 0.42, align: "center", fontFace: FONT, fontSize: 12, bold: true, color: BROWN });
}
function bulletBlock(slide, x, y, w, items, fontSize = 15) {
  const runs = [];
  items.forEach((it) => {
    runs.push({ text: it.t, options: { bold: true, color: DARK, fontSize, breakLine: true } });
    runs.push({ text: it.d, options: { color: TEXT_SUB, fontSize: fontSize - 2.5, breakLine: true, paraSpaceAfter: 14 } });
  });
  slide.addText(runs, { x, y, w, h: 5.5, fontFace: FONT, valign: "top", lineSpacingMultiple: 1.15 });
}

/* ---------- S1 封面 ---------- */
{
  const s = pptx.addSlide();
  bg(s);
  blob(s, -1.6, -1.8, 5.4, CREAM2, 30);
  blob(s, 10.2, 4.6, 5.6, CREAM2, 30);
  blob(s, 11.4, -1.2, 3.2, "FFE9D2", 20);
  s.addImage({ path: LOGO, x: 5.87, y: 1.35, w: 1.6, h: 1.6, rounding: true });
  s.addText("饭桶宝", { x: 0, y: 3.1, w: 13.33, h: 1.2, align: "center", fontFace: FONT, fontSize: 60, bold: true, color: BROWN });
  s.addText("一家人的饭，一起搞定", { x: 0, y: 4.35, w: 13.33, h: 0.6, align: "center", fontFace: FONT, fontSize: 24, bold: true, color: DARK });
  pill(s, 4.92, 5.3, 3.5, "家庭菜谱 · 点菜 · 买菜 · 做菜");
  s.addText("微信小程序 · 正式发布", { x: 0, y: 6.7, w: 13.33, h: 0.4, align: "center", fontFace: FONT, fontSize: 12, color: TEXT_SUB });
}

/* ---------- S2 痛点 ---------- */
{
  const s = pptx.addSlide();
  bg(s, "FFFFFF");
  kicker(s, "PAIN POINTS");
  title(s, "每个做饭的家庭，都遇到过这些瞬间");
  const cards = [
    { e: "🤔", t: "「今天吃什么？」", d: "问一圈，回答永远是「随便」「都行」，没人拿主意。" },
    { e: "📒", t: "菜谱散落各处", d: "拿手菜记在聊天记录、收藏夹和脑子里，想做时永远找不到。" },
    { e: "🛒", t: "买菜一笔糊涂账", d: "漏买错买常发生，好几天的菜混在一起，钱花哪了算不清。" },
  ];
  cards.forEach((c, i) => {
    const x = 0.72 + i * 4.05;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x, y: 1.9, w: 3.75, h: 3.9, rectRadius: 0.15, fill: { color: CREAM }, line: { type: "none" } });
    s.addText(c.e, { x, y: 2.2, w: 3.75, h: 0.9, align: "center", fontSize: 40 });
    s.addText(c.t, { x: x + 0.25, y: 3.25, w: 3.25, h: 0.6, align: "center", fontFace: FONT, fontSize: 20, bold: true, color: DARK });
    s.addText(c.d, { x: x + 0.35, y: 3.95, w: 3.05, h: 1.6, align: "center", fontFace: FONT, fontSize: 13.5, color: TEXT_SUB, lineSpacingMultiple: 1.3 });
  });
  s.addText("饭桶宝，就是为解决这些瞬间而生。", { x: 0, y: 6.35, w: 13.33, h: 0.5, align: "center", fontFace: FONT, fontSize: 16, bold: true, color: ORANGE });
}

/* ---------- S3 解决方案总览 ---------- */
{
  const s = pptx.addSlide();
  bg(s);
  kicker(s, "SOLUTION");
  title(s, "一条龙搞定全家的一日三餐");
  const steps = [
    { t: "菜谱", d: "家庭共享菜谱库\nAI 快速录入" },
    { t: "点菜", d: "邀请家人一起点\n随机一道抽卡" },
    { t: "买菜", d: "清单自动汇总\n多单一起买、金额分摊" },
    { t: "做菜", d: "步骤逐条打卡\n干饭日历复盘" },
  ];
  steps.forEach((st, i) => {
    const x = 0.72 + i * 3.12;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x, y: 1.85, w: 2.75, h: 2.5, rectRadius: 0.15, fill: { color: "FFFFFF" }, line: { color: "F0DFC8", width: 1 } });
    s.addShape(pptx.shapes.OVAL, { x: x + 0.98, y: 1.45, w: 0.8, h: 0.8, fill: { color: ORANGE }, line: { type: "none" } });
    s.addText(String(i + 1), { x: x + 0.98, y: 1.45, w: 0.8, h: 0.8, align: "center", fontFace: FONT, fontSize: 24, bold: true, color: "FFFFFF" });
    s.addText(st.t, { x, y: 2.4, w: 2.75, h: 0.6, align: "center", fontFace: FONT, fontSize: 22, bold: true, color: BROWN });
    s.addText(st.d, { x: x + 0.15, y: 3.05, w: 2.45, h: 1.2, align: "center", fontFace: FONT, fontSize: 12.5, color: TEXT_SUB, lineSpacingMultiple: 1.25 });
    if (i < 3) s.addText("→", { x: x + 2.72, y: 2.7, w: 0.45, h: 0.6, align: "center", fontFace: FONT, fontSize: 22, bold: true, color: ORANGE });
  });
  shotPlaceholder(s, 3.42, 4.75, 6.5, 2.2, "截图占位：S1 首页（点菜单 + 常用菜谱）");
}

/* ---------- 亮点页通用 ---------- */
function featureSlide({ kick, ttl, points, shots }) {
  const s = pptx.addSlide();
  bg(s, "FFFFFF");
  kicker(s, kick);
  title(s, ttl);
  bulletBlock(s, 0.75, 1.75, 5.6, points, 17);
  shots.forEach((sh) => shotPlaceholder(s, sh.x, sh.y, sh.w, sh.h, sh.label));
  return s;
}

/* ---------- S4 亮点1 AI 菜谱导入 ---------- */
featureSlide({
  kick: "HIGHLIGHT 01",
  ttl: "AI 菜谱导入：10 秒入库一道菜",
  points: [
    { t: "📷 拍照识别", d: "刷到菜谱截图、手写菜单，拍一下直接变成结构化菜谱。" },
    { t: "📝 文字 / 链接识别", d: "粘贴一段菜谱文字或小红书链接，AI 自动提取菜名、食材、步骤。" },
    { t: "✨ 报个菜名就生成", d: "只填菜名，自动生成一份家常做法，还能继续手动调整。" },
    { t: "🛡️ 双重安全检测", d: "文本 + 图片内容安全审核，家庭使用更放心。" },
  ],
  shots: [{ x: 6.8, y: 1.7, w: 5.8, h: 5.0, label: "截图占位：S2 新增菜谱页（AI 导入三种方式）" }],
});

/* ---------- S5 亮点2 一起点菜 ---------- */
featureSlide({
  kick: "HIGHLIGHT 02",
  ttl: "点菜，是一件可以一起做的事",
  points: [
    { t: "👨‍👩‍👧 邀请家人一起点", d: "一个分享链接甩进家庭群，全家人远程点菜，众口不再难调。" },
    { t: "🎴 随机一道", d: "选择困难？抽卡式随机抽一道，抽到什么吃什么，愿赌服输。" },
    { t: "📌 点菜备注", d: "少辣、多葱、孩子那份单独做——每道菜都能带备注。" },
  ],
  shots: [
    { x: 6.6, y: 1.7, w: 2.9, h: 5.0, label: "截图占位：S3 点菜页" },
    { x: 9.75, y: 1.7, w: 2.9, h: 5.0, label: "截图占位：S4 随机一道抽卡" },
  ],
});

/* ---------- S6 亮点3 买菜 ---------- */
featureSlide({
  kick: "HIGHLIGHT 03",
  ttl: "买菜清单：自动汇总，一起买更省心",
  points: [
    { t: "🥬 清单自动生成", d: "点好的菜自动汇总成买菜清单，食材、调料分好类，逐条勾选不怕漏。" },
    { t: "🧺 多单「一起买」", d: "多张点菜单合并成一张清单，重复的菜自动标注，一次买齐好几天的菜。" },
    { t: "💰 金额自动分摊", d: "买完登记总金额，自动平摊到每一单、每一天，账目清清楚楚。" },
  ],
  shots: [{ x: 6.8, y: 1.7, w: 5.8, h: 5.0, label: "截图占位：S5 买菜清单页" }],
});

/* ---------- S7 亮点4 做菜 + 日历 ---------- */
featureSlide({
  kick: "HIGHLIGHT 04",
  ttl: "做菜打卡 + 干饭日历",
  points: [
    { t: "✅ 步骤逐条打卡", d: "备菜、做菜步骤逐条勾选，厨房里不用擦着手翻手机。" },
    { t: "📅 干饭日历", d: "哪天吃了啥、伙食费花了多少，月度视图一目了然。" },
    { t: "📊 月度复盘", d: "本月消费统计自动汇总，柴米油盐心里有数。" },
  ],
  shots: [
    { x: 6.6, y: 1.7, w: 2.9, h: 5.0, label: "截图占位：S6 做菜清单页" },
    { x: 9.75, y: 1.7, w: 2.9, h: 5.0, label: "截图占位：S7 家庭详情 · 干饭日历" },
  ],
});

/* ---------- S8 分享传播 ---------- */
{
  const s = pptx.addSlide();
  bg(s);
  kicker(s, "SHARE");
  title(s, "自带传播基因：三种分享卡片");
  const cards = [
    { img: "share-brand.png", d: "品牌转发卡片\n（任意页面右上角转发）" },
    { img: "share-order-invite.png", d: "邀请点菜卡片\n（一起决定今天吃什么）" },
    { img: "share-family-invite.png", d: "邀请加入家庭卡片\n（家人一键入伙）" },
  ];
  cards.forEach((c, i) => {
    const x = 0.72 + i * 4.05;
    s.addImage({ path: path.join(SHARE_DIR, c.img), x, y: 1.8, w: 3.75, h: 3.0 });
    s.addText(c.d, { x, y: 5.0, w: 3.75, h: 0.9, align: "center", fontFace: FONT, fontSize: 12.5, color: TEXT_SUB, lineSpacingMultiple: 1.25 });
  });
  s.addText("另有 Canvas 绘制的菜谱分享海报：封面图 + 步骤 + 小程序码，一键保存转发。", { x: 0, y: 6.3, w: 13.33, h: 0.5, align: "center", fontFace: FONT, fontSize: 14, bold: true, color: BROWN });
}

/* ---------- S9 品牌视觉 ---------- */
{
  const s = pptx.addSlide();
  bg(s, "FFFFFF");
  kicker(s, "DESIGN");
  title(s, "有温度的品牌视觉");
  s.addImage({ path: LOGO, x: 0.9, y: 1.9, w: 2.2, h: 2.2, rounding: true });
  s.addText([
    { text: "暖杏色系", options: { bold: true, color: DARK, fontSize: 17, breakLine: true } },
    { text: "像刚出锅的饭一样暖", options: { color: TEXT_SUB, fontSize: 13, breakLine: true, paraSpaceAfter: 12 } },
    { text: "iOS 级交互细节", options: { bold: true, color: DARK, fontSize: 17, breakLine: true } },
    { text: "骨架屏静默加载、弹性动效、触控反馈", options: { color: TEXT_SUB, fontSize: 13, breakLine: true, paraSpaceAfter: 12 } },
    { text: "统一的空状态与占位设计", options: { bold: true, color: DARK, fontSize: 17, breakLine: true } },
    { text: "没有图片也有好看的交代", options: { color: TEXT_SUB, fontSize: 13 } },
  ], { x: 3.6, y: 1.9, w: 5.2, h: 4.5, fontFace: FONT, valign: "top" });
  const swatches = [
    { c: "874E00", n: "深棕 · 主色" },
    { c: "FF9800", n: "暖橙 · 点缀" },
    { c: "FFF5EC", n: "浅杏 · 底色" },
    { c: "432900", n: "墨色 · 正文" },
  ];
  swatches.forEach((sw, i) => {
    const x = 9.2 + (i % 2) * 1.85;
    const y = 2.0 + Math.floor(i / 2) * 1.75;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x, y, w: 1.6, h: 1.05, rectRadius: 0.1, fill: { color: sw.c }, line: { color: "E8D8C2", width: 1 } });
    s.addText(sw.n, { x, y: y + 1.1, w: 1.6, h: 0.5, align: "center", fontFace: FONT, fontSize: 11, bold: true, color: DARK });
  });
}

/* ---------- S10 结尾 ---------- */
{
  const s = pptx.addSlide();
  bg(s);
  blob(s, -1.6, 4.2, 5.2, CREAM2, 30);
  blob(s, 10.6, -1.8, 5.2, CREAM2, 30);
  s.addImage({ path: LOGO, x: 5.99, y: 0.9, w: 1.35, h: 1.35, rounding: true });
  s.addText("今天也要好好吃饭", { x: 0, y: 2.4, w: 13.33, h: 1.0, align: "center", fontFace: FONT, fontSize: 44, bold: true, color: BROWN });
  s.addText("微信搜索「饭桶宝」，一家人的饭，一起搞定", { x: 0, y: 3.55, w: 13.33, h: 0.5, align: "center", fontFace: FONT, fontSize: 17, color: DARK });
  s.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 5.42, y: 4.35, w: 2.5, h: 2.5, rectRadius: 0.15, fill: { color: "FFFFFF" }, line: { color: "F0DFC8", width: 1 } });
  s.addImage({ path: QR_CODE, x: 5.62, y: 4.55, w: 2.1, h: 2.1 });
}

pptx.writeFile({ fileName: OUT }).then(() => console.log("pptx done:", OUT));
