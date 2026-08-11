const cloud = require("wx-server-sdk");
const https = require("https");
const { getOpenidOrThrow } = require("./auth");
const xhsParser = require("./xhsParser");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const AI_RATE_WINDOW_MS = 60 * 60 * 1000;
const AI_RATE_MAX_CALLS = 40;

// 同一云函数实例只兜底创建一次，避免每次调用都白跑一次 createCollection 往返
let aiUsageCollectionEnsured = false;

async function ensureAiUsageCollection() {
  if (aiUsageCollectionEnsured) return;
  aiUsageCollectionEnsured = true;
  try {
    await db.createCollection("ai_usage_logs");
  } catch (e) {
    /* ignore */
  }
}

async function assertAiRateLimit(openid) {
  await ensureAiUsageCollection();
  const since = new Date(Date.now() - AI_RATE_WINDOW_MS);
  const countRes = await db
    .collection("ai_usage_logs")
    .where({
      openid,
      createTime: db.command.gte(since),
    })
    .count();
  const total = (countRes && typeof countRes.total === "number" ? countRes.total : 0) || 0;
  if (total >= AI_RATE_MAX_CALLS) {
    throw new Error("AI 调用过于频繁，请稍后再试");
  }
  await db.collection("ai_usage_logs").add({
    data: { openid, createTime: new Date() },
  });
}

async function assertFamilyMember({ openid, familyId }) {
  const famRes = await db.collection("families").where({ _id: familyId }).get();
  const fam = famRes && famRes.data && famRes.data[0] ? famRes.data[0] : null;
  if (!fam) throw new Error("家庭不存在");
  if (!Array.isArray(fam.memberIds) || !fam.memberIds.includes(openid)) {
    throw new Error("没有家庭访问权限");
  }
  return fam;
}

function isCloudPathForFamily(fileId, familyId) {
  const s = normalizeCloudFilePath(fileId);
  const fid = safeStr(familyId).trim();
  if (!s || !fid) return false;
  return s.includes(`/imports/recipe_ocr/${fid}/`) || s.includes(`/recipes/${fid}/`);
}

async function assertImageFileIdsForFamily({ openid, familyId, fileIds }) {
  if (!familyId) throw new Error("缺少 familyId");
  await assertFamilyMember({ openid, familyId });
  for (const fileID of fileIds) {
    if (!isCloudPathForFamily(fileID, familyId)) {
      throw new Error("图片不属于当前家庭，请重新上传");
    }
  }
}

function safeStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

/** 将百炼 API 英文报错转为用户可读提示 */
function formatBailianUserTip(errMsg, fallback) {
  const s = safeStr(errMsg);
  const def = fallback || "AI 调用失败，已生成空白模板，请手动填写或重试";
  if (!s) return def;
  if (/free quota has been exhausted|free tier only/i.test(s)) {
    return "百炼免费额度已用完：请在阿里云百炼控制台开通按量付费（或关闭「仅免费额度」）后重试";
  }
  if (/insufficient.*balance|Arrearage|欠费|余额不足/i.test(s)) {
    return "百炼账户余额不足，请充值后重试";
  }
  if (/InvalidApiKey|invalid.*api.?key|Unauthorized/i.test(s)) {
    return "百炼 API Key 无效，请检查云函数环境变量 DASHSCOPE_API_KEY";
  }
  if (/rate limit|too many requests|Throttling/i.test(s)) {
    return "百炼调用过于频繁，请稍后再试";
  }
  return s.length <= 60 ? s : def;
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return "";
}

function jsonParseLoose(text) {
  const s = safeStr(text).trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const fromFence = tryParseJsonObject(fenced[1].trim());
    if (fromFence) return fromFence;
  }

  try {
    return JSON.parse(s);
  } catch (e) {
    /* continue */
  }

  return tryParseJsonObject(s);
}

/** 从长文本中找出第一个可解析的 JSON 对象（避免贪婪正则截断） */
function tryParseJsonObject(text) {
  const s = safeStr(text);
  if (!s) return null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const chunk = s.slice(i, j + 1);
          try {
            const obj = JSON.parse(chunk);
            if (obj && typeof obj === "object") return obj;
          } catch (e) {
            /* try next */
          }
          break;
        }
      }
    }
  }
  return null;
}

function coerceModelRecipeShape(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  if (!out.ingredients) {
    out.ingredients = out.食材 || out.ingredient_list || out.ingredientList || out.materials;
  }
  if (!out.seasonings) {
    out.seasonings = out.调料 || out.seasoning_list || out.seasoningList || out.condiments;
  }
  if (!out.prepareSteps) {
    out.prepareSteps = out.备菜步骤 || out.prep_steps || out.prepSteps || out.prepare_steps;
  }
  if (!out.cookingSteps) {
    out.cookingSteps = out.做菜步骤 || out.cook_steps || out.cookSteps || out.cooking_steps || out.烹饪步骤;
  }
  if (!out.recipeName) {
    out.recipeName = out.name || out.菜名 || out.title;
  }
  return out;
}

/** 标准 JSON 示例（模型必须遵循此结构） */
const RECIPE_JSON_EXAMPLE = {
  recipeName: "青椒炒鸡翅",
  ingredients: [
    { name: "鸡翅中", amount: "8个" },
    { name: "青椒", amount: "2个" },
    { name: "鸡蛋", amount: "2个" },
    { name: "姜", amount: "3片" },
  ],
  seasonings: [
    { name: "生抽", amount: "" },
    { name: "盐", amount: "" },
  ],
  prepareSteps: ["鸡翅洗净对半切开", "青椒去籽切块", "鸡蛋打散", "姜切片备用"],
  cookingSteps: ["热锅少油下鸡翅煎至两面微黄", "加入姜片和青椒翻炒", "倒入蛋液炒熟，加生抽和盐调味，炒匀出锅"],
};

function buildStrictJsonOutputRules(hard) {
  const lines = [
    "【输出格式 — 必须严格遵守】",
    "1) 只输出一个 JSON 对象，不要输出 markdown、不要 ```json 代码块、不要任何解释或前后缀文字。",
    "2) 顶层字段必须且只能包含：recipeName、ingredients、seasonings、prepareSteps、cookingSteps（全部使用英文键名，禁止使用中文字段名）。",
    "3) ingredients 与 seasonings 必须是对象数组，每项格式固定为 {\"name\":\"\",\"amount\":\"\"}，禁止用字符串数组。",
    "4) prepareSteps 与 cookingSteps 必须是字符串数组，每项一条可执行步骤。",
    "5) amount 没有用量时写空字符串 \"\"，不要省略 name 字段。",
    "6) 禁止输出「请补充、待补充、示例、模板」等占位词；内容必须具体可执行。",
    "7) 你的回复第一个字符必须是 {，最后一个字符必须是 }。",
    "",
    "【标准示例（结构必须与之一致，内容按实际识别/生成填写）】",
    JSON.stringify(RECIPE_JSON_EXAMPLE, null, 0),
  ];
  if (hard) {
    lines.push(
      "",
      "【强约束】ingredients 至少 3 条；prepareSteps 至少 3 条；cookingSteps 至少 4 条；seasonings 至少 2 条。"
    );
  }
  return lines.join("\n");
}

