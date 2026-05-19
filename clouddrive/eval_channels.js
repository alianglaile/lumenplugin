#!/usr/bin/env node
// =============================================================================
// eval_channels.js  —  多云盘 TG 频道质量评估工具
// =============================================================================
// 运行环境: Node.js 16+，无 npm 依赖
// 用法:
//   node eval_channels.js                              # 默认评估夸克
//   node eval_channels.js --cloud=quark               # 评估夸克网盘
//   node eval_channels.js --cloud=cloud115            # 评估 115 网盘
//   node eval_channels.js --cloud=aliyun              # 评估阿里云盘
//   node eval_channels.js --cloud=pan123              # 评估 123 网盘
//   node eval_channels.js --cloud=tianyi              # 评估天翼云盘
//   node eval_channels.js --cloud=pikpak              # 评估 PikPak
//   node eval_channels.js --cloud=quark --write-output        # 评估完自动写 channels_quark.json
//   node eval_channels.js --cloud=quark --top=5 --concurrency=6
//   node eval_channels.js --cloud=quark --phase1-limit=30     # 只扫前30个频道（调试）
//
// 测试片单：运行时从豆瓣以下三个 API 实时获取（与豆瓣插件 config.json 保持一致）
//   热门电影(4条): recent_hot/movie?category=热门
//   热门剧集(4条): recent_hot/tv?category=tv&type=tv
//   热门综艺(2条): recent_hot/tv?category=show&type=show
//   直接取返回结果靠前 N 条，不过滤。
//
// 三阶段评估流程:
//   Phase 1  目标云盘专注度扫描  — 拉取频道近期帖子，统计目标云盘链接占比
//                                 → 保留专注比例不足的频道，最多20个候选
//   Phase 2  搜索质量测试        — 用10个热门片单关键词搜索每个候选频道
//   Phase 3  链接有效率验证      — 随机抽样 Phase2 收集的链接，验证是否失效
//
// 评分维度 (100分制)
//  ┌──────────────────────┬──────┬──────────────────────────────────────────┐
//  │ 维度                 │ 权重 │ 说明                                      │
//  ├──────────────────────┼──────┼──────────────────────────────────────────┤
//  │ A  目标云盘专注度    │  20  │ 近期帖子中目标云盘链接 / 所有网盘链接     │
//  │ B  搜索命中率        │  30  │ 热门片单检索命中率（三类均衡统计）        │
//  │ C  链接有效率        │  25  │ 抽样链接的有效（未失效）比例              │
//  │ D  内容时效性        │  15  │ 命中帖子距今天数（越新越高分）            │
//  │ E  更新频率          │  10  │ 频道发帖密度 (帖/天)                      │
//  └──────────────────────┴──────┴──────────────────────────────────────────┘
// =============================================================================
"use strict";

const https  = require("https");
const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const urlLib = require("url");

