// CloudDrive 网盘聚合插件
// 流程：搜 TG 公开频道 -> 正则识别网盘链接 -> 用户点击 -> 原生层转存+解析直链 -> 播放
//
// 关键约束（来自 SKILL.md）：
// - JavaScriptCore，无 fetch / no XMLHttpRequest / no Promise.all
// - 仅用 $http.fetch / $next.* / $cloud.*
// - 不要在 if/for 块里 function 声明
// - 永不传 undefined/null 给 $next 方法

var DEBUG = true;
function _log(label, params) {
  if (!DEBUG) return;
  try { console.log("[clouddrive:" + label + "] " + JSON.stringify(params || {})); } catch (e) {}
}

var SINGLE_CHANNEL_TIMEOUT_SEC = 10;

// ============================================================
// Search: 跨多个 TG 频道并发抓取，匹配网盘链接，归一化为 MediaData
// ============================================================
var _channelsCache = null;     // 默认频道列表（来自 channels.json）
var _channelsCacheTime = 0;

function _loadDefaultChannels(cb) {
  // 24h 命中插件自身缓存：避免每次搜索都拉一次远端 channels.json
  var now = Date.now();
  if (_channelsCache && (now - _channelsCacheTime) < 86400000) {
    cb(_channelsCache);
    return;
  }
  var base = ($plugin && $plugin.baseURL) ? $plugin.baseURL : "";
  if (!base) {
    cb([]);
    return;
  }
  $http.fetch({ url: base + "channels.json", timeout: 10 }).then(function (res) {
    try {
      var list = JSON.parse(res.body || "[]");
      if (Object.prototype.toString.call(list) !== "[object Array]") list = [];
      _channelsCache = list;
      _channelsCacheTime = now;
      cb(list);
    } catch (e) {
      _log("Search.defaultsParseFail", { err: String(e) });
      cb(_channelsCache || []);
    }
  }, function (err) {
    _log("Search.defaultsFetchFail", { err: err });
    cb(_channelsCache || []);
  });
}

function _resolveEffectiveChannels(callback) {
  // 默认列表 + 用户覆盖：禁用 ID 过滤掉、追加自定义频道
  _loadDefaultChannels(function (defaults) {
    $cloud.getChannelOverrides().then(function (ov) {
      var disabled = {};
      var disabledIds = (ov && ov.disabledDefaultIds) || [];
      for (var i = 0; i < disabledIds.length; i++) disabled[disabledIds[i]] = true;
      var effective = [];
      for (var j = 0; j < defaults.length; j++) {
        var d = defaults[j];
        if (disabled[d.id]) continue;
        effective.push({ source: "telegram", channelId: d.id, displayName: d.name || d.id });
      }
      var customs = (ov && ov.customChannels) || [];
      for (var k = 0; k < customs.length; k++) {
        var c = customs[k];
        // 防止 custom 与 default 重名
        if (disabled[c.channelId]) continue;
        effective.push(c);
      }
      callback(effective);
    }, function () {
      // 覆盖读不到时直接用全量默认
      var fallback = [];
      for (var m = 0; m < defaults.length; m++) {
        fallback.push({ source: "telegram", channelId: defaults[m].id, displayName: defaults[m].name || defaults[m].id });
      }
      callback(fallback);
    });
  });
}

function Search(inputURL, key) {
  _log("Search.start", { inputURL: inputURL, key: key });

  _resolveEffectiveChannels(function (channels) {
    if (!channels || channels.length === 0) {
      $next.emptyView("没有可用搜索频道（默认列表为空，且没有自定义频道）");
      return;
    }
    var keyword = _extractKeyword(inputURL);
    if (!keyword) {
      $next.toSearchMedias(JSON.stringify([]), String(key || ""));
      return;
    }

    var done = 0;
    var collected = [];
    var total = channels.length;

    var tryEmit = function () {
      done++;
      if (done < total) return;
      var dedup = _dedupeByCloudURL(collected);
      _validateAndEmit(dedup, key, keyword);
    };

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      _fetchChannel(ch, keyword, function (items) {
        for (var j = 0; j < items.length; j++) collected.push(items[j]);
        tryEmit();
      });
    }
  });
}

