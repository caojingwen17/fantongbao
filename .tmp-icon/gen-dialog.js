/* 对话大字报系列：1080x1080，统一模板，不同场景梗 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const OUT = "D:/code/fantongbao/宣传物料/宣传图";
const FONT = "PingFang SC, Microsoft YaHei, sans-serif";
const QR_DATA = "data:image/jpeg;base64," + fs.readFileSync("D:/code/fantongbao/宣传物料/小程序码.jpg").toString("base64");
fs.mkdirSync(OUT, { recursive: true });

/** 小程序码（白底圆角托 + 真码） */
const qrHolder = (x, y, size) => `
  <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="20" fill="#ffffff" stroke="#f0dfc8" stroke-width="3"/>
  <image href="${QR_DATA}" x="${x + 12}" y="${y + 12}" width="${size - 24}" height="${size - 24}"/>`;

/** 聊天气泡：side = left | right，strike = 是否画删除线 */
function bubble({ side, text, y, strike, strikeDrift = -8 }) {
  const fontSize = 38;
  const estW = text.length * fontSize + 80; // 粗估宽度
  const w = Math.min(estW, 880);
  const x = side === "left" ? 90 : 990 - w;
  const line = strike
    ? `<line x1="${x + 26}" y1="${y + 62}" x2="${x + w - 26}" y2="${y + 62 + strikeDrift}" stroke="#ff6b4a" stroke-width="8" stroke-linecap="round"/>`
    : "";
  return `
    <rect x="${x}" y="${y}" width="${w}" height="104" rx="30" fill="#f2f2f4"/>
    <text x="${x + 40}" y="${y + 68}" font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="#333">${text}</text>
    ${line}`;
}

/** 大字报模板 */
function poster({ bubbles, headline, sub }) {
  // headline: [{ text, mark }] mark=true 的行用主色 + 荧光笔下划线
  const heads = headline
    .map((h, i) => {
      const y = 560 + i * 150;
      const color = h.mark ? "#874e00" : "#432900";
      const estW = h.text.length * 88 + 16;
      const marker = h.mark
        ? `<rect x="86" y="${y + 24}" width="${Math.min(estW, 900)}" height="26" rx="13" fill="#ffd54f" opacity="0.85"/>`
        : "";
      return `${marker}<text x="90" y="${y}" font-family="${FONT}" font-size="88" font-weight="700" fill="${color}">${h.text}</text>`;
    })
    .join("");
  const subY = 560 + headline.length * 150 + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#ffffff"/>
  <circle cx="970" cy="110" r="190" fill="#fff5ec"/>
  <circle cx="100" cy="980" r="220" fill="#fff5ec"/>
  <g>${bubbles.map((b, i) => bubble({ ...b, y: 110 + i * 142 })).join("")}</g>
  ${heads}
  <text x="90" y="${subY}" font-family="${FONT}" font-size="30" fill="#765524">${sub}</text>
  <text x="90" y="930" font-family="${FONT}" font-size="30" font-weight="700" fill="#874e00">一家人的饭，一起搞定</text>
  <text x="90" y="976" font-family="${FONT}" font-size="24" fill="#765524">微信搜索「饭桶宝」立即体验</text>
  ${qrHolder(860, 880, 150)}
</svg>`;
}

const posters = [
  {
    file: "大字报-01-随便.png",
    bubbles: [
      { side: "left", text: "今晚吃什么？" },
      { side: "right", text: "随便。", strike: true },
    ],
    headline: [{ text: "别再「随便」了" }, { text: "打开饭桶宝", mark: true }],
    sub: "家庭菜谱 · 一起点菜 · 随机一道 · 买菜清单 · 金额分摊 · 干饭日历",
  },
  {
    file: "大字报-02-语音方阵.png",
    bubbles: [
      { side: "left", text: "妈，红烧肉咋做来着？" },
      { side: "right", text: "你听我语音说（7 条 60″）" },
    ],
    headline: [{ text: "家传菜谱" }, { text: "别再靠语音了", mark: true }],
    sub: "拍照 · 文字 · 链接，AI 帮你 10 秒录入，全家共享",
  },
  {
    file: "大字报-03-买葱.png",
    bubbles: [
      { side: "left", text: "让你买的葱呢？" },
      { side: "right", text: "你也没说啊……" },
    ],
    headline: [{ text: "买菜清单" }, { text: "自动生成", mark: true }],
    sub: "食材调料分好类，逐条勾选；多单一起买，金额自动分摊",
  },
  {
    file: "大字报-04-伙食费.png",
    bubbles: [
      { side: "left", text: "这个月伙食费又超了？" },
      { side: "right", text: "钱花哪了啊……" },
    ],
    headline: [{ text: "干饭日历" }, { text: "一目了然", mark: true }],
    sub: "每天吃了啥、花了多少，月底自动复盘",
  },
  {
    file: "大字报-05-都行.png",
    bubbles: [
      { side: "left", text: "火锅还是炒菜？" },
      { side: "right", text: "都行。", strike: true },
    ],
    headline: [{ text: "别再「都行」了" }, { text: "抽卡决定", mark: true }],
    sub: "邀请全家一起点菜，不知道吃啥就随机一道，愿赌服输",
  },
  {
    file: "大字报-06-翻手机.png",
    bubbles: [
      { side: "left", text: "下一步该放啥来着？" },
      { side: "right", text: "等我擦擦手翻下手机" },
    ],
    headline: [{ text: "做菜步骤" }, { text: "逐条打卡", mark: true }],
    sub: "备菜做菜一目了然，厨房里不用再来回翻手机",
  },
  {
    file: "大字报-07-没买姜.png",
    bubbles: [
      { side: "left", text: "姜买了吗？" },
      { side: "right", text: "……" },
    ],
    headline: [{ text: "饭做到一半" }, { text: "发现没买姜", mark: true }],
    sub: "点完菜买菜清单自动生成，漏买一根葱？不存在了",
  },
];

async function main() {
  for (const p of posters) {
    const svg = poster(p);
    fs.writeFileSync(path.join(OUT, p.file.replace(".png", ".svg")), svg);
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, p.file));
    console.log("done", p.file);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
