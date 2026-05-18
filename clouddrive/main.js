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

// Built-in channel list — guaranteed to work even when channels.json is not deployed
// or is unreachable. A remote channels.json (fetched via $plugin.baseURL) overrides
// this list at runtime when available.
var BUILT_IN_CHANNELS = [
  {"name":"tgsearchers3","id":"tgsearchers3"},
  {"name":"Aliyun_4K_Movies","id":"Aliyun_4K_Movies"},
  {"name":"bdbdndn11","id":"bdbdndn11"},
  {"name":"yunpanx","id":"yunpanx"},
  {"name":"bsbdbfjfjff","id":"bsbdbfjfjff"},
  {"name":"yp123pan","id":"yp123pan"},
  {"name":"sbsbsnsqq","id":"sbsbsnsqq"},
  {"name":"yunpanxunlei","id":"yunpanxunlei"},
  {"name":"tianyifc","id":"tianyifc"},
  {"name":"BaiduCloudDisk","id":"BaiduCloudDisk"},
  {"name":"txtyzy","id":"txtyzy"},
  {"name":"peccxinpd","id":"peccxinpd"},
  {"name":"gotopan","id":"gotopan"},
  {"name":"PanjClub","id":"PanjClub"},
  {"name":"kkxlzy","id":"kkxlzy"},
  {"name":"baicaoZY","id":"baicaoZY"},
  {"name":"MCPH01","id":"MCPH01"},
  {"name":"bdwpzhpd","id":"bdwpzhpd"},
  {"name":"ysxb48","id":"ysxb48"},
  {"name":"jdjdn1111","id":"jdjdn1111"},
  {"name":"yggpan","id":"yggpan"},
  {"name":"MCPH086","id":"MCPH086"},
  {"name":"zaihuayun","id":"zaihuayun"},
  {"name":"Q66Share","id":"Q66Share"},
  {"name":"ucwpzy","id":"ucwpzy"},
  {"name":"shareAliyun","id":"shareAliyun"},
  {"name":"alyp_1","id":"alyp_1"},
  {"name":"dianyingshare","id":"dianyingshare"},
  {"name":"Quark_Movies","id":"Quark_Movies"},
  {"name":"XiangxiuNBB","id":"XiangxiuNBB"},
  {"name":"ydypzyfx","id":"ydypzyfx"},
  {"name":"ucquark","id":"ucquark"},
  {"name":"xx123pan","id":"xx123pan"},
  {"name":"yingshifenxiang123","id":"yingshifenxiang123"},
  {"name":"zyfb123","id":"zyfb123"},
  {"name":"tyypzhpd","id":"tyypzhpd"},
  {"name":"tianyirigeng","id":"tianyirigeng"},
  {"name":"cloudtianyi","id":"cloudtianyi"},
  {"name":"hdhhd21","id":"hdhhd21"},
  {"name":"Lsp115","id":"Lsp115"},
  {"name":"oneonefivewpfx","id":"oneonefivewpfx"},
  {"name":"qixingzhenren","id":"qixingzhenren"},
  {"name":"taoxgzy","id":"taoxgzy"},
  {"name":"Channel_Shares_115","id":"Channel_Shares_115"},
  {"name":"tyysypzypd","id":"tyysypzypd"},
  {"name":"vip115hot","id":"vip115hot"},
  {"name":"wp123zy","id":"wp123zy"},
  {"name":"yunpan139","id":"yunpan139"},
  {"name":"yunpan189","id":"yunpan189"},
  {"name":"yunpanuc","id":"yunpanuc"},
  {"name":"yydf_hzl","id":"yydf_hzl"},
  {"name":"leoziyuan","id":"leoziyuan"},
  {"name":"pikpakpan","id":"pikpakpan"},
  {"name":"Q_dongman","id":"Q_dongman"},
  {"name":"yoyokuakeduanju","id":"yoyokuakeduanju"},
  {"name":"TG654TG","id":"TG654TG"},
  {"name":"WFYSFX02","id":"WFYSFX02"},
  {"name":"QukanMovie","id":"QukanMovie"},
  {"name":"yeqingjie_GJG666","id":"yeqingjie_GJG666"},
  {"name":"movielover8888_film3","id":"movielover8888_film3"},
  {"name":"Baidu_netdisk","id":"Baidu_netdisk"},
  {"name":"D_wusun","id":"D_wusun"},
  {"name":"FLMdongtianfudi","id":"FLMdongtianfudi"},
  {"name":"KaiPanshare","id":"KaiPanshare"},
  {"name":"QQZYDAPP","id":"QQZYDAPP"},
  {"name":"rjyxfx","id":"rjyxfx"},
  {"name":"PikPak_Share_Channel","id":"PikPak_Share_Channel"},
  {"name":"btzhi","id":"btzhi"},
  {"name":"newproductsourcing","id":"newproductsourcing"},
  {"name":"cctv1211","id":"cctv1211"},
  {"name":"duan_ju","id":"duan_ju"},
  {"name":"QuarkFree","id":"QuarkFree"},
  {"name":"yunpanNB","id":"yunpanNB"},
  {"name":"kkdj001","id":"kkdj001"},
  {"name":"xxzlzn","id":"xxzlzn"},
  {"name":"pxyunpanxunlei","id":"pxyunpanxunlei"},
  {"name":"jxwpzy","id":"jxwpzy"},
  {"name":"kuakedongman","id":"kuakedongman"},
  {"name":"liangxingzhinan","id":"liangxingzhinan"},
  {"name":"xiangnikanj","id":"xiangnikanj"},
  {"name":"guoman4K","id":"guoman4K"},
  {"name":"zdqxm","id":"zdqxm"},
  {"name":"kduanju","id":"kduanju"},
  {"name":"cilidianying","id":"cilidianying"},
  {"name":"CBduanju","id":"CBduanju"},
  {"name":"SharePanFilms","id":"SharePanFilms"},
  {"name":"dzsgx","id":"dzsgx"},
  {"name":"BooksRealm","id":"BooksRealm"},
  {"name":"Oscar_4Kmovies","id":"Oscar_4Kmovies"}
];