function _extractKeyword(inputURL) {
  if (!inputURL) return "";
  var m = String(inputURL).match(/[?&]keyword=([^&]+)/);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

function _fetchChannel(channel, keyword, onComplete) {
  var url = "https://t.me/s/" + encodeURIComponent(channel.channelId) +
            "?q=" + encodeURIComponent(keyword);
  $http.fetch({
    url: url,
    method: "GET",
    timeout: SINGLE_CHANNEL_TIMEOUT_SEC,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Lumen/1.0",
      "Accept": "text/html,application/xhtml+xml"
    }
  }).then(function (res) {
    var medias = _messagesToMedias(parseTGPage(res.body || ""), channel);
    onComplete(medias);
  }, function (err) {
    _log("Search.channelError", { channel: channel.channelId, err: err });
    onComplete([]);
  });
}

function _messagesToMedias(messages, channel) {
  var out = [];
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    // 噪声预过滤：无发布时间 + 无标签的消息通常是置顶公告 / 频道介绍 / 广告
    if (!msg.pubDate && (!msg.tags || msg.tags.length === 0)) continue;
    var links = extractCloudLinks(msg.text);
    if (links.length === 0) continue;
    var passcode = extractPasscode(msg.text) || "";
    for (var k = 0; k < links.length; k++) {
      var link = links[k];
      out.push(_buildMedia(msg, link, passcode, channel));
    }
  }
  return out;
}

function _buildMedia(msg, link, passcode, channel) {
  var title = msg.title || ("分享 " + msg.messageId);
  var desc = (msg.pubDate || "") + " · " + link.type + (channel ? (" · " + (channel.displayName || channel.channelId)) : "");
  var detail = "clouddrive://share?type=" + encodeURIComponent(link.type) +
               "&url=" + encodeURIComponent(link.url) +
               "&passcode=" + encodeURIComponent(passcode || "") +
               "&title=" + encodeURIComponent(title);
  var media = {
    id: link.type + ":" + msg.messageId + ":" + _hashStr(link.url),
    title: title,
    coverURLString: msg.image || "",
    descriptionText: desc,
    detailURLString: detail
  };
  // 非标准字段，仅 JS 内部排序使用，Lumen MediaData 解码会忽略未知字段
  media._pubDate = msg.pubDate || "";
  media._shareUrl = link.url;
  return media;
}

function _hashStr(s) {
  if (!s) return "0";
  var h = 0;
  for (var i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

function _dedupeByCloudURL(items) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (seen[it.id]) continue;
    seen[it.id] = true;
    out.push(it);
  }
  return out;
}

function _extractShareReq(media) {
  // Parses {type, url, passcode} back out of detailURLString = "clouddrive://share?type=...&url=...&passcode=..."
  var d = media && media.detailURLString;
  if (!d || d.indexOf("clouddrive://share") !== 0) return null;
  var t = _qs(d, "type");
  var u = _qs(d, "url");
  if (!t || !u) return null;
  return { cloudType: t, shareUrl: u, passcode: _qs(d, "passcode") };
}

function _validateAndEmit(medias, key, keyword) {
  if (!medias || medias.length === 0) {
    _log("Search.emit", { count: 0 });
    $next.toSearchMedias("[]", String(key || ""));
    return;
  }
  var kw = String(keyword || "").toLowerCase();
  // Build dedup'd validation requests
  var seen = {};
  var reqs = [];
  for (var i = 0; i < medias.length; i++) {
    var r = _extractShareReq(medias[i]);
    if (!r || seen[r.shareUrl]) continue;
    seen[r.shareUrl] = true;
    reqs.push(r);
  }
  if (reqs.length === 0) {
    var rankedRaw = _rankMedias(medias, kw);
    _log("Search.emit", { count: rankedRaw.length, validated: 0 });
    $next.toSearchMedias(JSON.stringify(rankedRaw), String(key || ""));
    return;
  }
  _log("Search.validate.begin", { unique: reqs.length, totalCards: medias.length });
  $cloud.validateShares(reqs).then(function (results) {
    // state: ok / bad / locked / uncertain
    var stateByUrl = {};
    var badCount = 0, lockedCount = 0;
    for (var j = 0; j < results.length; j++) {
      var r = results[j];
      var st = r.state || (r.isValid === false ? "bad" : "ok");
      stateByUrl[r.shareUrl] = st;
      if (st === "bad") badCount++;
      else if (st === "locked") lockedCount++;
    }
    var kept = [];
    for (var k = 0; k < medias.length; k++) {
      var req2 = _extractShareReq(medias[k]);
      if (!req2) { kept.push(medias[k]); continue; }
      var s = stateByUrl[req2.shareUrl];
      if (s === "bad") continue;                 // 明确失效 → 丢
      if (s === "locked") {                      // 需提取码 → 保留，加锁标记
        var m = medias[k];
        if (m.title.indexOf("🔒") !== 0) m.title = "🔒 " + m.title;
        m.descriptionText = (m.descriptionText || "") + " · 需提取码";
        kept.push(m);
      } else {
        kept.push(medias[k]);                   // ok / uncertain / unknown → 保留
      }
    }
    var ranked = _rankMedias(kept, kw);
    _log("Search.emit", {
      count: ranked.length,
      droppedBad: badCount,
      keptLocked: lockedCount,
      totalIn: medias.length
    });
    $next.toSearchMedias(JSON.stringify(ranked), String(key || ""));
  }, function (err) {
    // Validation failed entirely — fall back to emitting unvalidated (don't punish the user).
    _log("Search.validate.error", { err: err, fallbackCount: medias.length });
    $next.toSearchMedias(JSON.stringify(medias), String(key || ""));
  });
}

