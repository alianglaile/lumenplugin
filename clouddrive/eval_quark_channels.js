#!/usr/bin/env node
// =============================================================================
// eval_quark_channels.js  —  夸克网盘 TG 频道质量评估工具
// =============================================================================
// 运行环境: Node.js 16+，无 npm 依赖
// 用法:
//   node eval_quark_channels.js                      # 默认参数
//   node eval_quark_channels.js --top=5              # 输出 Top5
//   node eval_quark_channels.js --concurrency=6      # 提高并发
//   node eval_quark_channels.js --phase1-limit=30    # 只扫前30个频道
//
// 测试片单：运行时从豆瓣以下三个 API 实时获取（与豆瓣插件 config.json 保持一致）
//   热门电影(4条): recent_hot/movie?category=热门
//   热门剧集(4条): recent_hot/tv?category=tv&type=tv
//   热门综艺(2条): recent_hot/tv?category=show&type=show
//   直接取返回结果靠前的 N 条，不过滤。
//
// 三阶段评估流程:
//   Phase 1  夸克专注度扫描  ─  拉取每个频道近期帖子，统计夸克链接占比
//                              → 过滤掉夸克比例不足的频道，留下最多20个候选
//   Phase 2  搜索质量测试  ─  用10个热门片单关键词搜索每个候选频道
//                              → 按命中率、时效性、链接密度进一步评分
//   Phase 3  链接有效率验证  ─  随机抽样Phase2收集的夸克链接，验证是否仍在线
//
// 评分维度 (100分制)
//  ┌────────────────────┬──────┬─────────────────────────────────────────────┐
//  │ 维度               │ 权重 │ 说明                                         │
//  ├────────────────────┼──────┼─────────────────────────────────────────────┤
//  │ A  夸克专注度      │  20  │ 近期帖子中夸克链接 / 所有网盘链接            │
//  │ B  搜索命中率      │  30  │ 热门片单检索命中率（剧集/电影/综艺均衡统计） │
//  │ C  链接有效率      │  25  │ 抽样夸克链接的有效（未失效）比例             │
//  │ D  内容时效性      │  15  │ 命中帖子距今天数（越新越高分）               │
//  │ E  更新频率        │  10  │ 频道发帖密度 (帖/天)                         │
//  └────────────────────┴──────┴─────────────────────────────────────────────┘
// =============================================================================
"use strict";

const https  = require("https");
const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const urlLib = require("url");

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

var TOP_N           = getArg("top",            3);   // 最终输出 Top N
var CONCURRENCY     = getArg("concurrency",    5);   // 全局并发数
var PHASE1_LIMIT    = getArg("phase1-limit",   999); // Phase1 最多扫几个频道
var PHASE2_MAX_CH   = 20;   // Phase1 后最多进入 Phase2 的频道数
var VALIDATE_SAMPLE = 4;    // Phase3 每频道最多验证几个链接
var QUARK_MIN_RATIO = 0.10; // Phase1 夸克占比门槛（低于此值不参与后续评估）
var QUARK_MIN_COUNT = 2;    // Phase1 至少需要发现几个夸克链接才算夸克频道
var REQ_TIMEOUT_MS  = 12000;
var BATCH_DELAY_MS  = 250;  // 批次间延迟，防止 TG 限速

// ─────────────────────────────────────────────────────────────
// 豆瓣热门片单配置（与 douban/config.json pages 对应）
// 运行时动态拉取，不过滤，直接取靠前 N 条
// ─────────────────────────────────────────────────────────────
var DOUBAN_SOURCES = [
  {
    cat:     "电影",
    limit:   4,
    url:     "https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie?start=0&limit=4&category=%E7%83%AD%E9%97%A8",
    referer: "https://m.douban.com/movie/",
  },
  {
    cat:     "剧集",
    limit:   4,
    url:     "https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv?start=0&limit=4&category=tv&type=tv",
    referer: "https://m.douban.com/tv/",
  },
  {
    cat:     "综艺",
    limit:   2,
    url:     "https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv?start=0&limit=2&category=show&type=show",
    referer: "https://m.douban.com/tv/",
  },
];

