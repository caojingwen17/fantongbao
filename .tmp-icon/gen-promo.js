/* 生成三种风格宣传图 1080x1080（截图位/小程序码留空占位） */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUT = "D:/code/fantongbao/宣传物料/宣传图";
const FONT = "PingFang SC, Microsoft YaHei, sans-serif";
const QR_DATA = "data:image/jpeg;base64," + fs.readFileSync("D:/code/fantongbao/宣传物料/小程序码.jpg").toString("base64");
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 通用小组件 ---------- */
const pot = (x, y, s = 1) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <path d="M-22 -52 q-10 -18 0 -34 q10 -16 0 -32" stroke="#874e00" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.5"/>
    <path d="M22 -52 q-10 -18 0 -34 q10 -16 0 -32" stroke="#874e00" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.72"/>
    <rect x="-74" y="-30" width="148" height="22" rx="11" fill="#874e00"/>
    <path d="M-66 -8 h132 v34 a44 44 0 0 1 -44 44 h-44 a44 44 0 0 1 -44 -44 z" fill="#ff9800"/>
    <ellipse cx="-30" cy="26" rx="14" ry="9" fill="#ffb54d" opacity="0.75"/>
  </g>`;

const sparkle = (x, y, s = 1, c = "#ffb85c") =>
  `<path transform="translate(${x},${y}) scale(${s})" d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4 Z" fill="${c}"/>`;

/** 截图占位（虚线手机框） */
const phoneHolder = (x, y, w, h, label, stroke = "#d8c3a5", textC = "#b3803f") => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36" fill="none" stroke="${stroke}" stroke-width="4" stroke-dasharray="16 12"/>
  <text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="700" fill="${textC}">${label}</text>`;

/** 小程序码（白底圆角托 + 真码）；深色底场景传 dark=true 用白描边 */
const qrHolder = (x, y, size, _s, _t, dark = false) => `
  <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="20" fill="#ffffff" stroke="${dark ? "#8a6a3f" : "#f0dfc8"}" stroke-width="3"/>
  <image href="${QR_DATA}" x="${x + 12}" y="${y + 12}" width="${size - 24}" height="${size - 24}"/>`;

/* ================================================================
 * 风格 A「家的温度」：暖杏渐变 + 白卡 + 锅插画
 * ================================================================ */
const styleA = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bgA" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7ee"/><stop offset="1" stop-color="#ffe0ba"/>
    </linearGradient>
    <filter id="softA" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="1080" height="1080" fill="url(#bgA)"/>
  <circle cx="120" cy="120" r="210" fill="#ffd9ad" opacity="0.5"/>
  <circle cx="990" cy="960" r="260" fill="#ffcf9a" opacity="0.45"/>
  ${sparkle(180, 300, 1.4)}${sparkle(920, 210, 1.1)}${sparkle(840, 470, 0.9)}
  <circle cx="940" cy="330" r="8" fill="#ffca8a"/><circle cx="150" cy="480" r="6" fill="#ffca8a"/>

  <!-- 标题区 -->
  ${pot(540, 190, 1.0)}
  <text x="540" y="330" text-anchor="middle" font-family="${FONT}" font-size="96" font-weight="700" fill="#874e00">饭桶宝</text>
  <text x="540" y="400" text-anchor="middle" font-family="${FONT}" font-size="42" font-weight="700" fill="#432900">一家人的饭，一起搞定</text>

  <!-- 中部：左截图占位，右卖点 -->
  ${phoneHolder(90, 470, 400, 420, "截图占位：S1 首页")}
  <g font-family="${FONT}">
    ${[0, 1, 2, 3]
      .map(
        (i) => `
      <rect x="540" y="${478 + i * 124}" width="450" height="100" rx="26" fill="#ffffff" filter="url(#softAShadow)"/>
      <rect x="540" y="${478 + i * 124}" width="450" height="100" rx="26" fill="#ffffff"/>
      <circle cx="592" cy="${528 + i * 124}" r="26" fill="rgba(255,152,0,0.16)"/>
      <text x="592" y="${539 + i * 124}" text-anchor="middle" font-size="28" fill="#874e00">${["🍳", "🎯", "🛒", "📅"][i]}</text>
      <text x="636" y="${520 + i * 124}" font-size="30" font-weight="700" fill="#432900">${["家庭共享菜谱库", "一起点菜 · 随机一道", "买菜清单 · 一起买", "做菜打卡 · 干饭日历"][i]}</text>
      <text x="636" y="${556 + i * 124}" font-size="22" fill="#765524">${["AI 拍照/文字/链接快速录入", "不知道吃啥，抽卡决定", "多单合并，金额自动分摊", "每天吃了啥花了啥一目了然"][i]}</text>`
      )
      .join("")}
  </g>

  <!-- 底部：二维码占位 + 引导 -->
  ${qrHolder(90, 920, 130)}
  <text x="250" y="985" font-family="${FONT}" font-size="30" font-weight="700" fill="#874e00">微信搜索「饭桶宝」</text>
  <text x="250" y="1026" font-family="${FONT}" font-size="24" fill="#765524">菜谱 · 点菜 · 买菜 · 做菜，一条龙</text>
  <text x="990" y="1010" text-anchor="end" font-family="${FONT}" font-size="22" fill="#b3803f">今天也要好好吃饭</text>
</svg>`;

