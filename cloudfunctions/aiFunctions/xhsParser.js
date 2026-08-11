/**
 * 小红书分享链接解析：短链还原 → 带 xsec_token 抓取分享页 → 解析 __INITIAL_STATE__。
 * 不依赖 wx-server-sdk，可独立本地测试。
 *
 * 注意：该路径依赖小红书分享页的 SSR 数据结构，属于灰色能力；
 * 页面结构或风控策略变化会导致失效，调用方必须做好降级。
 */
const https = require("https");

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

function safeStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

function pageHeaders() {
  return {
    "User-Agent": MOBILE_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
}

/**
 * 从分享口令/文本中提取小红书链接。
 * 兼容两种形态：完整 http(s):// 链接、新口令里去掉协议头的 xhslink.com/xxx。
 */
function extractXhsUrl(text) {
  const s = safeStr(text);
  const m = s.match(
    /(?:https?:\/\/)?(?:www\.)?(?:xhslink\.(?:com|cn)|xiaohongshu\.com)\/[A-Za-z0-9\/?&=._~%+-]*/i
  );
  if (!m) return "";
  let u = m[0];
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

/** 从落地页 URL 中提取 noteId（/explore/xxx、/discovery/item/xxx、/user/profile/uid/xxx） */
function extractNoteId(url) {
  const s = safeStr(url);
  const m =
    s.match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]{20,30})/i) ||
    s.match(/\/user\/profile\/[a-f0-9]{24}\/([a-zA-Z0-9]{20,30})/i);
  return m ? m[1] : "";
}

/**
 * GET 请求，手动跟随 3xx 重定向。
 * bodyOnly=false 时返回 { status, finalUrl, headers, body }；binary 时 body 为 Buffer。
 */
function httpsGet(url, { headers, timeoutMs = 15000, maxRedirects = 5, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(new Error(`URL 无效：${url}`));
      return;
    }
    const req = https.request(
      {
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: headers || pageHeaders(),
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers && res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (maxRedirects <= 0) {
            reject(new Error("重定向次数过多"));
            return;
          }
          const next = new URL(location, url).toString();
          resolve(httpsGet(next, { headers, timeoutMs, maxRedirects: maxRedirects - 1, binary }));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status,
            finalUrl: url,
            headers: res.headers || {},
            body: binary ? buf : buf.toString("utf8"),
          });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      try {
        req.destroy(new Error("请求超时"));
      } catch (e) {}
    });
    req.end();
  });
}

/**
 * 从 HTML 中解析 window.__INITIAL_STATE__。
 * 该值是 JS 对象字面量（含 undefined，非严格 JSON），先做括号配平截取再兼容处理后 JSON.parse。
 */
function parseInitialState(html) {
  const s = safeStr(html);
  const marker = "window.__INITIAL_STATE__";
  const idx = s.indexOf(marker);
  if (idx < 0) return null;
  const start = s.indexOf("{", idx);
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < s.length; j++) {
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
        const raw = s.slice(start, j + 1).replace(/:\s*undefined(\s*[,}])/g, ":null$1");
        try {
          return JSON.parse(raw);
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

/** 从图集条目里挑无水印原图地址（WB_DFT 为默认展示原图） */
function pickImageUrl(item) {
  if (!item || typeof item !== "object") return "";
  const infoList = Array.isArray(item.infoList) ? item.infoList : [];
  const preferred =
    infoList.find((x) => x && x.urlScene === "WB_DFT") ||
    infoList.find((x) => x && x.urlScene === "WB_PRV") ||
    infoList[0];
  return safeStr(
    (preferred && preferred.url) || item.urlDefault || item.urlPre || item.url || ""
  );
}

/** 从 __INITIAL_STATE__ 中提取笔记详情；结构变化时返回 null 由调用方降级 */
function extractNote(state, preferredNoteId) {
  if (!state || typeof state !== "object") return null;
  const detailMap = state.note && state.note.noteDetailMap;
  if (!detailMap || typeof detailMap !== "object") {
    return deepSearchNote(state, preferredNoteId);
  }

  let entry = (preferredNoteId && detailMap[preferredNoteId]) || null;
  if (!entry || !entry.note) {
    entry = Object.values(detailMap).find((v) => v && v.note) || null;
  }
  const note = entry && entry.note;
  if (!note || typeof note !== "object") return deepSearchNote(state, preferredNoteId);
  return normalizeNote(note, preferredNoteId);
}

/** 从 note.video 解析视频信息：mediaV2（新结构，含字幕）与 media.stream（旧结构） */
function parseVideoInfo(note) {
  const out = { subtitleUrl: "", videoUrl: "", duration: 0 };
  const video = note && note.video;
  if (!video || typeof video !== "object") return out;

  // 新结构：video.mediaV2 是 JSON 字符串
  if (typeof video.mediaV2 === "string" && video.mediaV2) {
    try {
      const mv2 = JSON.parse(video.mediaV2);
      const subs = (mv2.video && mv2.video.subtitles) || {};
      // source 为原始语言字幕，zh-CN 为中文（可能为空数组）
      const zhSub =
        (Array.isArray(subs.source) && subs.source[0]) ||
        (Array.isArray(subs["zh-CN"]) && subs["zh-CN"][0]) ||
        null;
      if (zhSub && zhSub.url) out.subtitleUrl = safeStr(zhSub.url);
      if (mv2.video && typeof mv2.video.duration === "number") {
        out.duration = mv2.video.duration; // mediaV2.video.duration 单位为秒
      }
      const h264 = mv2.stream && Array.isArray(mv2.stream.h264) ? mv2.stream.h264 : [];
      const s0 = h264.find((s) => s && (s.master_url || (Array.isArray(s.backup_urls) && s.backup_urls[0])));
      if (s0) out.videoUrl = safeStr(s0.master_url || s0.backup_urls[0]);
    } catch (e) {
      /* ignore */
    }
  }

  // 旧结构兜底：video.media.stream.{h264,h265,...}[].masterUrl
  if (!out.videoUrl) {
    const stream = video.media && video.media.stream;
    if (stream && typeof stream === "object") {
      for (const k of Object.keys(stream)) {
        const list = Array.isArray(stream[k]) ? stream[k] : [];
        for (const s of list) {
          const u = safeStr(s && (s.masterUrl || s.master_url || s.videoKey));
          if (u && /^https?:\/\//.test(u)) {
            out.videoUrl = u;
            break;
          }
        }
        if (out.videoUrl) break;
      }
    }
  }
  return out;
}

/** SRT 字幕 → 纯文本（去序号、时间轴，合并成行） */
function srtToText(srt) {
  return safeStr(srt)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l) && !/^\d{2}:\d{2}:\d{2}[,.]\d+\s*-->/.test(l))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function normalizeNote(note, preferredNoteId) {
  const images = (Array.isArray(note.imageList) ? note.imageList : [])
    .map(pickImageUrl)
    .filter(Boolean);
  const videoInfo = parseVideoInfo(note);

  return {
    noteId: safeStr(note.noteId || note.id || preferredNoteId),
    title: safeStr(note.title),
    desc: safeStr(note.desc),
    type: safeStr(note.type), // "video" | "normal"
    nickname: safeStr(note.user && (note.user.nickname || note.user.nickName)),
    images: Array.from(new Set(images)),
    subtitleUrl: videoInfo.subtitleUrl,
    videoUrl: videoInfo.videoUrl,
    videoDuration: videoInfo.duration,
  };
}

