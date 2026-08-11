/* 生成三张分享卡片 500x400：品牌 / 邀请点菜 / 邀请加入家庭 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUT = "D:/code/fantongbao/miniprogram/images/share";
const FONT = "PingFang SC, Microsoft YaHei, sans-serif";

/* ---------- 通用背景 ---------- */
function bg(id) {
  return `
  <defs>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7ee"/>
      <stop offset="1" stop-color="#ffe3c2"/>
    </linearGradient>
    <filter id="soft${id}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
  </defs>
  <rect width="500" height="400" fill="url(#bg${id})"/>
  <circle cx="70" cy="60" r="90" fill="#ffd9ad" opacity="0.45"/>
  <circle cx="445" cy="345" r="110" fill="#ffcf9a" opacity="0.4"/>
  <circle cx="455" cy="55" r="42" fill="#ffe9d2" opacity="0.7"/>
  <!-- 白卡片 + 投影 -->
  <rect x="30" y="36" width="440" height="330" rx="30" fill="#d9a05e" opacity="0.28" filter="url(#soft${id})"/>
  <rect x="30" y="28" width="440" height="330" rx="30" fill="#ffffff"/>
  `;
}

/* ---------- 小元素 ---------- */
const tomato = (x, y, s = 1) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <circle r="17" fill="#ff6b4a"/>
    <path d="M0 -17 l-6 -8 M0 -17 l6 -8 M0 -17 l0 -11" stroke="#3d9b4f" stroke-width="4" stroke-linecap="round" fill="none"/>
    <circle cx="-6" cy="-5" r="5" fill="#ff8f73" opacity="0.8"/>
  </g>`;

const egg = (x, y, s = 1) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <ellipse rx="20" ry="15" fill="#fffdf7" stroke="#f0e2cd" stroke-width="2"/>
    <circle r="8" fill="#ffb020"/>
  </g>`;

const leaf = (x, y, r = 0, s = 1) => `
  <g transform="translate(${x},${y}) rotate(${r}) scale(${s})">
    <path d="M0 0 q14 -16 30 -12 q-4 18 -22 20 q-8 1 -8 -8 z" fill="#5cb56a"/>
    <path d="M4 -2 q12 -8 22 -8" stroke="#3d9b4f" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </g>`;

const sparkle = (x, y, s = 1, c = "#ffb85c") => `
  <path transform="translate(${x},${y}) scale(${s})" d="M0 -9 L2.4 -2.4 L9 0 L2.4 2.4 L0 9 L-2.4 2.4 L-9 0 L-2.4 -2.4 Z" fill="${c}"/>`;

const dot = (x, y, r, c, o = 1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="${o}"/>`;

/* 锅（沿用 L1 logo 造型） */
const pot = (x, y, s = 1) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <path d="M-22 -52 q-10 -18 0 -34 q10 -16 0 -32" stroke="#874e00" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.5"/>
    <path d="M22 -52 q-10 -18 0 -34 q10 -16 0 -32" stroke="#874e00" stroke-width="8" fill="none" stroke-linecap="round" opacity="0.72"/>
    <rect x="-74" y="-30" width="148" height="22" rx="11" fill="#874e00"/>
    <path d="M-66 -8 h132 v34 a44 44 0 0 1 -44 44 h-44 a44 44 0 0 1 -44 -44 z" fill="#ff9800"/>
    <ellipse cx="-30" cy="26" rx="14" ry="9" fill="#ffb54d" opacity="0.75"/>
  </g>`;

/* 碗+米饭 */
const bowl = (x, y, s = 1, flip = 1) => `
  <g transform="translate(${x},${y}) scale(${s * flip},${s})">
    <path d="M-40 0 a40 26 0 0 0 80 0 z" fill="#ff9800"/>
    <path d="M-40 0 h80 v4 h-80 z" fill="#e07f00"/>
    <path d="M-30 -4 a30 14 0 0 1 60 0 z" fill="#fffdf7"/>
    <path d="M-18 -10 q4 -6 0 -12 M0 -12 q4 -6 0 -12 M18 -10 q4 -6 0 -12" stroke="#d8c3a5" stroke-width="3.5" fill="none" stroke-linecap="round" opacity="0.9"/>
  </g>`;

const chopsticks = (x, y, r = 0, s = 1) => `
  <g transform="translate(${x},${y}) rotate(${r}) scale(${s})">
    <rect x="-4" y="-46" width="6" height="58" rx="3" fill="#874e00"/>
    <rect x="8" y="-46" width="6" height="58" rx="3" fill="#a66a1f"/>
  </g>`;

/* 小房子 */
const house = (x, y, s = 1) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <path d="M-52 6 L0 -42 L52 6 z" fill="#874e00"/>
    <rect x="-40" y="6" width="80" height="52" rx="10" fill="#ff9800"/>
    <rect x="-12" y="24" width="24" height="34" rx="8" fill="#fff5ec"/>
    <path d="M0 22 c-5 -8 -16 -4 -16 4 c0 7 9 11 16 16 c7 -5 16 -9 16 -16 c0 -8 -11 -12 -16 -4 z" fill="#ff6b4a" transform="translate(0,0) scale(0.62) translate(0,26)"/>
  </g>`;

function card(id, illustration, title, titleSize, sub, subSize, pill) {
  const pillW = pill ? pill.w : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400" viewBox="0 0 500 400">
  ${bg(id)}
  ${illustration}
  <text x="250" y="238" text-anchor="middle" font-family="${FONT}" font-size="${titleSize}" font-weight="700" fill="#874e00">${title}</text>
  <text x="250" y="274" text-anchor="middle" font-family="${FONT}" font-size="${subSize}" fill="#b3803f">${sub}</text>
  ${
    pill
      ? `<rect x="${250 - pillW / 2}" y="296" width="${pillW}" height="34" rx="17" fill="#fff1de"/>
         <text x="250" y="318" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#c47a1f">${pill.text}</text>`
      : ""
  }