// ─────────────────────────────────────────────────────────────
// 各云盘类型配置 — 与 cloudPatterns.js 保持同步
// ─────────────────────────────────────────────────────────────
var CLOUD_CONFIGS = {
  quark: {
    name:         "夸克",
    re:           /https?:\/\/pan\.quark\.cn\/s\/[A-Za-z0-9]+/g,
    invalidMarks: ["分享已失效", "链接已失效", "该分享不存在", "分享不存在", "已过期", "share invalid"],
    minRatio:     0.10,
    minCount:     2,
  },
  cloud115: {
    name:         "115",
    re:           /https?:\/\/(?:115\.com|anxia\.com|115cdn\.com)\/s\/[A-Za-z0-9%@!?#=&_.~-]+/g,
    invalidMarks: ["分享已失效", "链接已失效", "分享不存在", "已失效", "该分享"],
    minRatio:     0.10,
    minCount:     2,
  },
  aliyun: {
    name:         "阿里云盘",
    re:           /https?:\/\/(?:www\.aliyundrive\.com|www\.alipan\.com)\/s\/[A-Za-z0-9]+/g,
    invalidMarks: ["分享已失效", "该分享不存在", "链接不存在", "分享已过期", "分享链接已失效"],
    minRatio:     0.10,
    minCount:     2,
  },
  pan123: {
    name:         "123网盘",
    re:           /https?:\/\/(?:www\.123pan\.com|123684\.xyz|www\.123865\.com|www\.123912\.com)\/s\/[A-Za-z0-9_-]+/g,
    invalidMarks: ["分享链接不存在", "分享已失效", "链接无效", "不存在"],
    minRatio:     0.10,
    minCount:     2,
  },
  tianyi: {
    name:         "天翼云盘",
    re:           /https?:\/\/cloud\.189\.cn\/(?:t\/[A-Za-z0-9]+|web\/share\?code=[A-Za-z0-9]+)/g,
    invalidMarks: ["分享已失效", "链接已失效", "分享已过期", "该分享不存在"],
    minRatio:     0.10,
    minCount:     2,
  },
  pikpak: {
    name:         "PikPak",
    re:           /https?:\/\/mypikpak\.com\/s\/[A-Za-z0-9]+/g,
    invalidMarks: ["share link has expired", "This share link is invalid", "分享已失效"],
    minRatio:     0.10,
    minCount:     2,
  },
};

// Phase 1 分母用：统计所有类型链接总数
var ALL_CLOUD_RES = Object.keys(CLOUD_CONFIGS).map(function(k) { return CLOUD_CONFIGS[k].re; });

// ─────────────────────────────────────────────────────────────
// CLI 参数
// ─────────────────────────────────────────────────────────────
function getArg(name, defaultVal) {
  var prefix = "--" + name + "=";
  var a = process.argv.find(function(x) { return x.startsWith(prefix); });
  if (!a) return defaultVal;
  var raw = a.slice(prefix.length);
  return typeof defaultVal === "number" ? parseInt(raw, 10) : raw;
}
function hasFlag(name) { return process.argv.indexOf("--" + name) >= 0; }

var CLOUD_TYPE      = getArg("cloud",        "quark");
var TOP_N           = getArg("top",          3);
var CONCURRENCY     = getArg("concurrency",  5);
var PHASE1_LIMIT    = getArg("phase1-limit", 999);
var PHASE2_MAX_CH   = 20;
var VALIDATE_SAMPLE = 4;
var REQ_TIMEOUT_MS  = 12000;
var BATCH_DELAY_MS  = 250;
var WRITE_OUTPUT    = hasFlag("write-output");

if (!CLOUD_CONFIGS[CLOUD_TYPE]) {
  console.error("[错误] 不支持的云盘类型: --cloud=" + CLOUD_TYPE);
  console.error("       支持: " + Object.keys(CLOUD_CONFIGS).join(", "));
  process.exit(1);
}
var TARGET = CLOUD_CONFIGS[CLOUD_TYPE];

// ─────────────────────────────────────────────────────────────
// 豆瓣热门片单（与 douban/config.json 保持一致）
// ─────────────────────────────────────────────────────────────
var DOUBAN_SOURCES = [
  { cat: "电影", limit: 4, url: "https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie?start=0&limit=4&category=%E7%83%AD%E9%97%A8", referer: "https://m.douban.com/movie/" },
  { cat: "剧集", limit: 4, url: "https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv?start=0&limit=4&category=tv&type=tv",           referer: "https://m.douban.com/tv/" },
  { cat: "综艺", limit: 2, url: "https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv?start=0&limit=2&category=show&type=show",        referer: "https://m.douban.com/tv/" },
];

// ─────────────────────────────────────────────────────────────
// HTTP（支持重定向、超时、HTTPS+HTTP、自定义 headers）
// ─────────────────────────────────────────────────────────────
var BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function httpGet(targetUrl, timeoutMs, maxRedirects, extraHeaders) {
  if (maxRedirects === undefined) maxRedirects = 4;
  if (!timeoutMs) timeoutMs = REQ_TIMEOUT_MS;
  var headers = {
    "User-Agent":      BROWSER_UA,
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control":   "no-cache",
  };
  if (extraHeaders) { for (var k in extraHeaders) headers[k] = extraHeaders[k]; }
  return new Promise(function(resolve, reject) {
    var parsed = urlLib.parse(targetUrl);
    var lib = parsed.protocol === "https:" ? https : http;
    var req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     (parsed.pathname || "/") + (parsed.search || ""),
      method:   "GET",
      headers:  headers,
      timeout:  timeoutMs,
    }, function(res) {
      var loc = res.headers && res.headers["location"];
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && loc && maxRedirects > 0) {
        if (loc.startsWith("/")) loc = parsed.protocol + "//" + parsed.host + loc;
        res.resume();
        resolve(httpGet(loc, timeoutMs, maxRedirects - 1, extraHeaders));
        return;
      }
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end",  function()  { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }); });
    });
    req.on("error",   function(e) { reject(e); });
    req.on("timeout", function()  { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// 豆瓣热门片单拉取
// ─────────────────────────────────────────────────────────────
function fetchDoubanHot(src) {
  return httpGet(src.url, 12000, 3, { "User-Agent": BROWSER_UA, "Referer": src.referer, "Accept": "application/json, */*" })
    .then(function(res) {
      if (!res || res.status >= 400) return [];
      var payload;
      try { payload = JSON.parse(res.body); } catch (e) { return []; }
      return (payload.items || []).slice(0, src.limit).map(function(s) {
        var val = (s.rating && typeof s.rating === "object") ? (s.rating.value || 0) : 0;
        return { q: s.title, cat: src.cat, note: "豆瓣" + (val || "暂无") + "分" };
      });
    })
    .catch(function() { return []; });
}

function fetchTestQueries() {
  return batchRun(DOUBAN_SOURCES, function(src) { return fetchDoubanHot(src); }, 3, 200)
    .then(function(results) {
      var queries = [];
      for (var i = 0; i < results.length; i++) {
        var list = results[i] || [];
        for (var j = 0; j < list.length; j++) queries.push(list[j]);
      }
      return queries;
    });
}

// ─────────────────────────────────────────────────────────────
// TG 页面解析（与 tgParser.js 同源，独立内联）
// ─────────────────────────────────────────────────────────────
var RE_MSG_BLOCK = /<div class="tgme_widget_message_wrap[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
var RE_POST_ID   = /data-post="([^"]+)"/;
var RE_TEXT      = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
var RE_DATE      = /<time[^>]*datetime="([^"]+)"/;