/** 食材/调料名称统一：别名 → 标准名（后处理兜底，与提示词规则一致） */
const RECIPE_CANONICAL_NAMES = {
  // 葱姜蒜香料
  葱: ["小葱", "香葱", "大葱", "青葱", "葱花", "葱白", "葱丝", "葱末", "葱头"],
  姜: ["生姜", "老姜", "嫩姜", "姜片", "姜丝", "姜末", "姜块"],
  蒜: ["大蒜", "蒜头", "蒜瓣", "蒜末", "蒜泥", "蒜蓉", "蒜片"],
  蒜苗: ["青蒜", "蒜黄"],
  蒜苔: ["蒜薹"],
  洋葱: ["圆葱"],
  韭菜: ["韭黄", "韭菜花"],
  香菜: ["芫荽"],
  小米辣: ["小米椒", "朝天椒", "指天椒"],
  干辣椒: ["干红椒", "红辣椒", "辣椒段"],
  青椒: ["甜椒", "菜椒", "彩椒", "柿子椒"],
  红椒: ["红甜椒", "红菜椒"],
  花椒: ["川椒", "麻椒", "青花椒", "红花椒"],
  八角: ["大料", "茴香角"],
  桂皮: ["肉桂"],
  香叶: ["月桂叶"],
  陈皮: ["橘皮", "干橘皮"],
  // 常见蔬菜
  西红柿: ["番茄", "蕃茄"],
  土豆: ["马铃薯", "洋芋", "地蛋"],
  红薯: ["地瓜", "番薯", "山芋"],
  白菜: ["大白菜", "黄芽白"],
  // 基础调料
  盐: ["食盐", "精盐", "细盐", "海盐"],
  糖: ["白糖", "砂糖", "细砂糖", "绵白糖"],
  冰糖: ["冰片糖", "老冰糖"],
  生抽: ["味极鲜", "海鲜酱油"],
  老抽: ["红烧酱油", "上色酱油"],
  蚝油: ["耗油"],
  料酒: ["黄酒", "米酒", "花雕酒", "烹饪酒"],
  醋: ["陈醋", "米醋", "香醋", "白醋"],
  食用油: ["植物油", "炒菜油", "色拉油", "调和油"],
  花生油: ["生油"],
  菜籽油: ["菜油"],
  芝麻油: ["香油", "麻油", "芝麻香油"],
  淀粉: ["生粉", "玉米淀粉", "土豆淀粉", "地瓜粉"],
  胡椒粉: ["白胡椒粉", "黑胡椒粉", "胡椒面"],
  辣椒粉: ["辣椒面"],
  花椒粉: ["花椒面", "麻椒粉"],
  孜然粉: ["孜然"],
  豆瓣酱: ["郫县豆瓣", "辣豆瓣", "豆酱"],
  豆豉: ["干豆豉", "永川豆豉"],
  番茄酱: ["番茄沙司"],
  甜面酱: ["面酱"],
  黄豆酱: ["大酱"],
  芝麻酱: ["麻酱"],
  沙拉酱: ["蛋黄酱"],
  腐乳: ["豆腐乳", "南乳"],
  味精: ["味素"],
  鸡精: ["鸡粉"],
  五香粉: [],
  十三香: ["十三香调料"],
  咖喱粉: ["咖喱块"],
  蜂蜜: ["蜜糖"],
  芥末: ["芥末酱", "青芥"],
  小苏打: ["食用碱"],
};

const RECIPE_ALIAS_TO_CANONICAL = (() => {
  const map = {};
  Object.entries(RECIPE_CANONICAL_NAMES).forEach(([canonical, aliases]) => {
    map[canonical] = canonical;
    (aliases || []).forEach((alias) => {
      map[alias] = canonical;
    });
  });
  // 未标明生抽/老抽时，「酱油」默认归生抽
  map.酱油 = "生抽";
  // 单独写「油」时归食用油
  map.油 = "食用油";
  return map;
})();

function canonicalizeRecipeItemName(name) {
  const raw = safeStr(name).trim();
  if (!raw) return raw;
  if (RECIPE_ALIAS_TO_CANONICAL[raw]) return RECIPE_ALIAS_TO_CANONICAL[raw];
  // 剥掉括号注释与常见形态后缀再匹配：小葱（切碎）/ 小葱段 / 小葱末 → 小葱
  const stripped = raw
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/(段|末|花|碎|丝|片|块|丁|茸|泥|粒|圈)+$/g, "")
    .trim();
  if (stripped && RECIPE_ALIAS_TO_CANONICAL[stripped]) {
    return RECIPE_ALIAS_TO_CANONICAL[stripped];
  }
  return raw;
}

/** 来源忠实规则：禁止编造原文/图片中没有的内容（用于图片 OCR 后的结构化场景） */
function buildSourceFidelityRules() {
  return [
    "【来源忠实规则 — 防止编造，优先级最高】",
    "1) 只允许提取原文中出现的信息；禁止编造原文没有的食材、调料、用量和步骤。",
    "2) 原文没有提到的类别，对应字段输出空数组 []，不要根据菜名猜测补全。",
    "3) 用量以原文为准；原文未写用量时 amount 留空字符串 \"\"，不要自行估算。",
    "4) 步骤按原文顺序整理，可精简表述，但不得新增、拼接出原文没有的操作。",
    "5) 原文中的非菜谱内容（广告、评论、点赞引导等）一律忽略。",
  ].join("\n");
}

function buildIngredientSeasoningRules() {
  return [
    "【食材/调料分类规则】",
    "1) ingredients：主料、配菜等实物食材（如鸡翅、青椒、土豆、鸡蛋）。",
    "2) seasonings：盐、糖、生抽、老抽、蚝油、料酒、醋、胡椒、花椒粉、豆瓣、淀粉、鸡精、味精、油类等调味品。",
    "3) 葱、姜、蒜、蒜苗、蒜苔、洋葱、韭菜、香菜、小米辣、干辣椒、青椒、红椒等香辛配菜一律属于 ingredients，即使用于爆香/增香也禁止放入 seasonings。",
    "4) 明显用于调味的项禁止放进 ingredients；同名项不要在两边重复出现。",
    "",
    "【名称统一规则 — name 字段必须使用标准名，禁止输出别名】",
    "葱姜蒜香料：葱（小葱/香葱/大葱/葱花/葱白等）、姜（生姜/老姜/姜片/姜丝等）、蒜（大蒜/蒜头/蒜末/蒜蓉等）、蒜苗、蒜苔、洋葱、韭菜、香菜、小米辣、干辣椒、青椒、红椒、花椒、八角、桂皮、香叶、陈皮",
    "常见蔬菜：西红柿（番茄）、土豆（马铃薯/洋芋）、红薯（地瓜/番薯）、白菜（大白菜）",
    "基础调料：盐、糖、冰糖、生抽（味极鲜；未标明时酱油默认生抽）、老抽、蚝油、料酒、醋、食用油（未指明种类时油/植物油）、花生油、菜籽油、芝麻油（香油/麻油）、淀粉（生粉）、胡椒粉、辣椒粉、花椒粉、孜然粉、豆瓣酱、豆豉、番茄酱、甜面酱、黄豆酱、芝麻酱、沙拉酱、腐乳、味精、鸡精、五香粉、十三香、咖喱粉、蜂蜜、芥末、小苏打",
    "5) 「葱姜蒜」写在同一行时必须拆成 葱、姜、蒜 三条；用量只写在 amount。",
    "6) 花椒/八角/桂皮/香叶整粒入菜放 ingredients，粉状放 seasonings。",
    "7) 蛋类（鸡蛋、鸭蛋、鹌鹑蛋、皮蛋等）、肉类、豆制品、蔬菜一律属于 ingredients，禁止放入 seasonings。",
    "8) 常见家常调料（盐、糖、生抽、老抽、蚝油、料酒、醋、食用油、鸡精、味精、胡椒粉、芝麻油等）的 amount 一律输出空字符串 \"\"，用量由用户按口味掌握，禁止估算「1勺/2勺/少许/适量」；只有原文明确写出且对菜品关键的用量（如腌制配比）才保留在 amount。",
    "9) 原文为无标点连续描述时，必须先按食材/调料词逐项切分，量词只归属紧邻的那个词，禁止把其他食材的名称或用量粘进某项的 amount。例如「两大勺生抽一颗鸡蛋」应拆为：seasonings 里 生抽(amount \"\")，ingredients 里 鸡蛋(amount \"1颗\")。",
  ].join("\n");
}

