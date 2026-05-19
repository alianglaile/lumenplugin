#!/usr/bin/env node
// Local ranking evaluator for the CloudDrive plugin.
// It reuses the plugin parser/scorer, fetches Telegram search pages, and prints
// score breakdowns for a small query set.
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var https = require("https");

var ROOT = __dirname;
var DEFAULT_QUERIES = ["雨霖铃", "低智商犯罪", "世界的主人", "哪吒之魔童闹海"];
var DEFAULT_CHANNEL_FILE = fs.existsSync(path.join(ROOT, "channels_quark.json"))
  ? "channels_quark.json"
  : "channels.json";

function getArg(name, defaultVal) {
  var prefix = "--" + name + "=";
  for (var i = 0; i < process.argv.length; i++) {
    if (process.argv[i].indexOf(prefix) === 0) {
      var raw = process.argv[i].slice(prefix.length);
      return typeof defaultVal === "number" ? parseInt(raw, 10) : raw;
    }
  }
  return defaultVal;
}

var channelFile = getArg("channels", DEFAULT_CHANNEL_FILE);
var topN = getArg("top", 6);
var timeoutMs = getArg("timeout", 12000);
var queryArg = getArg("queries", "");
var queries = queryArg ? queryArg.split(",").map(function (q) { return q.trim(); }).filter(Boolean) : DEFAULT_QUERIES;

function loadPluginContext() {
  var context = {
    console: console,
    Date: Date,
    Math: Math,
    String: String,
    Number: Number,
    Object: Object,
    Array: Array,
    RegExp: RegExp,
    JSON: JSON,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    $plugin: { baseURL: "" },
    $http: { fetch: function () { throw new Error("$http unavailable in eval"); } },
    $next: {},
    $cloud: {}
  };
  vm.createContext(context);
  ["cloudPatterns.js", "tgParser.js", "main.js"].forEach(function (file) {
    var source = fs.readFileSync(path.join(ROOT, file), "utf8");
    vm.runInContext(source, context, { filename: file });
  });
  context.DEBUG = false;
  return context;
}

function loadChannels() {
  var filePath = path.join(ROOT, channelFile);
  var list = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return list.map(function (ch) {
    return { source: "telegram", channelId: ch.id || ch.channelId, displayName: ch.name || ch.displayName || ch.id };
  });
}

var BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function httpGet(targetUrl) {
  return new Promise(function (resolve) {
    var parsed = new URL(targetUrl);
    var req = https.request({
      hostname: parsed.hostname,
      path: (parsed.pathname || "/") + (parsed.search || ""),
      method: "GET",
      timeout: timeoutMs,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    }, function (res) {
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", function (err) { resolve({ statusCode: 0, body: "", error: err.message }); });
    req.on("timeout", function () {
      req.destroy();
      resolve({ statusCode: 0, body: "", error: "timeout" });
    });
    req.end();
  });
}

function fetchChannel(context, channel, query) {
  var id = context._normalizeChannelId(channel.channelId);
  var url = "https://t.me/s/" + encodeURIComponent(id) + "?q=" + encodeURIComponent(query);
  return httpGet(url).then(function (res) {
    if (!res.statusCode || res.statusCode >= 400) {
      return { channel: id, statusCode: res.statusCode, error: res.error || "", items: [] };
    }
    var messages = context.parseTGPage(res.body || "");
    var items = context._messagesToMedias(messages, channel);
    return { channel: id, statusCode: res.statusCode, error: "", items: items };
  });
}

function runQuery(context, channels, query) {
  var chain = Promise.resolve([]);
  channels.forEach(function (channel) {
    chain = chain.then(function (all) {
      return fetchChannel(context, channel, query).then(function (result) {
        process.stdout.write("  @" + result.channel + " status=" + result.statusCode + " hits=" + result.items.length + (result.error ? " err=" + result.error : "") + "\n");
        return all.concat(result.items);
      });
    });
  });
  return chain.then(function (items) {
    var deduped = context._dedupeByCloudURL(items);
    var rankable = context._filterRankableMedias(deduped, query.toLowerCase());
    var ranked = context._limitSearchResults(context._rankMedias(rankable, query.toLowerCase()));
    var nowSec = Math.floor(Date.now() / 1000);
    return { raw: items.length, deduped: deduped.length, rankable: rankable.length, ranked: ranked, nowSec: nowSec };
  });
}

function compactTitle(s) {
  return String(s || "").replace(/\s+/g, " ").slice(0, 96);
}

function printQueryResult(context, query, result) {
  console.log("\n=== " + query + " ===");
  console.log("raw=" + result.raw + " deduped=" + result.deduped + " rankable=" + result.rankable + " ranked=" + result.ranked.length);
  var limit = Math.min(topN, result.ranked.length);
  for (var i = 0; i < limit; i++) {
    var media = result.ranked[i];
    var score = context._scoreMediaBreakdown(media, query.toLowerCase(), result.nowSec);
    console.log(
      "#" + (i + 1) +
      " total=" + score.total +
      " kw=" + score.keyword +
      " src=" + score.source +
      " time=" + score.time +
      " res=" + score.resource +
      " q=" + score.quality +
      " pen=" + score.penalty +
      " @" + (media._channelId || "?") +
      " " + (media._pubDate || "") +
      " " + compactTitle(media.title)
    );
  }
}

function main() {
  var context = loadPluginContext();
  var channels = loadChannels();
  console.log("CloudDrive ranking eval");
  console.log("channels=" + channelFile + " count=" + channels.length + " queries=" + queries.join(", "));

  var chain = Promise.resolve();
  queries.forEach(function (query) {
    chain = chain.then(function () {
      return runQuery(context, channels, query).then(function (result) {
        printQueryResult(context, query, result);
      });
    });
  });
  chain.catch(function (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}

main();