function stripHTML(html) {
  if (!html) return "";
  return html
    .replace(/<a\b[^>]*\shref="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, function(_, href, inner) {
      var t = inner.replace(/<[^>]+>/g, "").trim();
      return (t && t !== href) ? t + " " + href : href;
    })
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

function parseTGPage(html) {
  if (!html) return [];
  RE_MSG_BLOCK.lastIndex = 0;
  var out = [];
  var m;
  while ((m = RE_MSG_BLOCK.exec(html)) !== null) {
    var block = m[0];
    var idM = block.match(RE_POST_ID);
    if (!idM) continue;
    var parts = idM[1].split("/");
    var postId = parts.length > 1 ? parts[1] : idM[1];
    var textM = block.match(RE_TEXT);
    var dateM = block.match(RE_DATE);
    var text    = textM ? stripHTML(textM[1]) : "";
    var pubDate = dateM ? dateM[1] : "";
    if (postId && (text || pubDate)) out.push({ postId: postId, text: text, pubDate: pubDate });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 网盘链接提取
// ─────────────────────────────────────────────────────────────
function extractTargetLinks(text) {
  if (!text) return [];
  TARGET.re.lastIndex = 0;
  var links = [], m;
  while ((m = TARGET.re.exec(text)) !== null) links.push(m[0]);
  return links;
}

function countAllCloudLinks(text) {
  if (!text) return 0;
  var total = 0;
  for (var i = 0; i < ALL_CLOUD_RES.length; i++) {
    ALL_CLOUD_RES[i].lastIndex = 0;
    while (ALL_CLOUD_RES[i].exec(text) !== null) total++;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────
// 日期工具
// ─────────────────────────────────────────────────────────────
function parseDate(s)  { if (!s) return null; var d = new Date(s); return isNaN(d.getTime()) ? null : d; }
function daysSince(d)  { if (!d) return 9999; return (Date.now() - d.getTime()) / 86400000; }

// ─────────────────────────────────────────────────────────────
// 并发控制（worker-queue，兼容 Node 16）
// ─────────────────────────────────────────────────────────────
function batchRun(items, fn, concurrency, delayMs) {
  var results = new Array(items.length);
  var idx = 0;
  function worker() {
    if (idx >= items.length) return Promise.resolve();
    var i = idx++;
    return Promise.resolve()
      .then(function() { return fn(items[i], i); })
      .then(function(r) { results[i] = r; })
      .catch(function() { results[i] = null; })
      .then(function() {
        return delayMs > 0 ? sleep(delayMs).then(function() { return worker(); }) : worker();
      });
  }
  var workers = [];
  for (var w = 0; w < Math.min(concurrency, items.length); w++) workers.push(worker());
  return Promise.all(workers).then(function() { return results; });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ─────────────────────────────────────────────────────────────
// 控制台工具
// ─────────────────────────────────────────────────────────────
function progress(msg) { process.stdout.write("\r\x1b[2K" + msg); }
function println(msg)  { process.stdout.write("\n" + (msg === undefined ? "" : msg)); }
function pad(s, n)     { s = String(s || ""); while (s.length < n) s += " "; return s; }
function rpad(s, n)    { s = String(s || ""); while (s.length < n) s = " " + s; return s; }

function sampleUnique(arr, n) {
  var seen = {}, uniq = arr.filter(function(u) { if (seen[u]) return false; seen[u] = true; return true; });
  if (uniq.length <= n) return uniq;
  for (var i = uniq.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = uniq[i]; uniq[i] = uniq[j]; uniq[j] = tmp;
  }
  return uniq.slice(0, n);
}

// =============================================================================
// Phase 1: 目标云盘专注度扫描
// =============================================================================
function phase1ScanChannel(channelId) {
  var result = { channelId: channelId, targetCount: 0, totalCount: 0, postCount: 0,
                 targetRatio: 0, postsPerDay: 0, newestDate: null, error: null };
  return httpGet("https://t.me/s/" + encodeURIComponent(channelId), REQ_TIMEOUT_MS)
    .then(function(res) {
      if (!res || res.status >= 400) { result.error = "HTTP " + (res ? res.status : "?"); return result; }
      var posts = parseTGPage(res.body || "");
      result.postCount = posts.length;
      var dates = [];
      for (var i = 0; i < posts.length; i++) {
        result.targetCount += extractTargetLinks(posts[i].text).length;
        result.totalCount  += countAllCloudLinks(posts[i].text);
        var d = parseDate(posts[i].pubDate);
        if (d) dates.push(d);
      }
      result.targetRatio = result.totalCount > 0 ? result.targetCount / result.totalCount : 0;
      if (dates.length > 0) {
        dates.sort(function(a, b) { return b - a; });
        result.newestDate = dates[0];
        var spanDays = Math.max(1, daysSince(dates[dates.length - 1]) - daysSince(dates[0]));
        result.postsPerDay = dates.length / spanDays;
      }
      return result;
    })
    .catch(function(e) { result.error = String(e.message || e); return result; });
}

// =============================================================================
// Phase 2: 搜索命中率测试
// =============================================================================
function phase2TestQuery(channelId, query) {
  var out = { hit: false, targetLinks: [], hitDate: null };
  return httpGet("https://t.me/s/" + encodeURIComponent(channelId) + "?q=" + encodeURIComponent(query), REQ_TIMEOUT_MS)
    .then(function(res) {
      if (!res || res.status >= 400) return out;
      var posts = parseTGPage(res.body || "");
      for (var i = 0; i < posts.length; i++) {
        var links = extractTargetLinks(posts[i].text);
        if (links.length > 0) {
          out.hit = true;
          for (var j = 0; j < links.length; j++) out.targetLinks.push(links[j]);
          if (!out.hitDate) out.hitDate = parseDate(posts[i].pubDate);
        }
      }
      return out;
    })
    .catch(function() { return out; });
}

// =============================================================================
// Phase 3: 链接有效率验证（通用策略 + 云盘专属失效标记）
//
// 许多云盘为 SPA，初始 HTML 不含完整文件信息。
// 策略：检测已知失效关键词；若页面 >5KB 且无失效词则推断"有效"。
// 准确率约 70-80%，unknown 不计入分母，不奖励也不惩罚。
// =============================================================================
function validateLink(shareUrl) {
  return httpGet(shareUrl, 8000)
    .then(function(res) {
      if (!res) return "unknown";
      if (res.status === 404 || res.status >= 500) return "invalid";
      if (res.status !== 200) return "unknown";
      var body = (res.body || "").toLowerCase();
      for (var i = 0; i < TARGET.invalidMarks.length; i++) {
        if (body.indexOf(TARGET.invalidMarks[i].toLowerCase()) >= 0) return "invalid";
      }
      return res.body.length > 5000 ? "valid" : "unknown";
    })
    .catch(function() { return "unknown"; });
}

// =============================================================================
// 评分计算
// =============================================================================
var TEST_QUERIES = [];

function calcScore(p1, p2Results, p3) {
  // A. 目标云盘专注度 (20分): ratio 达 50% 满分，线性映射
  var scoreA = Math.min(p1.targetRatio / 0.5, 1.0) * 20;

  // B. 搜索命中率 (30分): 按剧集/电影/综艺三类分别统计命中率，取平均
  //    避免单类型内容偏强的频道虚高
  var catMap = {};
  for (var i = 0; i < TEST_QUERIES.length; i++) {
    var cat = TEST_QUERIES[i].cat;
    if (!catMap[cat]) catMap[cat] = { hits: 0, total: 0 };
    catMap[cat].total++;
    if (p2Results[i] && p2Results[i].hit) catMap[cat].hits++;
  }
  var cats = Object.keys(catMap);
  var catRateSum = 0;
  for (var c = 0; c < cats.length; c++) {
    var ct = catMap[cats[c]];
    catRateSum += ct.total > 0 ? ct.hits / ct.total : 0;
  }
  var scoreB = (cats.length > 0 ? catRateSum / cats.length : 0) * 30;

  // C. 链接有效率 (25分): 无样本时给中间分 12.5
  var denomC = p3.validCount + p3.invalidCount;
  var scoreC = denomC > 0 ? (p3.validCount / denomC) * 25 : 12.5;

  // D. 内容时效性 (15分): 取所有命中帖子中最新一条的天龄
  var minDays = 9999;
  for (var j = 0; j < p2Results.length; j++) {
    if (p2Results[j] && p2Results[j].hitDate) {
      var d = daysSince(p2Results[j].hitDate);
      if (d < minDays) minDays = d;
    }
  }
  var scoreD = minDays < 7 ? 15 : minDays < 30 ? 10 : minDays < 90 ? 5 : minDays < 180 ? 2 : 0;

  // E. 更新频率 (10分)
  var ppd = p1.postsPerDay;
  var scoreE = ppd >= 5 ? 10 : ppd >= 2 ? 8 : ppd >= 1 ? 6 : ppd >= 0.5 ? 4 : ppd >= 0.1 ? 2 : 0;

  return {
    total: Math.round((scoreA + scoreB + scoreC + scoreD + scoreE) * 10) / 10,
    A: Math.round(scoreA * 10) / 10,
    B: Math.round(scoreB * 10) / 10,
    C: Math.round(scoreC * 10) / 10,
    D: Math.round(scoreD * 10) / 10,
    E: Math.round(scoreE * 10) / 10,
  };
}

// =============================================================================
// Main
// =============================================================================
function main() {
  var channelsFile = path.join(__dirname, "channels.json");
  var allChannels;
  try {
    allChannels = JSON.parse(fs.readFileSync(channelsFile, "utf8"));
  } catch (e) {
    console.error("[错误] 无法读取 channels.json:", e.message);
    process.exit(1);
  }
  if (PHASE1_LIMIT < allChannels.length) allChannels = allChannels.slice(0, PHASE1_LIMIT);

  println("╔══════════════════════════════════════════════════════════╗");
  println("║   eval_channels.js  —  TG 频道云盘质量评估工具           ║");
  println("╚══════════════════════════════════════════════════════════╝");
  println("目标云盘: " + TARGET.name + " (" + CLOUD_TYPE + ")" +
          "  候选=" + allChannels.length + "  并发=" + CONCURRENCY + "  Top=" + TOP_N +
          (WRITE_OUTPUT ? "  [--write-output]" : ""));
  println("");
  println("─── 从豆瓣获取热门片单 ───");

  return fetchTestQueries().then(function(queries) {
    if (queries.length === 0) {
      println("  [!] 豆瓣片单获取失败，请检查网络后重试。");
      process.exit(1);
    }
    TEST_QUERIES = queries;
    println("  获取成功，共 " + TEST_QUERIES.length + " 条：");
    var bycat = {};
    for (var qi = 0; qi < TEST_QUERIES.length; qi++) {
      var tq = TEST_QUERIES[qi];
      if (!bycat[tq.cat]) bycat[tq.cat] = [];
      bycat[tq.cat].push(tq.q + "(" + tq.note + ")");
    }
    var cats2 = Object.keys(bycat);
    for (var ci0 = 0; ci0 < cats2.length; ci0++) {
      println("  [" + cats2[ci0] + "] " + bycat[cats2[ci0]].join("  "));
    }
    println("");
    println("评分维度: A专注度(20) B命中率(30) C有效率(25) D时效性(15) E频率(10)");
    println("");

    // ── Phase 1 ────────────────────────────────────────────────
    println("─── Phase 1: " + TARGET.name + " 专注度扫描 (" + allChannels.length + " 个频道) ───");
    var done1 = 0;

    return batchRun(allChannels, function(ch) {
      progress("  扫描进度: " + (++done1) + "/" + allChannels.length + "  当前: @" + ch.id);
      return phase1ScanChannel(ch.id);
    }, CONCURRENCY, BATCH_DELAY_MS)
    .then(function(phase1Results) {

      var candidates = phase1Results
        .filter(function(r) {
          return r && !r.error &&
                 r.targetRatio >= TARGET.minRatio &&
                 r.targetCount >= TARGET.minCount;
        })
        .sort(function(a, b) { return b.targetRatio - a.targetRatio; })
        .slice(0, PHASE2_MAX_CH);

      println("\n");
      println(TARGET.name + " 专注度筛选结果 (比例 ≥ " + (TARGET.minRatio * 100).toFixed(0) + "%, 链接数 ≥ " + TARGET.minCount + "):");
      println("  " + pad("频道", 25) + pad("专注比例", 10) + pad("目标链接数", 12) + pad("总链接数", 10) + "发帖密度");
      println("  " + "─".repeat(65));
      if (candidates.length === 0) {
        println("  [!] 未找到符合条件的 " + TARGET.name + " 频道。请适当降低门槛参数重试。");
      }
      for (var ci = 0; ci < candidates.length; ci++) {
        var r = candidates[ci];
        println("  " + pad("@" + r.channelId, 25) +
          pad((r.targetRatio * 100).toFixed(0) + "%", 10) +
          pad(r.targetCount, 12) +
          pad(r.totalCount, 10) +
          r.postsPerDay.toFixed(1) + " 帖/天");
      }
      println("  共 " + candidates.length + " 个频道进入 Phase 2");
      if (candidates.length === 0) return;

      // ── Phase 2 ────────────────────────────────────────────────
      println("");
      println("─── Phase 2: 搜索命中率测试 (" + candidates.length + " 频道 × " + TEST_QUERIES.length + " 关键词) ───");

      var phase2Map     = {};
      var collectedLinks = {};

      function processOneChannel(ch) {
        return batchRun(TEST_QUERIES, function(tq) {
          progress("  @" + ch.channelId + " — 「" + tq.q + "」");
          return phase2TestQuery(ch.channelId, tq.q);
        }, 3, 200)
        .then(function(qResults) {
          var allLinks = [];
          for (var qi = 0; qi < qResults.length; qi++) {
            var qr = qResults[qi];
            if (qr && qr.targetLinks) {
              for (var li = 0; li < qr.targetLinks.length; li++) allLinks.push(qr.targetLinks[li]);
            }
          }
          phase2Map[ch.channelId]      = qResults;
          collectedLinks[ch.channelId] = allLinks;
          var hitCount = qResults.filter(function(r) { return r && r.hit; }).length;
          println("\n  ✓ @" + pad(ch.channelId, 22) +
            "命中 " + rpad(hitCount, 2) + "/" + TEST_QUERIES.length +
            " 关键词  │  收集链接 " + allLinks.length + " 个");
        });
      }

      var chChain = Promise.resolve();
      for (var ci2 = 0; ci2 < candidates.length; ci2++) {
        (function(ch) { chChain = chChain.then(function() { return processOneChannel(ch); }); })(candidates[ci2]);
      }

      return chChain.then(function() {

        // ── Phase 3 ──────────────────────────────────────────────
        println("");
        println("─── Phase 3: 链接有效率验证 ───");
        println("  (部分云盘为 SPA，验证准确率约 70-80%，unknown 不计入分母)");

        var phase3Map = {};

        function validateOneChannel(ch) {
          var sample = sampleUnique(collectedLinks[ch.channelId] || [], VALIDATE_SAMPLE);
          var vr = { validCount: 0, invalidCount: 0, unknownCount: 0 };
          if (sample.length === 0) {
            phase3Map[ch.channelId] = vr;
            println("\n  @" + ch.channelId + " — 无可验证链接");
            return Promise.resolve();
          }
          return batchRun(sample, function(link, si) {
            progress("  @" + ch.channelId + " 验证链接 " + (si + 1) + "/" + sample.length + " ...");
            return validateLink(link);
          }, 3, 300)
          .then(function(states) {
            for (var si = 0; si < states.length; si++) {
              var s = states[si] || "unknown";
              if (s === "valid") vr.validCount++;
              else if (s === "invalid") vr.invalidCount++;
              else vr.unknownCount++;
            }
            phase3Map[ch.channelId] = vr;
            println("\n  ✓ @" + pad(ch.channelId, 22) +
              "有效=" + vr.validCount + "  失效=" + vr.invalidCount + "  未知=" + vr.unknownCount +
              "  (抽样 " + sample.length + " 条)");
          });
        }

        var v3Chain = Promise.resolve();
        for (var vi = 0; vi < candidates.length; vi++) {
          (function(ch) { v3Chain = v3Chain.then(function() { return validateOneChannel(ch); }); })(candidates[vi]);
        }

        return v3Chain.then(function() {

          // ── 综合评分 ──────────────────────────────────────────
          println("");
          println("─── 综合评分 ───");

          var scored = candidates.map(function(ch) {
            var p2 = phase2Map[ch.channelId] || [];
            var p3 = phase3Map[ch.channelId] || { validCount: 0, invalidCount: 0, unknownCount: 0 };
            return { channelId: ch.channelId, p1: ch, p2: p2, p3: p3, score: calcScore(ch, p2, p3) };
          });
          scored.sort(function(a, b) { return b.score.total - a.score.total; });

          println("  " + pad("频道", 24) + rpad("总分", 6) + rpad("A专注", 7) + rpad("B命中", 7) + rpad("C有效", 7) + rpad("D时效", 7) + rpad("E频率", 7));
          println("  " + "─".repeat(65));
          for (var ri = 0; ri < scored.length; ri++) {
            var s = scored[ri];
            println((ri < TOP_N ? "★ " : "  ") + pad("@" + s.channelId, 24) +
              rpad(s.score.total.toFixed(1), 6) + rpad(s.score.A.toFixed(1), 7) +
              rpad(s.score.B.toFixed(1), 7)     + rpad(s.score.C.toFixed(1), 7) +
              rpad(s.score.D.toFixed(1), 7)     + rpad(s.score.E.toFixed(1), 7));
          }

          // ── 最终推荐 ─────────────────────────────────────────
          println("");
          println("══════════════════════════════════════════════════════════");
          println("  " + TARGET.name + " 推荐频道 Top " + TOP_N + "  (满分 100 分)");
          println("══════════════════════════════════════════════════════════");

          var topList = scored.slice(0, TOP_N);
          for (var ti = 0; ti < topList.length; ti++) {
            var ts = topList[ti];
            var hitCount2 = ts.p2.filter(function(r) { return r && r.hit; }).length;
            var minDaysHit = 9999;
            for (var pi = 0; pi < ts.p2.length; pi++) {
              if (ts.p2[pi] && ts.p2[pi].hitDate) {
                var dd = daysSince(ts.p2[pi].hitDate);
                if (dd < minDaysHit) minDaysHit = dd;
              }
            }
            var freshStr = minDaysHit < 9999 ? Math.round(minDaysHit) + " 天前最新更新" : "无法确定更新时间";
            println("");
            println("  #" + (ti + 1) + "  @" + ts.channelId + "  ─  " + ts.score.total.toFixed(1) + " 分");
            println("      专注度:   " + (ts.p1.targetRatio * 100).toFixed(0) + "%（" + TARGET.name + " / " + ts.p1.totalCount + " 条网盘链接）");
            println("      搜索命中: " + hitCount2 + "/" + TEST_QUERIES.length + " 个关键词");
            println("      链接有效: " + ts.p3.validCount + " 有效 / " + ts.p3.invalidCount + " 失效（抽样 " + (ts.p3.validCount + ts.p3.invalidCount + ts.p3.unknownCount) + " 条）");
            println("      时效:     " + freshStr);
            println("      发帖密度: " + ts.p1.postsPerDay.toFixed(1) + " 帖/天");
            var hitDetail = [];
            for (var qi2 = 0; qi2 < TEST_QUERIES.length; qi2++) {
              if (ts.p2[qi2] && ts.p2[qi2].hit) hitDetail.push(TEST_QUERIES[qi2].q);
            }
            if (hitDetail.length > 0) println("      命中片单: " + hitDetail.join("、"));
          }

          // ── 写出 channels_{type}.json ─────────────────────────
          var outputFile = path.join(__dirname, "channels_" + CLOUD_TYPE + ".json");
          var outputData = topList.map(function(ts) { return { name: ts.channelId, id: ts.channelId }; });

          println("");
          if (WRITE_OUTPUT) {
            try {
              fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2) + "\n", "utf8");
              println("✅  已写入 " + path.basename(outputFile));
            } catch (e) {
              println("[!] 写入失败: " + e.message);
            }
          } else {
            println("─────────────────────────────────────────────────────────");
            println("channels_" + CLOUD_TYPE + ".json 预览（加 --write-output 自动写入）:");
            println(JSON.stringify(outputData, null, 2));
          }

          println("");
          println("─────────────────────────────────────────────────────────");
          println("使用建议:");
          println("  1. 加 --write-output 参数自动将 Top " + TOP_N + " 写入 channels_" + CLOUD_TYPE + ".json");
          println("  2. 并同步更新 main.js 中 BUILT_IN_BY_TYPE[\"" + CLOUD_TYPE + "\"] 作为离线 fallback");
          println("  3. 有效率偏低的频道建议隔月重测");
          println("  4. TG 搜索有频率限制，运行失败可降低 --concurrency 参数");
          println("══════════════════════════════════════════════════════════");
        });        // closes v3Chain.then
      });          // closes chChain.then
    });            // closes batchRun.then (phase1)
  })               // closes fetchTestQueries.then
  .catch(function(e) {
    println("\n[错误] " + (e.message || e));
    process.exit(1);
  });
}

main();