/* ================================================================
 * 风格 B「高级深棕」：深色底 + 大字排版
 * ================================================================ */
const styleB = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="bgB" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b1a06"/><stop offset="1" stop-color="#4a2e08"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1080" fill="url(#bgB)"/>
  <circle cx="940" cy="140" r="240" fill="#ff9800" opacity="0.08"/>
  <circle cx="120" cy="930" r="280" fill="#ff9800" opacity="0.06"/>
  ${sparkle(880, 260, 1.2, "#ffca8a")}${sparkle(200, 190, 0.9, "#ffca8a")}

  <text x="90" y="150" font-family="${FONT}" font-size="26" font-weight="700" fill="#ff9800" letter-spacing="8">FANTONGBABY</text>
  <line x1="90" y1="182" x2="240" y2="182" stroke="#ff9800" stroke-width="4"/>

  <text x="90" y="330" font-family="${FONT}" font-size="110" font-weight="700" fill="#fff5ec">今天吃什么？</text>
  <text x="90" y="470" font-family="${FONT}" font-size="110" font-weight="700" fill="#ff9800">问饭桶宝。</text>

  <text x="90" y="580" font-family="${FONT}" font-size="34" fill="#ffd9ad">一家人的饭，一起搞定</text>

  <!-- 卖点清单 -->
  <g font-family="${FONT}" font-size="28" fill="#fff5ec">
    ${["家庭共享菜谱库，AI 快速录入", "邀请家人一起点菜，还能随机抽一道", "买菜清单自动汇总，多单一起买金额分摊", "做菜步骤打卡，干饭日历复盘"]
      .map(
        (t, i) => `
      <circle cx="104" cy="${668 + i * 62}" r="7" fill="#ff9800"/>
      <text x="128" y="${678 + i * 62}">${t}</text>`
      )
      .join("")}
  </g>

  <!-- 底部 -->
  ${qrHolder(860, 900, 140, null, null, true)}
  <text x="90" y="990" font-family="${FONT}" font-size="28" font-weight="700" fill="#fff5ec">微信搜索「饭桶宝」</text>
  <text x="90" y="1030" font-family="${FONT}" font-size="22" fill="#caa36a">菜谱 · 点菜 · 买菜 · 做菜</text>
</svg>`;

/* ================================================================
 * 风格 C「对话大字报」：白底 + 对话梗 + 标记笔
 * ================================================================ */
const styleC = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#ffffff"/>
  <circle cx="970" cy="110" r="190" fill="#fff5ec"/>
  <circle cx="100" cy="980" r="220" fill="#fff5ec"/>

  <!-- 对话气泡 -->
  <g font-family="${FONT}">
    <rect x="90" y="110" width="420" height="110" rx="32" fill="#f2f2f4"/>
    <text x="130" y="180" font-size="40" font-weight="700" fill="#333">今晚吃什么？</text>
    <rect x="660" y="260" width="330" height="110" rx="32" fill="#f2f2f4"/>
    <text x="700" y="330" font-size="40" font-weight="700" fill="#333">随便。</text>
    <line x1="690" y1="334" x2="960" y2="312" stroke="#ff6b4a" stroke-width="8" stroke-linecap="round"/>
  </g>

  <!-- 主标题 + 标记笔下划线 -->
  <text x="90" y="520" font-family="${FONT}" font-size="92" font-weight="700" fill="#432900">别再「随便」了</text>
  <rect x="90" y="548" width="480" height="26" rx="13" fill="#ffd54f" opacity="0.85"/>
  <text x="90" y="660" font-family="${FONT}" font-size="92" font-weight="700" fill="#874e00">打开饭桶宝</text>
  <rect x="90" y="688" width="480" height="26" rx="13" fill="#ffd54f" opacity="0.85"/>

  <text x="90" y="790" font-family="${FONT}" font-size="30" fill="#765524">家庭菜谱 · 一起点菜 · 随机一道 · 买菜清单 · 金额分摊 · 干饭日历</text>

  <!-- 底部 -->
  ${qrHolder(860, 880, 150)}
  <text x="90" y="930" font-family="${FONT}" font-size="30" font-weight="700" fill="#874e00">一家人的饭，一起搞定</text>
  <text x="90" y="976" font-family="${FONT}" font-size="24" fill="#765524">微信搜索「饭桶宝」立即体验</text>
</svg>`;

async function main() {
  const jobs = [
    ["风格A-家的温度.png", styleA],
    ["风格B-高级深棕.png", styleB],
    ["风格C-对话大字报.png", styleC],
  ];
  for (const [name, svg] of jobs) {
    fs.writeFileSync(path.join(OUT, name.replace(".png", ".svg")), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, name));
    console.log("done", name);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