// ============================================================
// Search: 跨多个 TG 频道并发抓取，匹配网盘链接，归一化为 MediaData
// ============================================================
var _channelsCache = null;     // 默认频道列表（来自 channels.json）
var _channelsCacheTime = 0;

function _loadDefaultChannels(cb) {
  // 24h 命中插件自身缓存：避免每次搜索都拉一次远端 channels.json
  var now = Date.now();
  if (_channelsCache && (now - _channelsCacheTime) < 86400000) {
    _log("Search.defaultChannels.cache", { count: _channelsCache.length });
    cb(_channelsCache);
    return;
  }
  var base = ($plugin && $plugin.baseURL) ? $plugin.baseURL : "";
  if (!base) {
    _log("Search.defaultChannels.noBaseURL", { plugin: typeof $plugin });
    cb([]);
    return;
  }
  var channelsURL = base + "channels.json";
  _log("Search.defaultChannels.fetch", { url: channelsURL });
  $http.fetch({ url: channelsURL, timeout: 10 }).then(function (res) {
    _log("Search.defaultChannels.response", {
      status: res.statusCode,
      bodyLen: (res.body || "").length
    });
    if (res.statusCode && res.statusCode >= 400) {
      _log("Search.defaultChannels.httpError", { status: res.statusCode, url: channelsURL, fallback: BUILT_IN_CHANNELS.length });
      cb(_channelsCache || BUILT_IN_CHANNELS);
      return;
    }
    try {
      var list = JSON.parse(res.body || "[]");
      if (Object.prototype.toString.call(list) !== "[object Array]" || list.length === 0) {
        _log("Search.defaultChannels.remoteEmpty", { fallback: BUILT_IN_CHANNELS.length });
        list = BUILT_IN_CHANNELS;
      }
      _log("Search.defaultChannels.loaded", { count: list.length });
      _channelsCache = list;
      _channelsCacheTime = now;
      cb(list);
    } catch (e) {
      _log("Search.defaultChannels.parseFail", {
        err: String(e),
        bodyHead: (res.body || "").substring(0, 120),
        fallback: BUILT_IN_CHANNELS.length
      });
      cb(_channelsCache || BUILT_IN_CHANNELS);
    }
  }, function (err) {
    _log("Search.defaultChannels.fetchFail", { err: err, url: channelsURL, fallback: BUILT_IN_CHANNELS.length });
    cb(_channelsCache || BUILT_IN_CHANNELS);
  });
}