/** 云函数日志中打印模型原始输出（分段，避免单条过长被截断） */
function logModelOutput(scene, model, text, parsed) {
  const body = safeStr(text);
  const chunkSize = 3000;
  try {
    console.log(
      `[aiFunctions][${scene}] model=${model} textLen=${body.length} parseOk=${!!parsed}`
    );
    if (parsed && typeof parsed === "object") {
      console.log(`[aiFunctions][${scene}] parsedKeys=${Object.keys(parsed).join(",")}`);
    }
    if (!body) {
      console.log(`[aiFunctions][${scene}] output: (empty)`);
      return;
    }
    const parts = Math.ceil(body.length / chunkSize) || 1;
    for (let i = 0; i < parts; i++) {
      const part = body.slice(i * chunkSize, (i + 1) * chunkSize);
      console.log(`[aiFunctions][${scene}] output[${i + 1}/${parts}]:`, part);
    }
  } catch (e) {
    console.warn(`[aiFunctions][${scene}] logModelOutput failed:`, safeStr(e && e.message));
  }
}

function parseRecipeJsonFromModelText(scene, model, text) {
  const parsed = jsonParseLoose(text);
  logModelOutput(scene, model, text, parsed);
  return parsed;
}

function isValidXhsUrl(url) {
  const u = safeStr(url).trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    const host = (parsed.hostname || "").toLowerCase();
    return host.includes("xiaohongshu.com") || host.includes("xhslink.com") || host.includes("xhslink.cn");
  } catch (e) {
    return false;
  }
}

function genGenericRecipeByName(recipeName) {
  const name = safeStr(recipeName).trim() || "未命名菜谱";
  return {
    recipeName: name,
    ingredients: [{ name: "食材（请补充）", amount: "" }],
    seasonings: [{ name: "调料（请补充）", amount: "" }],
    prepareSteps: ["备菜：请补充步骤"],
    cookingSteps: ["做菜：请补充步骤"],
  };
}