// ============================================================
// Ranking: time + keyword-in-title + (channel weight reserved)
// 借鉴 fish2018/pansou 的三维加权
// ============================================================
function _rankMedias(medias, keywordLower) {
  if (!medias || medias.length === 0) return medias;
  var nowSec = Math.floor(Date.now() / 1000);
  var kw = String(keywordLower || "").toLowerCase().trim();
  // 装饰 → 排序 → 还原
  var decorated = [];
  for (var i = 0; i < medias.length; i++) {
    decorated.push({ media: medias[i], score: _scoreMedia(medias[i], kw, nowSec), originalIdx: i });
  }
  decorated.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIdx - b.originalIdx;
  });
  var out = [];
  for (var j = 0; j < decorated.length; j++) out.push(decorated[j].media);
  return out;
}

function _scoreMedia(media, keywordLower, nowSec) {
  var score = 0;
  var title = String(media.title || "").toLowerCase();

  // 关键词分（前部匹配 / 出现次数）
  if (keywordLower.length > 0) {
    var idx = title.indexOf(keywordLower);
    if (idx >= 0) {
      score += 10;
      if (idx <= 5) score += 5;              // 标题前部命中
    }
    // 命中次数（粗略）
    var rest = title;
    var hits = 0;
    while (rest.length > 0) {
      var p = rest.indexOf(keywordLower);
      if (p < 0) break;
      hits++;
      rest = rest.substring(p + keywordLower.length);
    }
    if (hits > 1) score += Math.min(hits - 1, 3) * 2;
  }

  // 时间分（最近 7 天内每天 -2 分；超过 7 天衰减为常数 0）
  var pubSec = _parseISODateSec(media._pubDate || "");
  if (pubSec > 0) {
    var ageDays = (nowSec - pubSec) / 86400;
    if (ageDays < 0) ageDays = 0;
    score += Math.max(0, 14 - ageDays * 2);
  }

  // 锁定卡片轻微降权（用户更想要无密的）
  if (String(media.title || "").indexOf("🔒") === 0) score -= 4;

  return score;
}

function _parseISODateSec(s) {
  if (!s) return 0;
  var d = new Date(s);
  var t = d.getTime();
  if (isNaN(t)) return 0;
  return Math.floor(t / 1000);
}

// ============================================================
// Episodes: 调 $cloud.listShareFiles 递归列分享内所有视频文件，每个文件成为一集
// 单文件分享时退化为只有一项的列表
// ============================================================
function Episodes(inputURL, _key) {
  _log("Episodes.start", { inputURL: inputURL });
  var info = _parseShareURL(inputURL);
  if (!info) {
    $next.emptyView("无效的分享链接参数");
    return;
  }
  $cloud.listShareFiles({
    cloudType: info.type,
    shareUrl: info.url,
    passcode: info.passcode || ""
  }).then(function (files) {
    if (!files || files.length === 0) {
      $next.emptyView("分享内未找到可播放的视频文件");
      return;
    }
    var sorted = files.slice().sort(function (a, b) {
      return String(a.path || a.name).localeCompare(String(b.path || b.name));
    });
    var eps = [];
    for (var i = 0; i < sorted.length; i++) {
      var f = sorted[i];
      var displayTitle = _prettyEpisodeTitle(f.name, i + 1);
      var perEpisodeTitle = (info.title || "") + " · " + displayTitle;
      var playURL = "clouddrive://play?type=" + encodeURIComponent(info.type) +
                    "&shareUrl=" + encodeURIComponent(info.url) +
                    "&passcode=" + encodeURIComponent(info.passcode || "") +
                    "&shareFileId=" + encodeURIComponent(f.fileId) +
                    "&shareFidToken=" + encodeURIComponent(f.shareFidToken || "") +
                    "&title=" + encodeURIComponent(perEpisodeTitle);
      eps.push({
        id: f.fileId,
        title: displayTitle,
        episodeDetailURL: playURL
      });
    }
    _log("Episodes.emit", { count: eps.length });
    $next.toEpisodes(JSON.stringify(eps));
  }, function (err) {
    _log("Episodes.error", { err: err });
    $next.emptyView("无法读取分享内容: " + err);
  });
}