function _resolveEffectiveChannels(callback) {
  // 默认列表 + 用户覆盖：禁用 ID 过滤掉、追加自定义频道
  _loadDefaultChannels(function (defaults) {
    _log("Search.resolve.defaults", { count: defaults.length });
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
      _log("Search.resolve.effective", {
        defaults: defaults.length,
        disabled: disabledIds.length,
        customs: customs.length,
        total: effective.length
      });
      callback(effective);
    }, function (err) {
      // 覆盖读不到时直接用全量默认
      _log("Search.resolve.overridesFail", { err: err, fallback: defaults.length });
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

function _normalizeChannelId(raw) {
  var id = String(raw || "").trim();
  // Strip @ prefix (e.g. @channelname → channelname)
  if (id.charAt(0) === "@") id = id.substring(1);
  // Strip full t.me URL (https://t.me/channelname or https://t.me/s/channelname)
  var m = id.match(/t\.me\/(?:s\/)?([A-Za-z0-9_]+)/);
  if (m) id = m[1];
  return id;
}

function _fetchChannel(channel, keyword, onComplete) {
  var channelId = _normalizeChannelId(channel.channelId);
  if (!channelId) {
    _log("Search.channel.emptyId", { raw: channel.channelId });
    onComplete([]);
    return;
  }
  var url = "https://t.me/s/" + encodeURIComponent(channelId) +
            "?q=" + encodeURIComponent(keyword);
  _log("Search.channel.fetch", { channel: channelId, url: url });
  $http.fetch({
    url: url,
    method: "GET",
    timeout: SINGLE_CHANNEL_TIMEOUT_SEC,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    }
  }).then(function (res) {
    if (res.statusCode && res.statusCode >= 400) {
      _log("Search.channel.httpError", { channel: channelId, status: res.statusCode });
      onComplete([]);
      return;
    }
    var msgs = parseTGPage(res.body || "");
    var medias = _messagesToMedias(msgs, channel);
    _log("Search.channel.done", {
      channel: channelId,
      status: res.statusCode,
      bodyLen: (res.body || "").length,
      msgs: msgs.length,
      medias: medias.length
    });
    onComplete(medias);
  }, function (err) {
    _log("Search.channel.networkError", { channel: channelId, err: err });
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
  // 二次进入：host 在用户填了提取码后会注入 $userInput；优先用它覆盖原 passcode。
  var effectivePasscode = (typeof $userInput !== "undefined" && $userInput && $userInput.passcode)
    ? String($userInput.passcode)
    : (info.passcode || "");
  _log("Player.parsed", { type: info.type, shareFileId: info.shareFileId, hasUserInput: typeof $userInput !== "undefined" && !!$userInput });
  $cloud.playOrSave({
    cloudType: info.type,
    shareUrl: info.url,
    passcode: effectivePasscode,
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
    var msg = String(err || "");
    _log("Player.error", { err: msg });
    // 检测 locked / 提取码错误 → 请求用户输入；host 会重新调 Player，$userInput 带值
    var alreadyTried = typeof $userInput !== "undefined" && $userInput && $userInput.passcode;
    var looksLocked = msg.indexOf("提取码") >= 0 || msg.indexOf("密码") >= 0 ||
                      msg.indexOf("41010") >= 0 || msg.indexOf("41008") >= 0;
    if (looksLocked && !alreadyTried) {
      $next.requestUserInput({
        title: "此分享需要提取码",
        message: msg,
        fields: [
          { key: "passcode", label: "提取码", placeholder: "通常 4 位", kind: "text", required: true }
        ],
        confirmLabel: "解锁播放"
      });
      return;
    }
    if (looksLocked && alreadyTried) {
      $next.emptyView("提取码错误，请重试");
      return;
    }
    $next.emptyView("播放失败: " + msg);
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