function httpsJson({ url, method = "POST", headers = {}, body, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers,
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          const status = res.statusCode || 0;
          const ct = String((res.headers && res.headers["content-type"]) || "");
          let parsed = null;
          if (ct.includes("application/json")) {
            parsed = jsonParseLoose(buf);
          } else {
            parsed = jsonParseLoose(buf) || { raw: buf };
          }
          if (status >= 200 && status < 300) {
            resolve({ status, data: parsed, raw: buf });
            return;
          }
          const msg = (parsed && parsed.error && parsed.error.message) || (parsed && parsed.message) || buf || `HTTP ${status}`;
          const err = new Error(msg);
          err.status = status;
          err.response = parsed;
          reject(err);
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error("请求超时"));
      } catch (e) {}
    });
    if (body !== undefined) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function getBailianBaseUrl() {
  let baseUrl = safeStr(process.env.BAILIAN_BASE_URL).trim();
  if (!baseUrl || baseUrl.includes("/api/v2/apps/protocols/")) {
    baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  return baseUrl;
}

function getBailianApiKey() {
  return safeStr(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY).trim();
}

/** 文本类：菜名生成、粘贴文案提炼 */
function getTextModel() {
  const explicit = safeStr(process.env.QWEN_TEXT_MODEL).trim();
  if (explicit) return explicit;
  const legacy = safeStr(process.env.QWEN_VISION_MODEL).trim();
  if (legacy && !/ocr/i.test(legacy)) return legacy;
  return "qwen3.5-flash";
}

/** 多模态/OCR：多图识别 */
function getVisionModel() {
  const explicit = safeStr(process.env.QWEN_VISION_MODEL).trim();
  if (explicit) return explicit;
  return "qwen3.5-ocr";
}

/** 图片 OCR 后的 JSON 结构化（默认 flash，比 plus 快） */
function getOcrStructureTextModel() {
  const o = safeStr(process.env.QWEN_OCR_TEXT_MODEL).trim();
  if (o) return o;
  return "qwen3.5-flash";
}

/** 视频理解模型（需支持视频输入的 VL 模型；未配置则跳过视频画面识别） */
function getVideoModel() {
  return safeStr(process.env.QWEN_VIDEO_MODEL).trim();
}

/** 图片识别流水线：ocr_then_text（快）| vision_json（旧） */
function getImagePipeline() {
  const p = safeStr(process.env.AI_IMAGE_PIPELINE).trim().toLowerCase();
  if (p === "vision_json" || p === "json") return "vision_json";
  return "ocr_then_text";
}

const IMAGE_AI_MAX_COUNT = 6;
const IMAGE_AI_MAX_BYTES = 8 * 1024 * 1024;

function pickImagesForApi(images) {
  const picked = [];
  let totalBytes = 0;
  for (const img of images || []) {
    if (picked.length >= IMAGE_AI_MAX_COUNT) break;
    const b64 = safeStr(img && img.imageBase64);
    if (!b64) continue;
    const bytes = Math.ceil((b64.length * 3) / 4);
    if (picked.length > 0 && totalBytes + bytes > IMAGE_AI_MAX_BYTES) break;
    picked.push(img);
    totalBytes += bytes;
  }
  return picked;
}

async function downloadImagesFromFileIds(fileIds) {
  const rows = await Promise.all(
    (fileIds || []).map(async (fileID) => {
      const dl = await cloud.downloadFile({ fileID });
      const buf = dl && dl.fileContent ? dl.fileContent : null;
      if (!buf) throw new Error(`图片下载失败：${fileID}`);
      return {
        imageBase64: Buffer.from(buf).toString("base64"),
        mimeType: detectMimeFromBuffer(buf),
      };
    })
  );
  return rows;
}

/** 从外部 URL 下载图片（小红书图集），失败/超限的跳过，全部失败则抛错 */
async function downloadImagesFromUrls(urls, maxCount) {
  const picked = (urls || []).slice(0, maxCount || IMAGE_AI_MAX_COUNT);
  const results = await Promise.all(
    picked.map(async (url) => {
      try {
        const buf = await xhsParser.downloadImageBuffer(url);
        return {
          imageBase64: buf.toString("base64"),
          mimeType: detectMimeFromBuffer(buf),
        };
      } catch (e) {
        console.warn("[aiFunctions] xhs image download failed:", safeStr(e && e.message));
        return null;
      }
    })
  );
  const rows = results.filter(Boolean);
  if (!rows.length) throw new Error("笔记图片下载失败");
  return rows;
}

async function callResponsesApi({ apiKey, baseUrl, model, input, scene, timeoutMs = 45000 }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/responses`;
  const body = buildResponsesBody(model, input);
  const resp = await httpsJson({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    timeoutMs,
  });
  const data = resp && resp.data ? resp.data : null;
  const text = extractTextFromResponseData(data, safeStr(resp && resp.raw)) || "";
  return { data, text, raw: safeStr(resp && resp.raw) };
}

function buildVisionContent(prompt, images) {
  const content = [{ type: "input_text", text: prompt }];
  for (const img of images) {
    const mime = safeStr(img.mimeType || "image/jpeg").trim() || "image/jpeg";
    content.push({
      type: "input_image",
      image_url: `data:${mime};base64,${img.imageBase64}`,
    });
  }
  return content;
}

function getBailianConfig(kind) {
  return {
    apiKey: getBailianApiKey(),
    baseUrl: getBailianBaseUrl(),
    model: kind === "vision" ? getVisionModel() : getTextModel(),
  };
}

function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 4) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return "image/jpeg";
}

function normalizeCloudFilePath(fileId) {
  try {
    return decodeURIComponent(String(fileId || ""));
  } catch (e) {
    return String(fileId || "");
  }
}

function buildResponsesBody(model, input, extra) {
  const body = { model, input, reasoning: { effort: "none" } };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return body;
}

function normalizeRecipeOut(obj, fallbackName) {
  const base = genGenericRecipeByName(fallbackName);
  const src = coerceModelRecipeShape(obj);
  if (!src || typeof src !== "object") return base;
  const recipeName = safeStr(src.recipeName || src.name || fallbackName).trim() || fallbackName;
  const ingredients = Array.isArray(src.ingredients) ? src.ingredients : base.ingredients;
  const seasonings = Array.isArray(src.seasonings) ? src.seasonings : base.seasonings;
  const prepareSteps = Array.isArray(src.prepareSteps) ? src.prepareSteps : base.prepareSteps;
  const cookingSteps = Array.isArray(src.cookingSteps) ? src.cookingSteps : base.cookingSteps;

  const cleanedIngredients = ingredients
    .map((x) => {
      if (x && typeof x === "object") {
        return { name: safeStr(x.name).trim(), amount: safeStr(x.amount).trim() };
      }
      if (typeof x === "string" && x.trim()) {
        return { name: x.trim(), amount: "" };
      }
      return null;
    })
    .filter((x) => x && x.name);
  const cleanedSeasonings = seasonings
    .map((x) => {
      if (x && typeof x === "object") {
        return { name: safeStr(x.name).trim(), amount: safeStr(x.amount).trim() };
      }
      if (typeof x === "string" && x.trim()) {
        return { name: x.trim(), amount: "" };
      }
      return null;
    })
    .filter((x) => x && x.name);
  const cleanedPrepareSteps = prepareSteps
    .map((s) => (typeof s === "string" ? safeStr(s).trim() : safeStr(s && s.text).trim()))
    .filter((s) => s);
  const cleanedCookingSteps = cookingSteps
    .map((s) => (typeof s === "string" ? safeStr(s).trim() : safeStr(s && s.text).trim()))
    .filter((s) => s);

  const seasoningRe = /(盐|糖|酱油|生抽|老抽|蚝油|料酒|醋|胡椒|孜然|豆瓣|豆豉|辣椒粉|花椒粉|淀粉|鸡精|味精|芝麻油|香油|番茄酱|沙拉酱|咖喱)/i;
  /** 明显是食材、禁止留在调料列表的项（模型误分类反向纠偏） */
  const neverSeasoningRe = /(鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|皮蛋|咸蛋|松花蛋)/;
  /** 香辛配菜：即使被模型判成调料也归食材。精确匹配标准名，避免误伤花椒粉/辣椒粉等 */
  const NEVER_SEASONING_EXACT = {
    葱: 1, 姜: 1, 蒜: 1, 蒜苗: 1, 蒜苔: 1, 洋葱: 1, 韭菜: 1, 香菜: 1,
    小米辣: 1, 干辣椒: 1, 青椒: 1, 红椒: 1, 花椒: 1, 八角: 1, 桂皮: 1, 香叶: 1,
  };
  /** 常见家常调料：amount 强制留空，用量由用户按口味掌握（与提示词规则一致） */
  const COMMON_SEASONING_NO_AMOUNT = {
    盐: 1, 糖: 1, 生抽: 1, 老抽: 1, 蚝油: 1, 料酒: 1, 醋: 1,
    食用油: 1, 花生油: 1, 菜籽油: 1, 芝麻油: 1,
    鸡精: 1, 味精: 1, 胡椒粉: 1, 辣椒粉: 1, 花椒粉: 1, 孜然粉: 1,
    五香粉: 1, 十三香: 1,
  };
  /** amount 中混入食材名词，说明模型把多项粘在一起了（如生抽 amount="1颗鸡蛋+三大勺"），清掉兜底 */
  const amountFusedRe = /(鸡蛋|鸭蛋|鹅蛋|鹌鹑蛋|皮蛋|咸蛋|松花蛋|大排|排骨)/;
  const sanitizeAmount = (a) => {
    const s = safeStr(a).trim();
    return amountFusedRe.test(s) ? "" : s;
  };
  const norm = (s) =>
    safeStr(s)
      .trim()
      .replace(/\s+/g, "")
      .replace(/[，,。\.、;；:：!！\?？\(\)（）【】\[\]'"“”‘’]/g, "")
      .toLowerCase();
  const seenIng = {};
  const seenSea = {};
  const finalIngredients = [];
  const finalSeasonings = [];

  const pushUnique = (list, seen, item) => {
    const canonicalName = canonicalizeRecipeItemName(item.name);
    const key = norm(canonicalName);
    if (!key) return;
    const amount = sanitizeAmount(item.amount);
    if (seen[key]) {
      const existing = list.find((x) => norm(x.name) === key);
      if (existing && !existing.amount && amount) existing.amount = amount;
      return;
    }
    seen[key] = true;
    list.push({ name: canonicalName, amount });
  };

  // 先放模型的调料；明显是食材的项（如鸡蛋、蒜、小米辣）纠偏回食材列表
  cleanedSeasonings.forEach((x) => {
    const canonicalName = canonicalizeRecipeItemName(x.name);
    if (
      neverSeasoningRe.test(canonicalName) ||
      neverSeasoningRe.test(x.name) ||
      NEVER_SEASONING_EXACT[canonicalName]
    ) {
      pushUnique(finalIngredients, seenIng, { name: canonicalName, amount: x.amount });
      return;
    }
    pushUnique(finalSeasonings, seenSea, x);
  });

  // 对模型的食材做纠偏：像调料的项移到调料列表
  cleanedIngredients.forEach((x) => {
    const canonicalName = canonicalizeRecipeItemName(x.name);
    const key = norm(canonicalName);
    if (!key) return;
    if (
      neverSeasoningRe.test(canonicalName) ||
      neverSeasoningRe.test(x.name) ||
      NEVER_SEASONING_EXACT[canonicalName]
    ) {
      pushUnique(finalIngredients, seenIng, { name: canonicalName, amount: x.amount });
      return;
    }
    if (seasoningRe.test(canonicalName) || seasoningRe.test(x.name)) {
      pushUnique(finalSeasonings, seenSea, { name: canonicalName, amount: x.amount });
      return;
    }
    pushUnique(finalIngredients, seenIng, { name: canonicalName, amount: x.amount });
  });

  // 常见家常调料用量强制留空
  finalSeasonings.forEach((x) => {
    if (COMMON_SEASONING_NO_AMOUNT[x.name]) x.amount = "";
  });

  return {
    recipeName,
    ingredients: finalIngredients.length ? finalIngredients : base.ingredients,
    seasonings: finalSeasonings.length ? finalSeasonings : base.seasonings,
    prepareSteps: cleanedPrepareSteps.length ? cleanedPrepareSteps : base.prepareSteps,
    cookingSteps: cleanedCookingSteps.length ? cleanedCookingSteps : base.cookingSteps,
  };
}

function extractTextFromResponseData(data, rawText) {
  const direct = pickFirst(data && data.output_text, data && data.text);
  if (direct) return direct;

  const ocrDirect = data && data.ocr_result;
  if (ocrDirect) {
    return typeof ocrDirect === "string" ? ocrDirect : JSON.stringify(ocrDirect);
  }

  const out = (data && data.output) || [];
  if (Array.isArray(out)) {
    let all = "";
    for (const item of out) {
      if (item && item.ocr_result) {
        const ocrStr =
          typeof item.ocr_result === "string" ? item.ocr_result : JSON.stringify(item.ocr_result);
        if (ocrStr) all += (all ? "\n" : "") + ocrStr;
      }
      const cList = item && item.content;
      if (Array.isArray(cList)) {
        for (const c of cList) {
          const t = safeStr(
            c && (c.text || c.output_text || c.content || c.value)
          ).trim();
          if (t) all += (all ? "\n" : "") + t;
        }
      }
      const msg = item && item.message;
      const msgText = msg ? safeStr(msg.content).trim() : "";
      if (msgText) all += (all ? "\n" : "") + msgText;
      if (item && item.type === "message" && typeof item.text === "string" && item.text.trim()) {
        all += (all ? "\n" : "") + item.text.trim();
      }
    }
    if (all.trim()) return all.trim();
  }
  return pickFirst(
    data && data.output_text,
    data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content,
    rawText
  );
}

function looksLikePlaceholderRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") return true;
  const badPatterns = [/请补充/, /待补充/, /自行补充/, /食材（请补充）/, /调料（请补充）/];
  const hasBad = (s) => {
    const t = safeStr(s);
    return badPatterns.some((re) => re.test(t));
  };
  const ing = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const prep = Array.isArray(recipe.prepareSteps) ? recipe.prepareSteps : [];
  const cook = Array.isArray(recipe.cookingSteps) ? recipe.cookingSteps : [];
  if (!ing.length || !prep.length || !cook.length) return true;
  const ingBad = ing.some((x) => hasBad(x && x.name));
  const prepBad = prep.some((x) => hasBad(x));
  const cookBad = cook.some((x) => hasBad(x));
  return ingBad || prepBad || cookBad;
}

/** 归一化结果中是否含有真实识别出的内容（哪怕只有一部分），用于决定保留还是整体回退 */
function hasAnyRecognizedContent(recipe) {
  if (!recipe || typeof recipe !== "object") return false;
  const isPlaceholder = (s) => /请补充|待补充|自行补充/.test(safeStr(s));
  const texts = []
    .concat(Array.isArray(recipe.ingredients) ? recipe.ingredients.map((x) => x && x.name) : [])
    .concat(Array.isArray(recipe.seasonings) ? recipe.seasonings.map((x) => x && x.name) : [])
    .concat(Array.isArray(recipe.prepareSteps) ? recipe.prepareSteps : [])
    .concat(Array.isArray(recipe.cookingSteps) ? recipe.cookingSteps : []);
  return texts.some((s) => safeStr(s).trim() && !isPlaceholder(s));
}

async function qwenOcrPlainTextFromImages(recipeName, images) {
  const { apiKey, baseUrl, model } = getBailianConfig("vision");
  if (!apiKey) {
    const e = new Error("未配置百炼 API Key（请在云函数环境变量设置 DASHSCOPE_API_KEY）");
    e.code = "NO_API_KEY";
    throw e;
  }
  const useImages = pickImagesForApi(images);
  if (!useImages.length) throw new Error("图片数据无效");

  const n = useImages.length;
  const total = (images || []).length;
  const prompt = [
    `菜名：${safeStr(recipeName).trim()}`,
    `共 ${n} 张菜谱截图${total > n ? `（已省略 ${total - n} 张以加速）` : ""}。`,
    "请逐字识别图中与菜谱相关的全部文字（食材、调料、用量、备菜步骤、做菜步骤），按阅读顺序合并输出。",
    "只做忠实转录：图中没有的文字一律不要补充，不要根据菜名或常识编造任何内容。",
    "与菜谱无关的文字（广告、评论、水印等）不要输出。",
    "只输出纯文本，不要 JSON，不要 markdown，不要解释。",
  ].join("\n");

  const { text } = await callResponsesApi({
    apiKey,
    baseUrl,
    model,
    input: [{ role: "user", content: buildVisionContent(prompt, useImages) }],
    scene: "ocrPlainText",
    timeoutMs: 45000,
  });
  logModelOutput("ocrPlainText", model, text, null);
  if (!safeStr(text).trim() || text.length < 8) {
    throw new Error("未能从图片识别到有效文字");
  }
  return text.trim();
}

/**
 * @param {string} recipeName
 * @param {{ imageBase64: string, mimeType: string }[]} images 至少 1 张
 */
async function qwenExtractRecipeFromImages(recipeName, images) {
  const { apiKey, baseUrl, model } = getBailianConfig("vision");
  if (!apiKey) {
    const e = new Error("未配置百炼 API Key（请在云函数环境变量设置 DASHSCOPE_API_KEY）");
    e.code = "NO_API_KEY";
    throw e;
  }
  if (!Array.isArray(images) || images.length === 0) throw new Error("缺少图片数据");

  const useImages = pickImagesForApi(images);
  if (!useImages.length) throw new Error("图片数据无效");

  const n = useImages.length;
  const truncated = n < images.length;
  const prompt = [
    "你是「饭桶宝」菜谱结构化提取器。任务：从图片中识别菜谱信息并输出为严格 JSON。",
    `菜名：${safeStr(recipeName).trim()}`,
    `图片数量：${n} 张（按用户选择顺序）${truncated ? `；共 ${images.length} 张，本次仅分析前 ${n} 张` : ""}`,
    "",
    "请综合所有图片中的文字与画面，提取并去重合并：食材、调料及用量、备菜步骤、做菜步骤。",
    `若图片中包含多道菜的教程，只提取与菜名「${safeStr(recipeName).trim()}」最相关的那一道菜；其他菜品的内容一律忽略，禁止混合多道菜的信息。`,
    "只提取图片中真实存在的信息，禁止根据菜名或常识编造图中没有的食材、调料、用量或步骤；图中没有的类别对应字段输出空数组 []。",
    "",
    buildSourceFidelityRules(),
    "",
    buildIngredientSeasoningRules(),
    "",
    buildStrictJsonOutputRules(false),
  ].join("\n");

  const { text } = await callResponsesApi({
    apiKey,
    baseUrl,
    model,
    input: [{ role: "user", content: buildVisionContent(prompt, useImages) }],
    scene: "extractRecipeFromImage",
    timeoutMs: 55000,
  });

  const parsed = parseRecipeJsonFromModelText("extractRecipeFromImage", model, text);
  if (!parsed) {
    const e = new Error("大模型返回内容无法解析为 JSON");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = text.slice(0, 1200);
    e.visionText = text;
    throw e;
  }
  return { parsed: coerceModelRecipeShape(parsed), rawText: text };
}

/**
 * 视频理解：将视频流地址直接交给支持视频输入的 VL 模型提取菜谱。
 * 仅在配置 QWEN_VIDEO_MODEL 后启用；模型自行拉取视频，注意 60s 函数超时。
 * 注意：走 OpenAI 兼容的 /chat/completions + video_url（百炼官方文档的视频入参形式），
 * /responses 的 input_video 无官方支持，勿回退。
 * @param {string} recipeName
 * @param {string} videoUrl mp4 流地址
 * @param {{ title?: string, desc?: string }} note 笔记标题/文案，作为辅助上下文
 */
async function qwenExtractRecipeFromVideo(recipeName, videoUrl, note) {
  const { apiKey, baseUrl } = getBailianConfig("vision");
  const model = getVideoModel();
  if (!apiKey) {
    const e = new Error("未配置百炼 API Key（请在云函数环境变量设置 DASHSCOPE_API_KEY）");
    e.code = "NO_API_KEY";
    throw e;
  }
  if (!model) throw new Error("未配置视频理解模型（QWEN_VIDEO_MODEL）");

  const name = safeStr(recipeName).trim();
  const prompt = [
    "你是「饭桶宝」菜谱结构化提取器。任务：观看做菜视频，提取菜谱信息并输出为严格 JSON。",
    `菜名：${name}`,
    note && note.title ? `视频标题：${safeStr(note.title).slice(0, 100)}` : "",
    note && note.desc ? `视频文案：${safeStr(note.desc).slice(0, 500)}` : "",
    "",
    "请综合视频画面、内嵌字幕与口播，提取：食材、调料及用量、备菜步骤、做菜步骤。",
    `若视频中包含多道菜，只提取与菜名「${name}」最相关的一道；其他菜品的内容一律忽略，禁止混合。`,
    "只提取视频中真实呈现的信息，禁止根据菜名或常识编造；确实无法确认的类别输出空数组 []。",
    "",
    buildIngredientSeasoningRules(),
    "",
    buildStrictJsonOutputRules(false),
  ].join("\n");

  // 视频流地址统一升级为 https（百炼服务端拉取更稳），fps=1 控制抽帧成本
  const httpsVideoUrl = safeStr(videoUrl).replace(/^http:\/\//i, "https://");
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const resp = await httpsJson({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model,
      enable_thinking: false,
      messages: [
        {
          role: "user",
          content: [
            { type: "video_url", video_url: { url: httpsVideoUrl }, fps: 1 },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    timeoutMs: 55000,
  });
  const text = extractTextFromChatCompletion(resp && resp.data);
  if (!text) {
    const e = new Error("视频理解模型返回为空");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = safeStr(resp && resp.raw).slice(0, 1200);
    throw e;
  }

  const parsed = parseRecipeJsonFromModelText("extractRecipeFromVideo", model, text);
  if (!parsed) {
    const e = new Error("大模型返回内容无法解析为 JSON");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = text.slice(0, 1200);
    throw e;
  }
  return coerceModelRecipeShape(parsed);
}

/** 从 OpenAI 兼容 chat/completions 响应中取文本（content 可能是字符串或分段数组） */
function extractTextFromChatCompletion(data) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => safeStr(p && (p.text || p.content)))
      .filter(Boolean)
      .join("");
  }
  return "";
}

/**
 * 仅基于菜名生成常见家常菜谱（结构化 JSON）
 * @param {string} recipeName
 */
async function qwenGenerateCommonRecipeByName(recipeName, opts = {}) {
  const { apiKey, baseUrl, model } = getBailianConfig("text");
  if (!apiKey) {
    const e = new Error("未配置百炼 API Key（请在云函数环境变量设置 DASHSCOPE_API_KEY）");
    e.code = "NO_API_KEY";
    throw e;
  }

  const name = safeStr(recipeName).trim();
  if (!name) throw new Error("缺少 recipeName");

  const url = `${baseUrl.replace(/\/+$/, "")}/responses`;
  const hard = !!opts.hard;
  const prompt = [
    "你是「饭桶宝」菜谱结构化提取器。任务：根据菜名生成常见、可执行的家庭菜谱，并输出为严格 JSON。",
    `菜名：${name}`,
    "",
    buildIngredientSeasoningRules(),
    "",
    buildStrictJsonOutputRules(hard),
  ].join("\n");

  const body = buildResponsesBody(model, [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt,
        },
      ],
    },
  ]);

  const resp = await httpsJson({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    timeoutMs: 60000,
  });

  const data = resp && resp.data ? resp.data : null;
  const text = extractTextFromResponseData(data, safeStr(resp && resp.raw)) || "";

  const parsed = parseRecipeJsonFromModelText("generateCommonRecipe", model, text);
  if (!parsed) {
    const e = new Error("大模型返回内容无法解析为 JSON");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = text || safeStr(resp && resp.raw);
    throw e;
  }
  return parsed;
}

/**
 * 根据用户粘贴的做法/笔记正文提炼结构化菜谱（纯文本，非链接抓取）
 * @param {string} recipeName
 * @param {string} pastedText
 */
async function qwenExtractRecipeFromPastedText(recipeName, pastedText, opts = {}) {
  const { apiKey, baseUrl, model: cfgModel } = getBailianConfig("text");
  const model = (opts && opts.model) || cfgModel;
  const logScene = (opts && opts.scene) || "extractRecipeFromText";
  if (!apiKey) {
    const e = new Error("未配置百炼 API Key（请在云函数环境变量设置 DASHSCOPE_API_KEY）");
    e.code = "NO_API_KEY";
    throw e;
  }

  const name = safeStr(recipeName).trim();
  const raw = safeStr(pastedText).trim();
  if (!name) throw new Error("缺少 recipeName");
  if (!raw) throw new Error("缺少粘贴文案");
  if (raw.length > 12000) throw new Error("文案过长，请删减后再试");

  const url = `${baseUrl.replace(/\/+$/, "")}/responses`;
  // 来源忠实提取：只允许整理原文已有的信息，禁止结合菜名补全（图片 OCR 与粘贴文案统一行为）
  const prompt = [
    "你是「饭桶宝」菜谱结构化提取器。任务：从用户提供的文字中提取菜谱信息，并输出为严格 JSON。",
    `用户填写的菜名：${name}`,
    "",
    "【用户提供的文字】",
    "----",
    raw,
    "----",
    "",
    "请从上述文字提取：食材、调料及用量、备菜步骤、做菜步骤。只允许整理原文已有的信息，禁止结合菜名补全任何原文没有的内容。",
    "",
    "【多菜聚焦规则】",
    `若文字中包含多道菜的教程（一篇教多个菜），只提取与菜名「${name}」最相关的那一道菜的食材、调料和步骤；其他菜品的内容一律忽略，禁止把多道菜的信息混合在一起。`,
    `菜名与原文表述可能略有差异（如用户写「鹿茸菇」原文写「香辣鹿茸菇」），按最相关的一道判断即可；若原文没有任何与菜名相关的菜品，对应字段输出空数组 []。`,
    "",
    buildSourceFidelityRules(),
    "",
    buildIngredientSeasoningRules(),
    "",
    buildStrictJsonOutputRules(false),
  ].join("\n");

  const body = buildResponsesBody(model, [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt,
        },
      ],
    },
  ]);

  const resp = await httpsJson({
    url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    timeoutMs: 60000,
  });

  const data = resp && resp.data ? resp.data : null;
  const text = extractTextFromResponseData(data, safeStr(resp && resp.raw)) || "";

  const parsed = parseRecipeJsonFromModelText(logScene, model, text);
  if (!parsed) {
    const e = new Error("大模型返回内容无法解析为 JSON");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = text || safeStr(resp && resp.raw);
    throw e;
  }
  return parsed;
}

exports.main = async (event) => {
  try {
    if (!event || !event.type) throw new Error("缺少 type");

    const ctx = cloud.getWXContext();
    const openid = getOpenidOrThrow(ctx);

    switch (event.type) {
    case "generateCommonRecipe": {
      const { recipeName, familyId } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      // 限流 count 与家庭成员校验互不依赖，并行执行
      await Promise.all([
        assertAiRateLimit(openid),
        familyId ? assertFamilyMember({ openid, familyId }) : Promise.resolve(),
      ]);
      try {
        let modelOut = await qwenGenerateCommonRecipeByName(recipeName, { hard: false });
        let normalized = normalizeRecipeOut(modelOut, recipeName);
        // 若模型首轮给出占位内容，自动再试一轮
        if (looksLikePlaceholderRecipe(normalized)) {
          modelOut = await qwenGenerateCommonRecipeByName(recipeName, { hard: true });
          normalized = normalizeRecipeOut(modelOut, recipeName);
        }
        if (looksLikePlaceholderRecipe(normalized)) {
          const e = new Error("模型返回占位内容");
          e.code = "PLACEHOLDER_OUTPUT";
          e.raw = safeStr(modelOut && JSON.stringify(modelOut)).slice(0, 800);
          throw e;
        }
        return {
          mock: false,
          source: "name->qwen",
          tip: "已根据菜名生成常用菜谱，可继续编辑",
          usedModel: getTextModel(),
          ...normalized,
        };
      } catch (e) {
        const errRaw = safeStr(e && (e.message || e.errMsg));
        const parsed = genGenericRecipeByName(recipeName);
        return {
          mock: true,
          source: "name->common-template-fallback",
          tip: formatBailianUserTip(
            errRaw,
            errRaw === "模型返回占位内容"
              ? "生成结果无效：请确认已部署最新 aiFunctions，并查看日志 text model 是否为 qwen3.7-plus"
              : "模型生成失败，已回退到常用模板，可继续编辑"
          ),
          error: errRaw,
          usedModel: getTextModel(),
          debugRaw: safeStr(e && e.raw).slice(0, 1200),
          ...parsed,
        };
      }
    }

    /**
     * 小红书链接提炼：正式版前端已下线，保留分支便于后续接入合规解析。
     * 仍返回通用骨架，避免旧客户端报错。
     */
    case "extractRecipe": {
      const { xiaohongshuUrl, recipeName } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      if (!xiaohongshuUrl) throw new Error("缺少 xiaohongshuUrl");
      if (!isValidXhsUrl(xiaohongshuUrl)) {
        throw new Error("链接无效，请检查是否为小红书链接");
      }

      const parsed = genGenericRecipeByName(recipeName);
      return {
        mock: true,
        source: "compliance-fallback",
        tip: "当前未接入合规解析接口，已为你生成通用菜谱，可自行修改",
        ...parsed,
      };
    }

    /**
     * 小红书分享链接识别：短链还原 → 分享页 SSR 解析出文案/图集，
     * 文案优先走文本提炼，不够再走图集 OCR；失败降级为空白模板。
     * 该路径依赖小红书页面结构，属于脆弱能力，失败一律兜底不报错给用户。
     */
    case "extractRecipeFromLink": {
      const { shareText, recipeName, familyId } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      const rawShare = safeStr(shareText).trim();
      if (!rawShare) throw new Error("缺少 shareText");
      await Promise.all([
        assertAiRateLimit(openid),
        familyId ? assertFamilyMember({ openid, familyId }) : Promise.resolve(),
      ]);

      const name = safeStr(recipeName).trim();
      const failWithTemplate = (errRaw, tip) => ({
        mock: true,
        source: "xhs->parse-fallback",
        tip: tip || "链接解析失败，请改用「多图识别」截图导入或「文字识别」粘贴文案",
        error: safeStr(errRaw),
        ...genGenericRecipeByName(name),
      });

      let note = null;
      try {
        note = await xhsParser.fetchNoteFromShareText(rawShare);
        console.log(
          `[aiFunctions][xhs] noteId=${note.noteId} type=${note.type} ` +
            `title=${note.title.slice(0, 30)} descLen=${note.desc.length} images=${note.images.length} ` +
            `subtitle=${note.subtitleUrl ? "yes" : "no"} videoUrl=${note.videoUrl ? "yes" : "no"} duration=${note.videoDuration || 0}s`
        );
      } catch (e) {
        const code = e && e.code;
        // 这些错误信息本身即为用户可读提示，直接透出
        const passThrough = code === "NO_LINK" || code === "LINK_EXPIRED" || code === "LOGIN_REQUIRED";
        return failWithTemplate(e && e.message, passThrough ? safeStr(e && e.message) : undefined);
      }

      // 各来源按笔记类型排优先级，取第一个能产出有效内容的结果：
      // 视频笔记：口播字幕 → 文案 → 视频理解模型；图文笔记：文案 → 图集 OCR
      let normalized = null;
      let source = "";
      const stageErrors = [];
      let subtitleAiAttempted = false;
      const tryStage = async (src, fn) => {
        if (normalized) return;
        try {
          const out = await fn();
          if (!out) {
            stageErrors.push(`${src}:无产出`);
            return;
          }
          const n = normalizeRecipeOut(out, name);
          if (hasAnyRecognizedContent(n)) {
            normalized = n;
            source = src;
          } else {
            stageErrors.push(`${src}:未提取到有效菜谱内容`);
          }
        } catch (e) {
          stageErrors.push(`${src}:${safeStr(e && e.message).slice(0, 150)}`);
          console.warn(`[aiFunctions][xhs] ${src} failed:`, safeStr(e && e.message));
        }
      };

      const textBody = [note.title ? `笔记标题：${note.title}` : "", note.desc]
        .filter(Boolean)
        .join("\n")
        .trim()
        .slice(0, 10000);
      const runTextStage = () =>
        textBody.length >= 20
          ? qwenExtractRecipeFromPastedText(name, textBody, { scene: "extractRecipeFromLinkText" })
          : Promise.resolve(null);
      const runImageStage = async () => {
        if (!note.images.length) return null;
        const images = await downloadImagesFromUrls(note.images, IMAGE_AI_MAX_COUNT);
        const ocrText = await qwenOcrPlainTextFromImages(name, images);
        return qwenExtractRecipeFromPastedText(name, ocrText.slice(0, 10000), {
          model: getOcrStructureTextModel(),
          scene: "extractRecipeFromLinkImage",
        });
      };
      const runSubtitleStage = async () => {
        if (!note.subtitleUrl) return null;
        const srt = await xhsParser.downloadTextFile(note.subtitleUrl);
        const transcript = xhsParser.srtToText(srt);
        if (transcript.length < 20) return null;
        // 字幕正文已包含标题+文案，调过 AI 后纯文案环节即为冗余（见下方跳过逻辑）
        subtitleAiAttempted = true;
        const body = [
          note.title ? `笔记标题：${note.title}` : "",
          note.desc,
          "【视频口播字幕】",
          transcript,
        ]
          .filter(Boolean)
          .join("\n")
          .trim()
          .slice(0, 10000);
        return qwenExtractRecipeFromPastedText(name, body, {
          scene: "extractRecipeFromLinkSubtitle",
        });
      };
      const runVideoModelStage = () => {
        // 超长视频跳过，控制成本与 60s 超时风险
        if (!note.videoUrl || !getVideoModel()) {
          if (note.videoUrl && !getVideoModel()) {
            console.warn("[aiFunctions][xhs] 视频流可用但未配置 QWEN_VIDEO_MODEL，跳过视频理解环节");
          }
          return Promise.resolve(null);
        }
        if (note.videoDuration && note.videoDuration > 300) return Promise.resolve(null);
        console.log(
          `[aiFunctions][xhs] video stage: model=${getVideoModel()} duration=${note.videoDuration || 0}s`
        );
        return qwenExtractRecipeFromVideo(name, note.videoUrl, note);
      };

      if (note.type === "video") {
        await tryStage("xhs->subtitle", runSubtitleStage);
        // 字幕正文已含标题+文案且调过 AI：纯文案环节冗余，跳过以把 60s 预算留给视频理解
        if (!subtitleAiAttempted) await tryStage("xhs->text", runTextStage);
        await tryStage("xhs->video", runVideoModelStage);
      } else {
        await tryStage("xhs->text", runTextStage);
        await tryStage("xhs->images", runImageStage);
      }

      if (!normalized) {
        const tip =
          note.type === "video"
            ? "未能从视频中识别出菜谱内容，可截图画面用「多图识别」或粘贴文案"
            : "笔记中可提取的内容不足，请改用截图识别或粘贴文案";
        const stageSummary = stageErrors.join(" | ") || "笔记可提取内容不足";
        console.warn(`[aiFunctions][xhs] all stages failed noteId=${note.noteId}: ${stageSummary}`);
        return failWithTemplate(stageSummary, tip);
      }
      const partial = looksLikePlaceholderRecipe(normalized);
      return {
        mock: false,
        source,
        noteTitle: note.title,
        tip: partial
          ? "部分内容无法从笔记中提取，已保留提取到的内容，请手动补充缺失项"
          : "已从小红书笔记提取，可继续编辑",
        ...normalized,
      };
    }

    /** 粘贴文案 + AI 提炼（推荐，替代小红书链接模式） */
    case "extractRecipeFromText": {
      const { recipeName, pastedText, familyId } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      // 限流 count 与家庭成员校验互不依赖，并行执行
      await Promise.all([
        assertAiRateLimit(openid),
        familyId ? assertFamilyMember({ openid, familyId }) : Promise.resolve(),
      ]);
      const t = safeStr(pastedText).trim();
      if (t.length < 8) throw new Error("请先粘贴足够长度的做法文案");
      try {
        const modelOut = await qwenExtractRecipeFromPastedText(recipeName, t);
        const normalized = normalizeRecipeOut(modelOut, recipeName);
        if (looksLikePlaceholderRecipe(normalized)) {
          // 部分内容可提取时保留真实结果，缺失部分留占位提示用户手动补充，不做编造
          if (hasAnyRecognizedContent(normalized)) {
            return {
              mock: false,
              source: "text->qwen",
              tip: "部分内容无法从文案中提取，已保留提取到的内容，请手动补充缺失项",
              ...normalized,
            };
          }
          throw new Error("文案中可提取的有效内容不足");
        }
        return {
          mock: false,
          source: "text->qwen",
          tip: "已根据粘贴内容提炼，可继续编辑",
          ...normalized,
        };
      } catch (e) {
        const code = e && e.code;
        if (code === "NO_API_KEY") {
          const parsed = genGenericRecipeByName(recipeName);
          return {
            mock: true,
            source: "text->no-api-key-fallback",
            tip: "未配置 AI 密钥，已生成空白模板，请手动填写",
            error: safeStr(e && e.message),
            ...parsed,
          };
        }
        const parsed = genGenericRecipeByName(recipeName);
        return {
          mock: true,
          source: "text->fallback",
          tip: "未能从文案中提取有效内容，已生成空白模板，请手动填写或重试",
          error: safeStr(e && (e.message || e.errMsg)),
          debugRaw: safeStr(e && e.raw).slice(0, 1200),
          ...parsed,
        };
      }
    }

    case "extractRecipeFromImage": {
      const { recipeName, imageFileId, imageFileIds, familyId } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      if (!familyId) throw new Error("缺少 familyId");

      const ids = [];
      if (Array.isArray(imageFileIds) && imageFileIds.length) {
        for (const id of imageFileIds) {
          const s = safeStr(id).trim();
          if (s) ids.push(s);
        }
      } else if (imageFileId) {
        ids.push(safeStr(imageFileId).trim());
      }
      if (ids.length === 0) throw new Error("缺少 imageFileId 或 imageFileIds");
      if (ids.length > IMAGE_AI_MAX_COUNT) {
        throw new Error(`最多支持 ${IMAGE_AI_MAX_COUNT} 张图片`);
      }

      // 限流 count 与图片归属/家庭成员校验互不依赖，并行执行
      await Promise.all([
        assertAiRateLimit(openid),
        assertImageFileIdsForFamily({ openid, familyId, fileIds: ids }),
      ]);

      const images = await downloadImagesFromFileIds(ids);
      const pipeline = getImagePipeline();
      const name = safeStr(recipeName).trim();
      let modelOut = null;
      let visionRawText = "";
      let source = "image->ocr+text";
      const usedVisionModel = getVisionModel();
      const usedTextModel =
        pipeline === "ocr_then_text" ? getOcrStructureTextModel() : getTextModel();

      if (pipeline === "ocr_then_text") {
        const t0 = Date.now();
        try {
          visionRawText = await qwenOcrPlainTextFromImages(name, images);
          console.log("[aiFunctions] ocrPlainText done ms:", Date.now() - t0, "len:", visionRawText.length);
          const t1 = Date.now();
          modelOut = await qwenExtractRecipeFromPastedText(name, visionRawText.slice(0, 10000), {
            model: usedTextModel,
            scene: "extractRecipeFromImageText",
          });
          console.log("[aiFunctions] structureText done ms:", Date.now() - t1);
        } catch (e) {
          const code = e && e.code;
          if (code === "NO_API_KEY") {
            throw new Error("未配置 DASHSCOPE_API_KEY，请在云函数环境变量中设置");
          }
          const errRaw = safeStr(e && (e.message || e.errMsg));
          const fallback = genGenericRecipeByName(recipeName);
          return {
            mock: true,
            source: "image->ocr-fallback",
            tip: formatBailianUserTip(errRaw, "图片识别失败，已生成空白模板，请手动填写或重试"),
            error: errRaw,
            pipeline,
            imageCount: ids.length,
            usedVisionModel,
            usedTextModel,
            ...fallback,
          };
        }
      } else {
        try {
          const vision = await qwenExtractRecipeFromImages(name, images);
          modelOut = vision.parsed;
          visionRawText = vision.rawText || "";
          source = "image->qwen";
        } catch (e) {
          const code = e && e.code;
          if (code === "NO_API_KEY") {
            throw new Error("未配置 DASHSCOPE_API_KEY，请在云函数环境变量中设置");
          }
          if (code === "BAD_MODEL_OUTPUT" && e.visionText && e.visionText.length > 80) {
            visionRawText = e.visionText;
            try {
              modelOut = await qwenExtractRecipeFromPastedText(name, visionRawText.slice(0, 10000), {
                model: getOcrStructureTextModel(),
                scene: "extractRecipeFromImageText",
              });
              source = "image->ocr+text";
            } catch (e2) {
              const errRaw = safeStr(e2 && (e2.message || e2.errMsg));
              const fallback = genGenericRecipeByName(recipeName);
              return {
                mock: true,
                source: "image->qwen-fallback",
                tip: formatBailianUserTip(errRaw, "图片识别失败，已生成空白模板，请手动填写或重试"),
                error: errRaw,
                pipeline,
                imageCount: ids.length,
                ...fallback,
              };
            }
          } else {
            const errRaw = safeStr(e && (e.message || e.errMsg));
            const fallback = genGenericRecipeByName(recipeName);
            return {
              mock: true,
              source: "image->qwen-fallback",
              tip: formatBailianUserTip(errRaw, "图片识别失败，已生成空白模板，请手动填写或重试"),
              error: errRaw,
              pipeline,
              imageCount: ids.length,
              ...fallback,
            };
          }
        }
      }

      let normalized = normalizeRecipeOut(modelOut, recipeName);

      if (looksLikePlaceholderRecipe(normalized) && visionRawText.length > 80 && pipeline === "vision_json") {
        try {
          modelOut = await qwenExtractRecipeFromPastedText(name, visionRawText.slice(0, 10000), {
            model: getOcrStructureTextModel(),
            scene: "extractRecipeFromImageText",
          });
          normalized = normalizeRecipeOut(modelOut, recipeName);
          source = "image->ocr+text";
        } catch (e) {
          console.warn("[aiFunctions] image->text fallback failed:", safeStr(e && e.message));
        }
      }

      if (looksLikePlaceholderRecipe(normalized)) {
        // 部分内容可识别时保留真实结果，缺失部分留占位提示用户手动补充，不做编造
        if (hasAnyRecognizedContent(normalized)) {
          return {
            mock: false,
            source,
            tip: "部分信息未能从图片识别，已保留识别到的内容，请手动补充缺失项",
            pipeline,
            imageCount: ids.length,
            usedVisionModel,
            usedTextModel,
            ...normalized,
          };
        }
        // 完全不可读/信息不足：只给空白模板和提示，不生成任何编造内容
        const fallback = genGenericRecipeByName(recipeName);
        return {
          mock: true,
          source: "image->placeholder-fallback",
          tip: "未能从图片识别出有效内容，请换更清晰的图片重试，或手动填写",
          error: "图片可识别内容不足",
          debugRaw: visionRawText.slice(0, 800),
          pipeline,
          imageCount: ids.length,
          usedVisionModel,
          usedTextModel,
          ...fallback,
        };
      }
      return {
        mock: false,
        source,
        tip: "已从图片识别并填充，可继续编辑",
        pipeline,
        imageCount: ids.length,
        usedVisionModel,
        usedTextModel,
        ...normalized,
      };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
    }
  } catch (e) {
    const msg = safeStr(e && e.message) || String(e);
    console.error("[aiFunctions]", event && event.type, msg);
    return { success: false, errMsg: msg };
  }
};