// ─────────────────────────────────────────────────────────────
// HTTP 请求 (支持重定向、超时、HTTP+HTTPS、自定义 headers)
// ─────────────────────────────────────────────────────────────
var BROWSER_HEADERS = {
  "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Cache-Control":   "no-cache",
};

// extraHeaders 可覆盖默认 BROWSER_HEADERS（如 Referer、Accept）
function httpGet(targetUrl, timeoutMs, maxRedirects, extraHeaders) {
  if (maxRedirects === undefined) maxRedirects = 4;
  if (!timeoutMs) timeoutMs = REQ_TIMEOUT_MS;
  var headers = {};
  for (var k in BROWSER_HEADERS) headers[k] = BROWSER_HEADERS[k];
  if (extraHeaders) { for (var k2 in extraHeaders) headers[k2] = extraHeaders[k2]; }
  return new Promise(function(resolve, reject) {
    var parsed = urlLib.parse(targetUrl);
    var lib = parsed.protocol === "https:" ? https : http;
    var opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     (parsed.pathname || "/") + (parsed.search || ""),
      method:   "GET",
      headers:  headers,
      timeout:  timeoutMs,
    };
    var req = lib.request(opts, function(res) {
      var loc = res.headers && res.headers["location"];
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && loc && maxRedirects > 0) {
        if (loc.startsWith("/")) loc = parsed.protocol + "//" + parsed.host + loc;
        res.resume();
        resolve(httpGet(loc, timeoutMs, maxRedirects - 1, extraHeaders));
        return;
      }
      var chunks = [];
      res.on("data", function(c) { chunks.push(c); });
      res.on("end", function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), finalUrl: targetUrl });
      });
    });
    req.on("error",   function(e) { reject(e); });
    req.on("timeout", function()  { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// 豆瓣热门片单拉取
// 与 douban/config.json 保持一致的三个端点，直接取靠前 N 条
// ─────────────────────────────────────────────────────────────
function fetchDoubanHot(src) {
  // src: { cat, url, limit, referer }
  var doubanHeaders = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer":    src.referer,
    "Accept":     "application/json, text/plain, */*",
  };
  return httpGet(src.url, 12000, 3, doubanHeaders)
    .then(function(res) {
      if (!res || res.status >= 400) return [];
      var payload;
      try { payload = JSON.parse(res.body); } catch (e) { return []; }
      // API 返回 { items: [...] }
      var items = payload.items || [];
      return items.slice(0, src.limit).map(function(s) {
        var r = s.rating;
        var val = (r && typeof r === "object") ? (r.value || 0) : 0;
        return { q: s.title, cat: src.cat, note: "豆瓣" + (val || "暂无") + "分" };
      });
    })
    .catch(function() { return []; });
}

// 依次拉取三类热门内容，合并为 TEST_QUERIES
function fetchTestQueries() {
  return batchRun(DOUBAN_SOURCES, function(src) {
    return fetchDoubanHot(src);
  }, 3, 200)
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
// TG 页面解析 (与 tgParser.js 同源，独立内联)
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
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
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
    var text  = textM ? stripHTML(textM[1]) : "";
    var dateM = block.match(RE_DATE);
    var pubDate = dateM ? dateM[1] : "";
    if (postId && (text || pubDate)) {
      out.push({ postId: postId, text: text, pubDate: pubDate });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 网盘链接提取
// ─────────────────────────────────────────────────────────────
// 与 cloudPatterns.js 保持同步，这里独立内联
var RE_QUARK = /https?:\/\/pan\.quark\.cn\/s\/[A-Za-z0-9]+/g;
var ALL_CLOUD_RES = [
  /https?:\/\/pan\.quark\.cn\/s\/[A-Za-z0-9]+/g,
  /https?:\/\/(?:115\.com|anxia\.com|115cdn\.com)\/s\/[A-Za-z0-9%@!?#=&_.~-]+/g,
  /https?:\/\/(?:www\.123pan\.com|123684\.xyz|www\.123865\.com|www\.123912\.com)\/s\/[A-Za-z0-9_-]+/g,
  /https?:\/\/cloud\.189\.cn\/(?:t\/[A-Za-z0-9]+|web\/share\?code=[A-Za-z0-9]+)/g,
  /https?:\/\/pan\.baidu\.com\/s\/[A-Za-z0-9_-]+/g,
  /https?:\/\/(?:www\.aliyundrive\.com|www\.alipan\.com)\/s\/[A-Za-z0-9]+/g,
  /https?:\/\/mypikpak\.com\/s\/[A-Za-z0-9]+/g,
];

function extractQuarkLinks(text) {
  if (!text) return [];
  RE_QUARK.lastIndex = 0;
  var links = [];
  var m;
  while ((m = RE_QUARK.exec(text)) !== null) links.push(m[0]);
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
function parseDate(s) {
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function daysSince(d) {
  if (!d) return 9999;
  return (Date.now() - d.getTime()) / 86400000;
}

// ─────────────────────────────────────────────────────────────
// 并发控制
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
  var limit = Math.min(concurrency, items.length);
  for (var w = 0; w < limit; w++) workers.push(worker());
  return Promise.all(workers).then(function() { return results; });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ─────────────────────────────────────────────────────────────
// 控制台输出
// ─────────────────────────────────────────────────────────────
function progress(msg) { process.stdout.write("\r\x1b[2K" + msg); }
function println(msg)   { process.stdout.write("\n" + (msg === undefined ? "" : msg)); }
function pad(s, n)      { s = String(s || ""); while (s.length < n) s += " "; return s; }
function rpad(s, n)     { s = String(s || ""); while (s.length < n) s = " " + s; return s; }

// ─────────────────────────────────────────────────────────────
// 随机抽样（Fisher-Yates）+ 去重
// ─────────────────────────────────────────────────────────────
function sampleUnique(arr, n) {
  var seen = {};
  var uniq = arr.filter(function(u) { if (seen[u]) return false; seen[u] = true; return true; });
  if (uniq.length <= n) return uniq;
  for (var i = uniq.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = uniq[i]; uniq[i] = uniq[j]; uniq[j] = tmp;
  }
  return uniq.slice(0, n);
}

// =============================================================================
// Phase 1: 夸克专注度扫描
// 拉取频道近期帖子（无关键词），统计夸克链接占比、发帖密度
// =============================================================================
function phase1ScanChannel(channelId) {
  var result = { channelId: channelId, quarkCount: 0, totalCount: 0, postCount: 0,
                 quarkRatio: 0, postsPerDay: 0, newestDate: null, error: null };
  return httpGet("https://t.me/s/" + encodeURIComponent(channelId), REQ_TIMEOUT_MS)
    .then(function(res) {
      if (!res || res.status >= 400) {
        result.error = "HTTP " + (res ? res.status : "?");
        return result;
      }
      var posts = parseTGPage(res.body || "");
      result.postCount = posts.length;
      var dates = [];
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        result.quarkCount += extractQuarkLinks(p.text).length;
        result.totalCount += countAllCloudLinks(p.text);
        var d = parseDate(p.pubDate);
        if (d) dates.push(d);
      }
      result.quarkRatio = result.totalCount > 0 ? result.quarkCount / result.totalCount : 0;
      if (dates.length > 0) {
        dates.sort(function(a, b) { return b - a; });
        result.newestDate = dates[0];
        var oldest = dates[dates.length - 1];
        var spanDays = Math.max(1, daysSince(oldest) - daysSince(dates[0]));
        result.postsPerDay = dates.length / spanDays;
      }
      return result;
    })
    .catch(function(e) { result.error = String(e.message || e); return result; });
}

// =============================================================================
// Phase 2: 搜索命中率测试
// 用单个关键词搜索频道，返回命中状态、收集到的夸克链接、最新命中帖子日期
// =============================================================================
function phase2TestQuery(channelId, query) {
  var out = { hit: false, quarkLinks: [], hitDate: null };
  var tgUrl = "https://t.me/s/" + encodeURIComponent(channelId) + "?q=" + encodeURIComponent(query);
  return httpGet(tgUrl, REQ_TIMEOUT_MS)
    .then(function(res) {
      if (!res || res.status >= 400) return out;
      var posts = parseTGPage(res.body || "");
      for (var i = 0; i < posts.length; i++) {
        var links = extractQuarkLinks(posts[i].text);
        if (links.length > 0) {
          out.hit = true;
          for (var j = 0; j < links.length; j++) out.quarkLinks.push(links[j]);
          if (!out.hitDate) out.hitDate = parseDate(posts[i].pubDate);
        }
      }
      return out;
    })
    .catch(function() { return out; });
}

// =============================================================================
// Phase 3: 链接有效率验证
// 访问夸克分享页，判断链接是否已失效
//
// 注意: 夸克使用 React SPA，初始 HTML 不含完整文件信息。
// 验证策略: 检测已知「失效」关键词；若页面 >5KB 且无错误词则推断「有效」。
// 准确率约 70-80%，如需更高精度建议结合夸克 API 鉴权接口。
// =============================================================================
var QUARK_INVALID_MARKS = ["分享已失效", "链接已失效", "该分享不存在", "分享不存在", "已过期", "share invalid"];

function validateQuarkLink(shareUrl) {
  return httpGet(shareUrl, 8000)
    .then(function(res) {
      if (!res) return "unknown";
      if (res.status === 404 || res.status >= 500) return "invalid";
      if (res.status !== 200) return "unknown";
      var body = res.body || "";
      for (var i = 0; i < QUARK_INVALID_MARKS.length; i++) {
        if (body.indexOf(QUARK_INVALID_MARKS[i]) >= 0) return "invalid";
      }
      return body.length > 5000 ? "valid" : "unknown";
    })
    .catch(function() { return "unknown"; });
}

// =============================================================================
// 评分计算
// =============================================================================
function calcScore(p1, p2Results, p3) {
  // A. 夸克专注度 (20分): quarkRatio 达到 50% 可得满分，线性映射
  var scoreA = Math.min(p1.quarkRatio / 0.5, 1.0) * 20;

  // B. 搜索命中率 (30分): 按 剧集/电影/综艺 三类分别统计命中率，取平均
  //    避免某类内容缺失的频道因其他类全中而虚高
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

  // C. 链接有效率 (25分): 有效/(有效+失效)，unknown 不计入分母
  //    无法采样时给中间分 12.5，不奖励也不惩罚
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
  var scoreD = minDays < 7   ? 15
             : minDays < 30  ? 10
             : minDays < 90  ? 5
             : minDays < 180 ? 2
             : 0;

  // E. 更新频率 (10分): 发帖密度
  var ppd = p1.postsPerDay;
  var scoreE = ppd >= 5   ? 10
             : ppd >= 2   ? 8
             : ppd >= 1   ? 6
             : ppd >= 0.5 ? 4
             : ppd >= 0.1 ? 2
             : 0;

  return {
    total: Math.round((scoreA + scoreB + scoreC + scoreD + scoreE) * 10) / 10,
    A: Math.round(scoreA * 10) / 10,
    B: Math.round(scoreB * 10) / 10,
    C: Math.round(scoreC * 10) / 10,
    D: Math.round(scoreD * 10) / 10,
    E: Math.round(scoreE * 10) / 10,
  };
}

// TEST_QUERIES 在 main() 里从豆瓣动态填充，这里初始化为空
var TEST_QUERIES = [];

// =============================================================================
// Main
// =============================================================================
function main() {
  // 加载 channels.json
  var channelsFile = path.join(__dirname, "channels.json");
  var allChannels;
  try {
    allChannels = JSON.parse(fs.readFileSync(channelsFile, "utf8"));
  } catch (e) {
    console.error("[错误] 无法读取 channels.json:", e.message);
    process.exit(1);
  }
  if (PHASE1_LIMIT < allChannels.length) {
    allChannels = allChannels.slice(0, PHASE1_LIMIT);
  }

  println("╔══════════════════════════════════════════════════════════╗");
  println("║  eval_quark_channels.js  —  夸克网盘 TG 频道质量评估     ║");
  println("╚══════════════════════════════════════════════════════════╝");
  println("配置: 候选上限=" + allChannels.length + "  并发=" + CONCURRENCY + "  输出Top=" + TOP_N);
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
    println("评分维度: A夸克专注度(20) B搜索命中率(30) C链接有效率(25) D时效性(15) E频率(10)");
    println("");

  // ── Phase 1 ────────────────────────────────────────────────
  println("─── Phase 1: 夸克专注度扫描 (" + allChannels.length + " 个频道) ───");
  var done1 = 0;

  return batchRun(allChannels, function(ch) {
    progress("  扫描进度: " + (++done1) + "/" + allChannels.length + "  当前: @" + ch.id);
    return phase1ScanChannel(ch.id);
  }, CONCURRENCY, BATCH_DELAY_MS)
  .then(function(phase1Results) {

    // 筛选夸克候选频道
    var candidates = phase1Results
      .filter(function(r) {
        return r && !r.error &&
               r.quarkRatio >= QUARK_MIN_RATIO &&
               r.quarkCount >= QUARK_MIN_COUNT;
      })
      .sort(function(a, b) { return b.quarkRatio - a.quarkRatio; })
      .slice(0, PHASE2_MAX_CH);

    println("\n");
    println("夸克专注度筛选结果 (比例 ≥ " + (QUARK_MIN_RATIO * 100).toFixed(0) + "%, 链接数 ≥ " + QUARK_MIN_COUNT + "):");
    println("  " + pad("频道", 25) + pad("夸克比例", 10) + pad("夸克链接数", 12) + pad("总链接数", 10) + "发帖密度");
    println("  " + "─".repeat(65));
    if (candidates.length === 0) {
      println("  [!] 未找到符合条件的夸克频道。请适当降低 --quark-ratio 门槛。");
      println("      部分频道扫描出错（如已私有化）属正常。");
    }
    for (var ci = 0; ci < candidates.length; ci++) {
      var r = candidates[ci];
      println("  " + pad("@" + r.channelId, 25) +
        pad((r.quarkRatio * 100).toFixed(0) + "%",  10) +
        pad(r.quarkCount,                            12) +
        pad(r.totalCount,                            10) +
        r.postsPerDay.toFixed(1) + " 帖/天");
    }
    println("  共 " + candidates.length + " 个频道进入 Phase 2");

    if (candidates.length === 0) return;

    // ── Phase 2 ────────────────────────────────────────────────
    println("");
    println("─── Phase 2: 搜索命中率测试 (" + candidates.length + " 频道 × " + TEST_QUERIES.length + " 关键词) ───");

    var phase2Map = {};      // channelId → [{hit, quarkLinks, hitDate}]
    var collectedLinks = {}; // channelId → [url]

    // 每个频道串行，频道内部并发查询（并发3，防 TG 封 IP）
    function processOneChannel(ch) {
      return batchRun(TEST_QUERIES, function(tq) {
        progress("  @" + ch.channelId + " — 「" + tq.q + "」");
        return phase2TestQuery(ch.channelId, tq.q);
      }, 3, 200)
      .then(function(qResults) {
        var allLinks = [];
        for (var qi = 0; qi < qResults.length; qi++) {
          var qr = qResults[qi];
          if (qr && qr.quarkLinks) {
            for (var li = 0; li < qr.quarkLinks.length; li++) allLinks.push(qr.quarkLinks[li]);
          }
        }
        phase2Map[ch.channelId] = qResults;
        collectedLinks[ch.channelId] = allLinks;
        var hitCount = qResults.filter(function(r) { return r && r.hit; }).length;
        println("\n  ✓ @" + pad(ch.channelId, 22) +
          "命中 " + rpad(hitCount, 2) + "/" + TEST_QUERIES.length +
          " 关键词  │  收集夸克链接 " + allLinks.length + " 个");
      });
    }

    // 频道间串行
    var chChain = Promise.resolve();
    for (var ci2 = 0; ci2 < candidates.length; ci2++) {
      (function(ch) {
        chChain = chChain.then(function() { return processOneChannel(ch); });
      })(candidates[ci2]);
    }
    return chChain.then(function() {

      // ── Phase 3 ──────────────────────────────────────────────
      println("");
      println("─── Phase 3: 链接有效率验证 ───");
      println("  (注: 夸克为 SPA，验证准确率约 70-80%，unknown 不计入分母)");

      var phase3Map = {};

      function validateOneChannel(ch) {
        var sample = sampleUnique(collectedLinks[ch.channelId] || [], VALIDATE_SAMPLE);
        var vr = { validCount: 0, invalidCount: 0, unknownCount: 0 };
        if (sample.length === 0) {
          phase3Map[ch.channelId] = vr;
          println("\n  @" + ch.channelId + " — 无可验证链接（命中率为零）");
          return Promise.resolve();
        }
        return batchRun(sample, function(link, si) {
          progress("  @" + ch.channelId + " 验证链接 " + (si+1) + "/" + sample.length + " ...");
          return validateQuarkLink(link);
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
        (function(ch) {
          v3Chain = v3Chain.then(function() { return validateOneChannel(ch); });
        })(candidates[vi]);
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

        println("  " + pad("频道",   24) +
                       rpad("总分",  6) +
                       rpad("A专注", 7) +
                       rpad("B命中", 7) +
                       rpad("C有效", 7) +
                       rpad("D时效", 7) +
                       rpad("E频率", 7));
        println("  " + "─".repeat(65));

        for (var ri = 0; ri < scored.length; ri++) {
          var s = scored[ri];
          var mark = ri < TOP_N ? "★ " : "  ";
          println(mark + pad("@" + s.channelId, 24) +
            rpad(s.score.total.toFixed(1), 6) +
            rpad(s.score.A.toFixed(1), 7) +
            rpad(s.score.B.toFixed(1), 7) +
            rpad(s.score.C.toFixed(1), 7) +
            rpad(s.score.D.toFixed(1), 7) +
            rpad(s.score.E.toFixed(1), 7));
        }

        // ── 最终推荐 ─────────────────────────────────────────
        println("");
        println("══════════════════════════════════════════════════════════");
        println("🏆  夸克网盘推荐频道 Top " + TOP_N + "  (满分 100 分)");
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
          var freshStr = minDaysHit < 9999 ? Math.round(minDaysHit) + "天前最新更新" : "无法确定更新时间";

          println("");
          println("  #" + (ti + 1) + "  @" + ts.channelId + "  ─  " + ts.score.total.toFixed(1) + " 分");
          println("      夸克专注度: " + (ts.p1.quarkRatio * 100).toFixed(0) + "%（夸克/" + ts.p1.totalCount + "条网盘链接）");
          println("      搜索命中:  " + hitCount2 + "/" + TEST_QUERIES.length + " 个关键词");
          println("      链接有效:  " + ts.p3.validCount + " 有效 / " + ts.p3.invalidCount + " 失效 (抽样 " + (ts.p3.validCount + ts.p3.invalidCount + ts.p3.unknownCount) + " 条)");
          println("      时效:      " + freshStr);
          println("      发帖密度:  " + ts.p1.postsPerDay.toFixed(1) + " 帖/天");

          // 命中明细
          var hitDetail = [];
          for (var qi2 = 0; qi2 < TEST_QUERIES.length; qi2++) {
            if (ts.p2[qi2] && ts.p2[qi2].hit) hitDetail.push(TEST_QUERIES[qi2].q);
          }
          if (hitDetail.length > 0) {
            println("      命中片单:  " + hitDetail.join("、"));
          }
        }

        println("");
        println("─────────────────────────────────────────────────────────");
        println("使用建议:");
        println("  1. 将以上频道 ID 加入 channels.json，置于列表前部以提升搜索权重");
        println("  2. 评分满足 Top " + TOP_N + " 但有效率偏低的频道，建议隔月重测");
        println("  3. 本工具仅评估公开可抓取的 t.me/s/ 页面，私有/受限频道无法检测");
        println("  4. TG 搜索有频率限制，若运行失败可降低 --concurrency 参数重试");
        println("══════════════════════════════════════════════════════════");
      });        // closes v3Chain.then (scoring)
    });          // closes chChain.then (phase2+3)
  });            // closes batchRun.then (phase1)
})               // closes fetchTestQueries.then
.catch(function(e) {
  println("\n[错误] " + (e.message || e));
  process.exit(1);
});
}

main();
