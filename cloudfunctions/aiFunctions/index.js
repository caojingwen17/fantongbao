const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

function safeStr(v) {
  return v === undefined || v === null ? "" : String(v);
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
  try {
    return JSON.parse(s);
  } catch (e) {
    const m = s.match(/\{[\s\S]*\}/);
    if (m && m[0]) {
      try {
        return JSON.parse(m[0]);
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

function isValidXhsUrl(url) {
  const u = safeStr(url).trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    const host = (parsed.hostname || "").toLowerCase();
    return host.includes("xiaohongshu.com") || host.includes("xhslink.com");
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

function getBailianConfig() {
  const apiKey = safeStr(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY).trim();
  const baseUrl =
    safeStr(process.env.BAILIAN_BASE_URL).trim() || "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1";
  const model = safeStr(process.env.QWEN_VISION_MODEL).trim() || "qwen3.5-plus";
  return { apiKey, baseUrl, model };
}

function normalizeRecipeOut(obj, fallbackName) {
  const base = genGenericRecipeByName(fallbackName);
  if (!obj || typeof obj !== "object") return base;
  const recipeName = safeStr(obj.recipeName || obj.name || fallbackName).trim() || fallbackName;
  const ingredients = Array.isArray(obj.ingredients) ? obj.ingredients : base.ingredients;
  const seasonings = Array.isArray(obj.seasonings) ? obj.seasonings : base.seasonings;
  const prepareSteps = Array.isArray(obj.prepareSteps) ? obj.prepareSteps : base.prepareSteps;
  const cookingSteps = Array.isArray(obj.cookingSteps) ? obj.cookingSteps : base.cookingSteps;

  const cleanedIngredients = ingredients
    .map((x) => (x && typeof x === "object" ? { name: safeStr(x.name).trim(), amount: safeStr(x.amount).trim() } : null))
    .filter((x) => x && x.name);
  const cleanedSeasonings = seasonings
    .map((x) => (x && typeof x === "object" ? { name: safeStr(x.name).trim(), amount: safeStr(x.amount).trim() } : null))
    .filter((x) => x && x.name);
  const cleanedPrepareSteps = prepareSteps.map((s) => safeStr(s).trim()).filter((s) => s);
  const cleanedCookingSteps = cookingSteps.map((s) => safeStr(s).trim()).filter((s) => s);

  const seasoningRe = /(盐|糖|酱油|生抽|老抽|蚝油|料酒|醋|胡椒|花椒|孜然|豆瓣|豆豉|辣椒粉|淀粉|鸡精|味精|芝麻油|香油|番茄酱|沙拉酱|咖喱)/i;
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

  // 先放模型的调料
  cleanedSeasonings.forEach((x) => {
    const key = norm(x.name);
    if (!key || seenSea[key]) return;
    seenSea[key] = true;
    finalSeasonings.push(x);
  });

  // 对模型的食材做纠偏：像调料的项移到调料列表
  cleanedIngredients.forEach((x) => {
    const key = norm(x.name);
    if (!key) return;
    if (seasoningRe.test(x.name)) {
      if (!seenSea[key]) {
        seenSea[key] = true;
        finalSeasonings.push(x);
      }
      return;
    }
    if (seenIng[key]) return;
    seenIng[key] = true;
    finalIngredients.push(x);
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
  const out = (data && data.output) || [];
  if (Array.isArray(out)) {
    let all = "";
    for (const item of out) {
      const cList = item && item.content;
      if (Array.isArray(cList)) {
        for (const c of cList) {
          const t = safeStr(c && (c.text || c.content || c.value)).trim();
          if (t) all += (all ? "\n" : "") + t;
        }
      }
      const msg = item && item.message;
      const msgText = msg ? safeStr(msg.content).trim() : "";
      if (msgText) all += (all ? "\n" : "") + msgText;
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
  const badWords = ["请补充", "待补充", "自行补充", "示例", "模板"];
  const hasBad = (s) => {
    const t = safeStr(s);
    return badWords.some((w) => t.includes(w));
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

/**
 * @param {string} recipeName
 * @param {{ imageBase64: string, mimeType: string }[]} images 至少 1 张
 */
async function qwenExtractRecipeFromImages(recipeName, images) {
  const { apiKey, baseUrl, model } = getBailianConfig();
  if (!apiKey) {
    const e = new Error("未配置百炼 API Key（请在云函数环境变量设置 DASHSCOPE_API_KEY）");
    e.code = "NO_API_KEY";
    throw e;
  }
  if (!Array.isArray(images) || images.length === 0) throw new Error("缺少图片数据");

  const url = `${baseUrl.replace(/\/+$/, "")}/responses`;
  const n = images.length;
  const prompt = [
    "你是一个“菜谱结构化提取器”。",
    `我会给你：菜名 + ${n} 张菜谱/做法截图（可能来自小红书保存的图片，按选择顺序排列）。`,
    "请综合所有图片中的文字与画面信息，识别并提取：食材、调料及用量、备菜步骤、做菜步骤；若多张图信息有重复，去重合并；若某张图只有部分信息，与其他图互补。",
    "【关键分类规则】必须严格区分 ingredients（食材）和 seasonings（调料）：",
    "1) ingredients 仅放“主料/配菜/可见实物食材”，如：猪肉、牛肉、鸡蛋、番茄、土豆、豆芽、青菜、葱姜蒜（作为配菜时）。",
    "2) seasonings 仅放“调味/腌制/上色/增香配料”，如：盐、糖、生抽、老抽、酱油、蚝油、料酒、醋、胡椒粉、花椒、辣椒粉、豆瓣酱、淀粉、鸡精、味精、芝麻油、白芝麻。",
    "3) 若同一项可能有歧义，优先按“是否主要用于调味”判断：用于调味则放 seasonings，否则放 ingredients。",
    "4) 禁止把明显调料放进 ingredients（例如盐/生抽/料酒/醋/淀粉等）。",
    "5) 结果中同名项只能出现一次，不要在 ingredients 和 seasonings 两边重复出现。",
    "若整体信息仍不足，也请基于菜名生成常见、可操作的通用菜谱补全。",
    "只输出 JSON，不要输出任何多余文字。JSON 格式如下：",
    '{ "recipeName": string, "ingredients":[{"name":string,"amount":string}], "seasonings":[{"name":string,"amount":string}], "prepareSteps":[string], "cookingSteps":[string] }',
    "要求：ingredients/prepareSteps/cookingSteps 至少各 1 条；amount 可为空字符串；每个字段内容必须具体，不要输出“请补充”。",
  ].join("\n");

  const content = [
    {
      type: "input_text",
      text: `菜名：${safeStr(recipeName).trim()}\n\n${prompt}`,
    },
  ];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const mime = safeStr(img.mimeType || "image/png").trim() || "image/png";
    content.push({
      type: "input_image",
      image_url: `data:${mime};base64,${img.imageBase64}`,
    });
  }

  const body = {
    model,
    input: [
      {
        role: "user",
        content,
      },
    ],
  };

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

  try {
    console.log("[bailian] images:", n, "textLen:", safeStr(text).length);
  } catch (e) {}

  const parsed = jsonParseLoose(text);
  if (!parsed) {
    const e = new Error("大模型返回内容无法解析为 JSON");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = text || safeStr(resp && resp.raw);
    throw e;
  }
  return parsed;
}

/**
 * 仅基于菜名生成常见家常菜谱（结构化 JSON）
 * @param {string} recipeName
 */
async function qwenGenerateCommonRecipeByName(recipeName, opts = {}) {
  const { apiKey, baseUrl, model } = getBailianConfig();
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
    "你是一个“菜谱结构化提取器”。",
    `我会给你菜名：${name}。`,
    "请生成中国家庭可执行、常见且稳定的做法，输出：食材、调料及用量、备菜步骤、做菜步骤。",
    "只输出 JSON，不要输出任何多余文字。JSON 格式如下：",
    '{ "recipeName": string, "ingredients":[{"name":string,"amount":string}], "seasonings":[{"name":string,"amount":string}], "prepareSteps":[string], "cookingSteps":[string] }',
    "要求：ingredients/prepareSteps/cookingSteps 至少各 1 条；amount 可为空字符串。",
    "若信息不足，也请基于菜名生成常见、可操作的通用菜谱补全。",
    hard
      ? "强约束：ingredients 至少 3 条、prepareSteps 至少 3 条、cookingSteps 至少 4 条；禁止出现“请补充/待补充/模板”等占位词，必须给出具体可执行内容。"
      : "输出应尽量具体可执行，避免空泛描述。",
  ].join("\n");

  const body = {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  };

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

  const parsed = jsonParseLoose(text);
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
async function qwenExtractRecipeFromPastedText(recipeName, pastedText) {
  const { apiKey, baseUrl, model } = getBailianConfig();
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
  const prompt = [
    "你是一个“菜谱结构化提取器”。",
    `用户已填写菜名：${name}`,
    "用户从外部复制了以下文字（可能来自笔记、网页、聊天等，仅作内容参考，不涉及链接抓取）：",
    "----",
    raw,
    "----",
    "请从上述文字中提取或归纳：食材、调料及用量、备菜步骤、做菜步骤。若文字杂乱、信息不足，可结合菜名补全为可执行的家常做法。",
    "【关键分类规则】必须严格区分 ingredients（食材）和 seasonings（调料）：",
    "1) ingredients 仅放主料/配菜等实物食材；2) seasonings 放盐糖酱油等调味品；",
    "3) 禁止把明显调料放进 ingredients；4) 同名项不要重复出现在两边。",
    "只输出 JSON，不要输出任何多余文字。JSON 格式如下：",
    '{ "recipeName": string, "ingredients":[{"name":string,"amount":string}], "seasonings":[{"name":string,"amount":string}], "prepareSteps":[string], "cookingSteps":[string] }',
    "要求：ingredients/prepareSteps/cookingSteps 至少各 1 条；amount 可为空字符串；不要输出“请补充/待补充”等占位词。",
  ].join("\n");

  const body = {
    model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  };

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

  const parsed = jsonParseLoose(text);
  if (!parsed) {
    const e = new Error("大模型返回内容无法解析为 JSON");
    e.code = "BAD_MODEL_OUTPUT";
    e.raw = text || safeStr(resp && resp.raw);
    throw e;
  }
  return parsed;
}

exports.main = async (event) => {
  if (!event || !event.type) throw new Error("缺少 type");

  switch (event.type) {
    case "generateCommonRecipe": {
      const { recipeName } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      try {
        let modelOut = await qwenGenerateCommonRecipeByName(recipeName, { hard: false });
        let normalized = normalizeRecipeOut(modelOut, recipeName);
        // 若模型首轮给出占位内容，自动再试一轮
        if (looksLikePlaceholderRecipe(normalized)) {
          modelOut = await qwenGenerateCommonRecipeByName(recipeName, { hard: true });
          normalized = normalizeRecipeOut(modelOut, recipeName);
        }
        if (looksLikePlaceholderRecipe(normalized)) {
          throw new Error("模型返回占位内容");
        }
        return {
          mock: false,
          source: "name->qwen",
          tip: "已根据菜名生成常用菜谱，可继续编辑",
          ...normalized,
        };
      } catch (e) {
        const parsed = genGenericRecipeByName(recipeName);
        return {
          mock: true,
          source: "name->common-template-fallback",
          tip: "模型生成失败，已回退到常用模板，可继续编辑",
          error: safeStr(e && (e.message || e.errMsg)),
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

    /** 粘贴文案 + AI 提炼（推荐，替代小红书链接模式） */
    case "extractRecipeFromText": {
      const { recipeName, pastedText } = event;
      if (!recipeName) throw new Error("缺少 recipeName");
      const t = safeStr(pastedText).trim();
      if (t.length < 8) throw new Error("请先粘贴足够长度的做法文案");
      try {
        const modelOut = await qwenExtractRecipeFromPastedText(recipeName, t);
        const normalized = normalizeRecipeOut(modelOut, recipeName);
        if (looksLikePlaceholderRecipe(normalized)) {
          throw new Error("模型返回占位内容");
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
            tip: "未配置 AI 密钥，已生成通用菜谱模板，可继续编辑",
            error: safeStr(e && e.message),
            ...parsed,
          };
        }
        const parsed = genGenericRecipeByName(recipeName);
        return {
          mock: true,
          source: "text->fallback",
          tip: "提炼未完全成功，已为你生成通用菜谱，可自行修改",
          error: safeStr(e && (e.message || e.errMsg)),
          debugRaw: safeStr(e && e.raw).slice(0, 1200),
          ...parsed,
        };
      }
    }

    case "extractRecipeFromImage": {
      const { recipeName, imageFileId, imageFileIds } = event;
      if (!recipeName) throw new Error("缺少 recipeName");

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
      if (ids.length > 9) throw new Error("最多支持 9 张图片");

      const images = [];
      for (const fileID of ids) {
        const dl = await cloud.downloadFile({ fileID });
        const buf = dl && dl.fileContent ? dl.fileContent : null;
        if (!buf) throw new Error(`图片下载失败：${fileID}`);
        images.push({
          imageBase64: Buffer.from(buf).toString("base64"),
          mimeType: "image/png",
        });
      }

      let modelOut = null;
      try {
        modelOut = await qwenExtractRecipeFromImages(safeStr(recipeName).trim(), images);
      } catch (e) {
        const fallback = genGenericRecipeByName(recipeName);
        return {
          mock: true,
          source: "image->qwen-fallback",
          tip: "图片识别失败，已为你生成通用菜谱，可自行修改",
          error: safeStr(e && (e.message || e.errMsg)),
          debugRaw: safeStr(e && e.raw).slice(0, 1200),
          imageCount: ids.length,
          ...fallback,
        };
      }

      const normalized = normalizeRecipeOut(modelOut, recipeName);
      return {
        mock: false,
        source: "image->qwen",
        imageCount: ids.length,
        ...normalized,
      };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};