/**
 * 结构兜底：深度优先扫描 state，找出长得像笔记详情的对象
 * （有 desc 且带 imageList/video；优先匹配 preferredNoteId）。
 */
function deepSearchNote(root, preferredNoteId) {
  let fallback = null;
  let visited = 0;
  const MAX_VISIT = 4000;
  const stack = [root];
  while (stack.length && visited < MAX_VISIT) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    visited++;
    if (!Array.isArray(cur) && typeof cur.desc === "string" && (cur.imageList || cur.video) && (cur.title !== undefined || cur.noteId || cur.id)) {
      const id = safeStr(cur.noteId || cur.id);
      if (preferredNoteId && id === preferredNoteId) return normalizeNote(cur, preferredNoteId);
      if (!fallback && (cur.imageList || cur.desc.length > 10)) fallback = cur;
      continue;
    }
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return fallback ? normalizeNote(fallback, preferredNoteId) : null;
}

/**
 * 一站式：分享口令/链接 → 笔记 { noteId, title, desc, type, images }。
 * 失败抛错（e.code: NO_LINK / LOGIN_REQUIRED / PARSE_FAILED / HTTP_ERROR）
 */
async function fetchNoteFromShareText(text) {
  const url = extractXhsUrl(text);
  if (!url) {
    const e = new Error("未识别到小红书链接，请粘贴完整分享口令或链接");
    e.code = "NO_LINK";
    throw e;
  }

  const resp = await httpsGet(url, { timeoutMs: 15000 });
  if (resp.status !== 200) {
    const e = new Error(`笔记页面请求失败（HTTP ${resp.status}）`);
    e.code = "HTTP_ERROR";
    throw e;
  }
  if (/website-login|login/i.test(resp.finalUrl)) {
    const e = new Error("笔记需要登录才能查看，请改用截图或粘贴文案");
    e.code = "LOGIN_REQUIRED";
    throw e;
  }

  const noteId = extractNoteId(resp.finalUrl);
  const state = parseInitialState(resp.body);
  // 短链过期/无效时小红书会 307 到首页（state 带 notFoundPage）
  if (state && state.notFoundPage) {
    const e = new Error("分享链接已失效，请在小红书 App 重新复制最新分享口令");
    e.code = "LINK_EXPIRED";
    throw e;
  }
  const note = state && extractNote(state, noteId);
  if (!note) {
    const e = new Error("笔记内容解析失败（页面结构可能已变化）");
    e.code = "PARSE_FAILED";
    throw e;
  }
  return note;
}

/** 下载单张图片为 Buffer（带 Referer 防盗链，超尺寸抛错） */
async function downloadImageBuffer(url) {
  const resp = await httpsGet(url, {
    headers: {
      "User-Agent": MOBILE_UA,
      Referer: "https://www.xiaohongshu.com/",
      Accept: "image/*,*/*;q=0.8",
    },
    timeoutMs: 20000,
    binary: true,
  });
  if (resp.status !== 200 || !resp.body || !resp.body.length) {
    throw new Error(`图片下载失败（HTTP ${resp.status}）`);
  }
  if (resp.body.length > IMAGE_MAX_BYTES) {
    throw new Error("图片超过大小限制");
  }
  return resp.body;
}

/** 下载文本资源（如 SRT 字幕） */
async function downloadTextFile(url) {
  const resp = await httpsGet(url, { timeoutMs: 15000 });
  if (resp.status !== 200 || !resp.body) {
    throw new Error(`文本下载失败（HTTP ${resp.status}）`);
  }
  return resp.body;
}

module.exports = {
  extractXhsUrl,
  extractNoteId,
  parseInitialState,
  extractNote,
  fetchNoteFromShareText,
  downloadImageBuffer,
  downloadTextFile,
  srtToText,
};