function _prettyEpisodeTitle(name, fallbackIndex) {
  if (!name) return "第 " + fallbackIndex + " 集";
  var trimmed = String(name).replace(/\.[A-Za-z0-9]{2,5}$/, "");
  var m = trimmed.match(/S(\d{1,2})E(\d{1,3})/i);
  if (m) return "S" + m[1].padStart(2, "0") + "E" + m[2].padStart(2, "0");
  var n = trimmed.match(/(\d{1,3})/);
  if (n) return "第 " + parseInt(n[1], 10) + " 集";
  return trimmed;
}

function _parseShareURL(url) {
  if (!url || url.indexOf("clouddrive://share") !== 0) return null;
  return {
    type:     _qs(url, "type"),
    url:      _qs(url, "url"),
    passcode: _qs(url, "passcode"),
    title:    _qs(url, "title")
  };
}

function _qs(url, name) {
  var re = new RegExp("[?&]" + name + "=([^&]*)");
  var m = url.match(re);
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

// ============================================================
// Player: 调原生 $cloud.playOrSave 完成转存（首次）+ 解直链
// ============================================================
function Player(inputURL, _key) {
  _log("Player.start", { inputURL: inputURL });
  var info = _parsePlayURL(inputURL);
  if (!info) {
    _log("Player.invalidParam", { inputURL: inputURL });
    $next.emptyView("无效的播放参数");
    return;
  }
  _log("Player.parsed", info);
  $cloud.playOrSave({
    cloudType: info.type,
    shareUrl: info.url,
    passcode: info.passcode || "",
    title: info.title || "",
    shareFileId: info.shareFileId || "",
    shareFidToken: info.shareFidToken || ""
  }).then(function (play) {
    if (!play || !play.url) {
      $next.emptyView("未能解析出播放地址");
      return;
    }
    var payload = {
      url: play.url,
      headers: play.headers || {},
      cookies: play.cookies || {},
      cookieDomain: play.cookieDomain || ""
    };
    _log("Player.resolved", { url: payload.url });
    $next.toPlayerByJSON(JSON.stringify(payload));
  }, function (err) {
    _log("Player.error", { err: err });
    $next.emptyView("播放失败: " + err);
  });
}

function _parsePlayURL(url) {
  if (!url || url.indexOf("clouddrive://play") !== 0) return null;
  return {
    type:          _qs(url, "type"),
    url:           _qs(url, "shareUrl"),
    passcode:      _qs(url, "passcode"),
    title:         _qs(url, "title"),
    shareFileId:   _qs(url, "shareFileId"),
    shareFidToken: _qs(url, "shareFidToken")
  };
}

// ============================================================
// MyCloud: 我的网盘 page — 展示已转存的文件列表
// ============================================================
function MyCloud(inputURL, key) {
  _log("MyCloud.start", { inputURL: inputURL });
  var cloudType = _qs(inputURL, "type") || "quark";
  $cloud.listSavedFiles({ cloudType: cloudType }).then(function (files) {
    if (!files || files.length === 0) {
      $next.toMedias(JSON.stringify([]), String(key || ""));
      return;
    }
    var medias = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var playURL = "clouddrive://playFile?type=" + encodeURIComponent(f.cloudType) +
                    "&fileId=" + encodeURIComponent(f.cloudFileId) +
                    "&title=" + encodeURIComponent(f.title || "");
      medias.push({
        id: f.id,
        title: f.title || "未命名",
        coverURLString: "",
        descriptionText: f.cloudType + " · 已转存",
        detailURLString: playURL
      });
    }
    $next.toMedias(JSON.stringify(medias), String(key || ""));
  }, function (err) {
    _log("MyCloud.error", { err: err });
    $next.emptyView("无法读取已转存清单: " + err);
  });
}