</svg>`;
}

/* ---------- 1. 品牌卡 ---------- */
const brandIllu = `
  ${dot(96, 84, 4, "#ffca8a")}${dot(404, 74, 5, "#ffca8a")}${dot(420, 150, 3.5, "#ffd9a8")}
  ${sparkle(118, 64, 1)}${sparkle(392, 96, 0.8)}
  ${leaf(96, 158, -18, 0.9)}
  ${leaf(402, 170, 205, 0.85)}
  ${tomato(128, 168, 0.95)}
  ${egg(372, 172, 0.95)}
  ${pot(250, 128, 0.95)}
`;
const brandSvg = card("A", brandIllu, "饭桶宝", 44, "今天也要好好吃饭", 20, {
  text: "家庭菜谱 · 点菜 · 买菜 · 做菜",
  w: 254,
});

/* ---------- 2. 邀请点菜卡 ---------- */
const orderIllu = `
  ${dot(100, 78, 4, "#ffca8a")}${dot(408, 84, 5, "#ffca8a")}
  ${sparkle(112, 62, 0.9)}${sparkle(398, 64, 0.8)}${sparkle(250, 52, 0.75)}
  ${leaf(92, 178, -14, 0.8)}${leaf(408, 182, 198, 0.8)}
  ${bowl(160, 162, 0.95)}
  ${bowl(340, 162, 0.95, -1)}
  ${chopsticks(160, 128, -12, 0.9)}
  ${chopsticks(340, 128, 12, 0.9)}
  ${pot(250, 96, 0.62)}
`;
const orderSvg = card("B", orderIllu, "邀请您一起点菜", 34, "来饭桶宝，一起决定今天吃什么", 17, {
  text: "点我参与点菜",
  w: 128,
});

/* ---------- 3. 邀请加入家庭卡 ---------- */
const familyIllu = `
  ${dot(96, 82, 4, "#ffca8a")}${dot(406, 78, 5, "#ffca8a")}${dot(424, 152, 3.5, "#ffd9a8")}
  ${sparkle(110, 60, 1)}${sparkle(394, 94, 0.85)}
  ${leaf(96, 180, -16, 0.85)}${leaf(404, 184, 202, 0.85)}
  ${house(250, 118, 1.05)}
  ${tomato(126, 176, 0.85)}
  ${egg(376, 178, 0.85)}
`;
const familySvg = card("C", familyIllu, "邀请你加入我们的家", 32, "一家人，一起吃好每一顿饭", 17, {
  text: "点我加入家庭",
  w: 128,
});

async function main() {
  const jobs = [
    ["share-brand", brandSvg],
    ["share-order-invite", orderSvg],
    ["share-family-invite", familySvg],
  ];
  for (const [name, svg] of jobs) {
    fs.writeFileSync(path.join(OUT, `${name}.svg`), svg);
    await sharp(Buffer.from(svg), { density: 144 })
      .resize(500, 400)
      .png()
      .toFile(path.join(OUT, `${name}.png`));
    console.log("done", name);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
