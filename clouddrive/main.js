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

var SINGLE_CHANNEL_TIMEOUT_SEC = 5;
var SEARCH_RESULT_LIMIT = 6;
var SEARCH_CHANNEL_LIMIT = 8;
var SEARCH_MIN_COMPLETED_CHANNELS = 4;

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

// Per-cloud-type optimized channel lists. Keep these small, but include channels
// that improve title coverage for real searches in addition to raw hit volume.
var BUILT_IN_BY_TYPE = {
  "quark": [
    {"name":"leoziyuan","id":"leoziyuan"},
    {"name":"Quark_Movies","id":"Quark_Movies"},
    {"name":"baicaoZY","id":"baicaoZY"},
    {"name":"ucquark","id":"ucquark"}
  ]
};

// ============================================================
// Search: 跨多个 TG 频道并发抓取，匹配网盘链接，归一化为 MediaData
// ============================================================
var _channelsCache = null;     // 全量频道列表缓存（channels.json）
var _channelsCacheTime = 0;
var _typeChannelsCache = null;     // 按云盘类型筛选的优选频道缓存
var _typeChannelsCacheKey = "";
var _typeChannelsCacheTime = 0;

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

// _loadChannelsForTypes: fetch per-cloud-type channel files and merge them.
// Falls back to _loadDefaultChannels if no recognised type files exist.
function _loadChannelsForTypes(types, cb) {
  var sortedTypes = types.slice().sort();
  var cacheKey = sortedTypes.join(",");
  var now = Date.now();
  if (_typeChannelsCache && _typeChannelsCacheKey === cacheKey && (now - _typeChannelsCacheTime) < 86400000) {
    _log("Search.typeChannels.cache", { key: cacheKey, count: _typeChannelsCache.length });
    cb(_typeChannelsCache);
    return;
  }
  var TYPE_FILE_MAP = {
    "quark":    "channels_quark.json",
    "cloud115": "channels_115.json",
    "aliyun":   "channels_aliyun.json",
    "pan123":   "channels_pan123.json",
    "tianyi":   "channels_tianyi.json",
    "pikpak":   "channels_pikpak.json"
  };
  var filesToFetch = [];
  for (var i = 0; i < sortedTypes.length; i++) {
    var f = TYPE_FILE_MAP[sortedTypes[i]];
    if (f) filesToFetch.push(f);
  }
  if (filesToFetch.length === 0) {
    _loadDefaultChannels(cb);
    return;
  }
  var base = ($plugin && $plugin.baseURL) ? $plugin.baseURL : "";
  if (!base) {
    cb(_builtInForTypes(sortedTypes));
    return;
  }
  var done = 0;
  var allChannels = [];
  var seenIds = {};
  var addList = function (list) {
    if (Object.prototype.toString.call(list) !== "[object Array]") return;
    for (var ii = 0; ii < list.length; ii++) {
      var ch = list[ii];
      if (ch && ch.id && !seenIds[ch.id]) {
        seenIds[ch.id] = true;
        allChannels.push(ch);
      }
    }
  };
  var checkDone = function () {
    done++;
    if (done < filesToFetch.length) return;
    if (allChannels.length === 0) {
      _log("Search.typeChannels.allFailed", { types: sortedTypes });
      cb(_builtInForTypes(sortedTypes));
    } else {
      _typeChannelsCache = allChannels;
      _typeChannelsCacheKey = cacheKey;
      _typeChannelsCacheTime = Date.now();
      _log("Search.typeChannels.loaded", { key: cacheKey, count: allChannels.length });
      cb(allChannels);
    }
  };
  for (var j = 0; j < filesToFetch.length; j++) {
    (function (filename) {
      var url = base + filename;
      _log("Search.typeChannels.fetch", { url: url });
      $http.fetch({ url: url, timeout: 10 }).then(function (res) {
        if (!res.statusCode || res.statusCode < 400) {
          try { addList(JSON.parse(res.body || "[]")); } catch (e) {}
        }
        checkDone();
      }, function () {
        checkDone();
      });
    })(filesToFetch[j]);
  }
}

function _builtInForTypes(types) {
  var result = [];
  var seenIds = {};
  for (var i = 0; i < types.length; i++) {
    var list = BUILT_IN_BY_TYPE[types[i]];
    if (!list) continue;
    for (var j = 0; j < list.length; j++) {
      if (!seenIds[list[j].id]) {
        seenIds[list[j].id] = true;
        result.push(list[j]);
      }
    }
  }
  return result.length > 0 ? result : BUILT_IN_CHANNELS;
}

// _applyOverrides: apply user-level disable/custom overrides on top of a defaults list.
function _applyOverrides(defaults, callback) {
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
    _log("Search.resolve.overridesFail", { err: err, fallback: defaults.length });
    var fallback = [];
    for (var m = 0; m < defaults.length; m++) {
      fallback.push({ source: "telegram", channelId: defaults[m].id, displayName: defaults[m].name || defaults[m].id });
    }
    callback(fallback);
  });
}

function _resolveEffectiveChannels(callback) {
  // 查询用户已配置的云盘类型，仅加载对应的优选频道文件
  $cloud.listAvailableClouds().then(function (clouds) {
    var types = [];
    var seenTypes = {};
    for (var i = 0; i < (clouds || []).length; i++) {
      var entry = clouds[i];
      var ct = (entry && typeof entry === "object")
        ? (entry.cloudType || entry.type || "")
        : String(entry || "");
      if (ct && !seenTypes[ct]) {
        seenTypes[ct] = true;
        types.push(ct);
      }
    }
    _log("Search.resolve.availableClouds", { types: types });
    if (types.length === 0) {
      callback([], {}, "请先在网盘设置中登录至少一个网盘账号，才能搜索可播放资源");
      return;
    }
    var allowedCloudTypes = {};
    for (var j = 0; j < types.length; j++) allowedCloudTypes[types[j]] = true;
    _loadChannelsForTypes(types, function (defaults) {
      _applyOverrides(defaults, function (effective) {
        callback(effective, allowedCloudTypes, "");
      });
    });
  }, function (err) {
    // listAvailableClouds 不支持或失败 → 降级为全量频道
    _log("Search.resolve.listCloudsError", { err: err });
    _loadDefaultChannels(function (defaults) {
      _applyOverrides(defaults, function (effective) {
        callback(effective, null, "");
      });
    });
  });
}

function Search(inputURL, key) {
  _log("Search.start", { inputURL: inputURL, key: key });

  _resolveEffectiveChannels(function (channels, allowedCloudTypes, emptyMessage) {
    if (!channels || channels.length === 0) {
      $next.emptyView(emptyMessage || "没有可用搜索频道（默认列表为空，且没有自定义频道）");
      return;
    }
    var keyword = _extractKeyword(inputURL);
    if (!keyword) {
      $next.toSearchMedias(JSON.stringify([]), String(key || ""));
      return;
    }

    channels = _prepareSearchChannels(channels);

    var done = 0;
    var emitted = false;
    var collected = [];
    var total = channels.length;

    var emitCollected = function () {
      if (emitted) return;
      emitted = true;
      var dedup = _dedupeByCloudURL(collected);
      _validateAndEmit(dedup, key, keyword);
    };

    var tryEmit = function (items) {
      if (emitted) return;
      for (var j = 0; j < items.length; j++) collected.push(items[j]);
      done++;
      var minCompleted = Math.min(SEARCH_MIN_COMPLETED_CHANNELS, total);
      var rankableCount = _filterRankableMedias(collected, String(keyword || "").toLowerCase()).length;
      if (done >= minCompleted && rankableCount >= SEARCH_RESULT_LIMIT) {
        _log("Search.earlyEmit", { done: done, total: total, collected: collected.length, rankable: rankableCount });
        emitCollected();
        return;
      }
      if (done >= total) emitCollected();
    };

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      _fetchChannel(ch, keyword, allowedCloudTypes, function (items) {
        tryEmit(items || []);
      });
    }
  });
}

function _prepareSearchChannels(channels) {
  if (!channels || channels.length === 0) return [];
  var decorated = [];
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i] || {};
    var id = _normalizeChannelId(ch.channelId || ch.id || "");
    var isCustom = ch.source && ch.source !== "telegram" ? 1 : 0;
    decorated.push({
      channel: ch,
      idx: i,
      custom: isCustom,
      priority: _channelSearchPriority(id)
    });
  }
  decorated.sort(function (a, b) {
    if (b.custom !== a.custom) return b.custom - a.custom;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.idx - b.idx;
  });
  var limited = [];
  var max = Math.min(SEARCH_CHANNEL_LIMIT, decorated.length);
  for (var j = 0; j < max; j++) limited.push(decorated[j].channel);
  _log("Search.channels.selected", {
    total: channels.length,
    selected: limited.length,
    ids: limited.map(function (c) { return _normalizeChannelId(c.channelId || c.id || ""); })
  });
  return limited;
}

function _channelSearchPriority(channelId) {
  if (!channelId) return 0;
  var direct = RANK_SOURCE_WEIGHTS[channelId];
  if (direct !== undefined) return direct;
  return 0;
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

function _fetchChannel(channel, keyword, allowedCloudTypes, onComplete) {
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
    var medias = _messagesToMedias(msgs, channel, allowedCloudTypes);
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

function _messagesToMedias(messages, channel, allowedCloudTypes) {
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
      if (!_isCloudTypeAllowedForSearch(link.type, allowedCloudTypes)) continue;
      out.push(_buildMedia(msg, link, passcode, channel));
    }
  }
  return out;
}

function _isCloudTypeAllowedForSearch(type, allowedCloudTypes) {
  // null means the host could not report credentials; keep legacy behavior.
  if (!allowedCloudTypes) return true;
  return allowedCloudTypes[String(type || "")] === true;
}

function _buildMedia(msg, link, passcode, channel) {
  var title = msg.title || ("分享 " + msg.messageId);
  var epHint = _extractEpisodeHint(title);
  var desc = (msg.pubDate || "") + " · " + link.type +
             (epHint ? (" · " + epHint) : "") +
             (channel ? (" · " + (channel.displayName || channel.channelId)) : "");
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
  media._cloudType = link.type;
  media._channelId = channel ? _normalizeChannelId(channel.channelId) : "";
  media._channelName = channel ? String(channel.displayName || channel.channelId || "") : "";
  media._rawText = msg.text || "";
  return media;
}

function _extractEpisodeHint(title) {
  if (!title) return "";
  var t = title.toLowerCase();
  if (/合集|全集|完整版/.test(t)) return "全集";
  if (/完结|大结局/.test(t)) return "完结";
  var m = t.match(/(?:第?\s*0*(\d+)\s*[-~至到]\s*0*(\d+)\s*集)|(?:[全共]\s*0*(\d+)\s*集)/);
  if (m) {
    var count = 0;
    if (m[1] && m[2]) count = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    else if (m[3])     count = parseInt(m[3], 10);
    if (count > 0) return "共" + count + "集";
  }
  var updateNo = _extractUpdateEpisodeNumber(t);
  if (updateNo > 0) return "更新至第" + updateNo + "集";
  return "";
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
  var rankable = _filterRankableMedias(medias, kw);
  var ranked = _rankMedias(rankable, kw);
  var diversified = _dedupeNearDuplicateResults(ranked, kw);
  var limited = _limitSearchResults(diversified);
  _log("Search.emit", {
    count: limited.length,
    droppedWeak: medias.length - rankable.length,
    droppedDupes: ranked.length - diversified.length,
    totalIn: medias.length,
    validation: "skipped_for_fast_search"
  });
  $next.toSearchMedias(JSON.stringify(limited), String(key || ""));
}

// ============================================================
// Ranking: keyword relevance + source quality + time freshness + resource quality.
// 参考 PanSou 的确定性打分：先确保搜索词强相关，再用频道质量、时间、合集/完结/画质校正。
// ============================================================
var RANK_SOURCE_WEIGHTS = {
  "leoziyuan": 180,
  "Quark_Movies": 160,
  "baicaoZY": 140,
  "ucquark": 115,
  "Oscar_4Kmovies": 120,
  "SharePanFilms": 105,
  "Aliyun_4K_Movies": 90,
  "TG654TG": 80,
  "WFYSFX02": 80,
  "QukanMovie": 75
};

function _rankMedias(medias, keywordLower) {
  if (!medias || medias.length === 0) return medias;
  var nowSec = Math.floor(Date.now() / 1000);
  var kw = String(keywordLower || "").toLowerCase().trim();
  var decorated = [];
  for (var i = 0; i < medias.length; i++) {
    decorated.push({ media: medias[i], score: _scoreMediaBreakdown(medias[i], kw, nowSec), originalIdx: i });
  }
  decorated.sort(function (a, b) {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    if (b.score.keyword !== a.score.keyword) return b.score.keyword - a.score.keyword;
    if (b.score.resource !== a.score.resource) return b.score.resource - a.score.resource;
    if (b.score.time !== a.score.time) return b.score.time - a.score.time;
    if (b.score.source !== a.score.source) return b.score.source - a.score.source;
    if (b.score.quality !== a.score.quality) return b.score.quality - a.score.quality;
    return a.originalIdx - b.originalIdx;
  });
  var out = [];
  for (var j = 0; j < decorated.length; j++) out.push(decorated[j].media);
  return out;
}

function _scoreMedia(media, keywordLower, nowSec) {
  return _scoreMediaBreakdown(media, keywordLower, nowSec).total;
}

function _limitSearchResults(medias) {
  if (!medias || medias.length <= SEARCH_RESULT_LIMIT) return medias || [];
  return medias.slice(0, SEARCH_RESULT_LIMIT);
}

function _dedupeNearDuplicateResults(medias, keywordLower) {
  if (!medias || medias.length === 0) return [];
  var seen = {};
  var out = [];
  for (var i = 0; i < medias.length; i++) {
    var media = medias[i];
    var key = _resultDiversityKey(media, keywordLower);
    if (key && seen[key]) continue;
    if (key) seen[key] = true;
    out.push(media);
  }
  return out;
}

function _resultDiversityKey(media, keywordLower) {
  var title = _stripShareNoise(media && media.title || "");
  var compact = _compactSearchText(title);
  if (compact.length < 6) return "";
  return compact;
}

function _stripShareNoise(text) {
  var cleaned = String(text || "")
    .replace(/https?:\/\/\S+/ig, " ")
    .replace(/提取码\s*[:：]?\s*[A-Za-z0-9]{2,12}/g, " ");
  for (var i = 0; i < 2; i++) {
    cleaned = cleaned
      .replace(/^[\s🗄📁📂🎬🎞️]+/g, "")
      .replace(/^\s*(?:名称|资源|分享|文件)\s*[:：]\s*/i, "");
  }
  return cleaned;
}

function _filterRankableMedias(medias, keywordLower) {
  if (!medias || medias.length === 0) return [];
  var kw = String(keywordLower || "").toLowerCase().trim();
  if (!kw) return medias;
  var nowSec = Math.floor(Date.now() / 1000);
  var out = [];
  for (var i = 0; i < medias.length; i++) {
    var score = _scoreMediaBreakdown(medias[i], kw, nowSec);
    if (score.keyword >= 260) out.push(medias[i]);
  }
  return out;
}

function _scoreMediaBreakdown(media, keywordLower, nowSec) {
  var title = String(media && media.title || "");
  var titleLower = title.toLowerCase();
  var rawLower = String(media && media._rawText || "").toLowerCase();
  var keyword = String(keywordLower || "").toLowerCase().trim();
  var keywordScore = _keywordRelevanceScore(titleLower, rawLower, keyword);
  var sourceScore = _sourceQualityScore(media);
  var timeScore = _timeFreshnessScore(media && media._pubDate || "", nowSec);
  var resourceScore = _resourceCompletenessScore(titleLower);
  var qualityScore = _qualityScore(titleLower);
  var penalty = _rankingPenalty(media, titleLower, keyword, keywordScore);
  var total = keywordScore + sourceScore + timeScore + resourceScore + qualityScore + penalty;
  return {
    total: total,
    keyword: keywordScore,
    source: sourceScore,
    time: timeScore,
    resource: resourceScore,
    quality: qualityScore,
    penalty: penalty
  };
}

function _keywordRelevanceScore(titleLower, rawLower, keywordLower) {
  if (!keywordLower) return 0;
  var compactTitle = _compactSearchText(titleLower);
  var compactRaw = _compactSearchText(rawLower);
  var compactKeyword = _compactSearchText(keywordLower);
  if (!compactKeyword) return 0;

  var titleScore = 0;
  var exactIdx = compactTitle.indexOf(compactKeyword);
  if (exactIdx >= 0) {
    titleScore += 620;
    if (exactIdx <= 8) titleScore += 80;
  }

  var parts = _keywordParts(compactKeyword);
  if (parts.length > 0) {
    var matchedLen = 0;
    var missingImportant = 0;
    for (var i = 0; i < parts.length; i++) {
      if (compactTitle.indexOf(parts[i]) >= 0) {
        matchedLen += parts[i].length;
      } else if (parts[i].length >= 2) {
        missingImportant++;
      }
    }
    titleScore += Math.round((matchedLen / Math.max(1, compactKeyword.length)) * 260);
    if (exactIdx < 0 && missingImportant > 0) titleScore -= Math.min(240, missingImportant * 120);
  }

  var bigramRatio = _keywordBigramMatchRatio(compactTitle, "", compactKeyword);
  titleScore += Math.round(bigramRatio * 160);

  var rawScore = 0;
  if (compactRaw.indexOf(compactKeyword) >= 0) {
    rawScore = 220;
  } else if (parts.length > 0) {
    var rawMatchedLen = 0;
    for (var j = 0; j < parts.length; j++) {
      if (compactRaw.indexOf(parts[j]) >= 0) rawMatchedLen += parts[j].length;
    }
    rawScore = Math.round((rawMatchedLen / Math.max(1, compactKeyword.length)) * 90);
  }

  var score = Math.max(titleScore, rawScore);
  if (score < 0) return 0;
  return Math.min(score, 1000);
}

function _compactSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[【】\[\]（）()「」『』《》<>〈〉·・•,，.。:：;；!！?？'"“”‘’_\-\s\/\\|]/g, "")
    .replace(/第二季|第2季|s02/g, "2")
    .replace(/第一季|第1季|s01/g, "1");
}

function _keywordParts(compactKeyword) {
  var raw = String(compactKeyword || "").replace(/[的之与和]/g, " ");
  var split = raw.split(/\s+/);
  var out = [];
  var seen = {};
  for (var i = 0; i < split.length; i++) {
    var part = split[i];
    if (part.length < 2 || seen[part]) continue;
    seen[part] = true;
    out.push(part);
  }
  if (out.length === 0 && compactKeyword.length >= 2) out.push(compactKeyword);
  return out;
}

function _keywordBigramMatchRatio(compactTitle, compactRaw, compactKeyword) {
  var key = String(compactKeyword || "").replace(/[的之与和]/g, "");
  if (key.length < 2) return 0;
  var total = 0;
  var matched = 0;
  var seen = {};
  for (var i = 0; i < key.length - 1; i++) {
    var gram = key.substring(i, i + 2);
    if (seen[gram]) continue;
    seen[gram] = true;
    total++;
    if (compactTitle.indexOf(gram) >= 0 || compactRaw.indexOf(gram) >= 0) matched++;
  }
  return total > 0 ? (matched / total) : 0;
}

function _sourceQualityScore(media) {
  var id = String(media && media._channelId || "");
  if (RANK_SOURCE_WEIGHTS[id] !== undefined) return RANK_SOURCE_WEIGHTS[id];
  var name = String(media && media._channelName || "");
  if (RANK_SOURCE_WEIGHTS[name] !== undefined) return RANK_SOURCE_WEIGHTS[name];
  return 30;
}

function _timeFreshnessScore(pubDate, nowSec) {
  var pubSec = _parseISODateSec(pubDate || "");
  if (pubSec <= 0) return 0;
  var ageDays = Math.max(0, (nowSec - pubSec) / 86400);
  if      (ageDays <= 1)   return 220;
  else if (ageDays <= 3)   return 180;
  else if (ageDays <= 7)   return 145;
  else if (ageDays <= 30)  return 105;
  else if (ageDays <= 90)  return 65;
  else if (ageDays <= 365) return 30;
  return 10;
}

function _resourceCompletenessScore(titleLower) {
  // 非视频内容（电子书、音乐等）— 重度降权，这类分享通常不能直接播放。
  if (/电子书|有声书|漫画|有声剧|小说|\.epub|\.pdf|\.mobi|\.azw3/.test(titleLower)) return -220;

  if (/合集|全集|全季|全剧|完整版|complete/.test(titleLower)) return 180;

  if (/完结|大结局/.test(titleLower)) return 155;

  // 集数范围（如 "第1-48集", "01-24集", "全24集", "共48集"）
  var m = titleLower.match(
    /(?:第?\s*0*(\d+)\s*[-~至到]\s*0*(\d+)\s*集)|(?:[全共]\s*0*(\d+)\s*集)/
  );
  if (m) {
    var count = 0;
    if (m[1] && m[2]) count = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    else if (m[3])     count = parseInt(m[3], 10);
    if      (count >= 40) return 145;
    else if (count >= 20) return 125;
    else if (count >= 10) return 95;
    else if (count >= 4)  return 65;
    else if (count >= 2)  return 30;
    return 10;
  }

  var updateNo = _extractUpdateEpisodeNumber(titleLower);
  if (updateNo > 0) return Math.min(145, 60 + updateNo * 5);

  // 正在更新中（连载）
  if (/最新|已更新|更新至|已?更至|连载/.test(titleLower)) return 70;

  // 明确单集标记（且无范围）— 轻微降权
  if (/第\s*\d+\s*集/.test(titleLower)) return -45;

  return 0;
}

function _extractUpdateEpisodeNumber(titleLower) {
  var t = String(titleLower || "").toLowerCase();
  var m = t.match(/(?:已?更新至|已?更至|更至|最新|连载至)\s*(?:ep|e|第)?\s*0*(\d+)\s*(?:集|话|期)?/);
  if (!m) m = t.match(/(?:ep|e)\s*0*(\d+)(?!\d)/);
  if (!m) return 0;
  var n = parseInt(m[1], 10);
  return isNaN(n) ? 0 : n;
}

function _qualityScore(titleLower) {
  var score = 0;
  if      (/4k|2160p|uhd/.test(titleLower))  score += 60;
  else if (/1080p|fhd|蓝光/.test(titleLower)) score += 42;
  else if (/720p|\bhd\b/.test(titleLower))    score += 22;

  if (/高码|高刷|hdr|杜比|dolby|remux/.test(titleLower)) score += 18;
  return Math.min(score, 80);
}

function _rankingPenalty(media, titleLower, keywordLower, keywordScore) {
  var penalty = 0;
  if (String(media && media.title || "").indexOf("🔒") === 0) penalty -= 40;
  if (/预告|花絮|解说|影评|reaction|cut\b|片段/.test(titleLower)) penalty -= 180;
  if (keywordLower && keywordScore < 260) penalty -= 260;
  return penalty;
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
      var displayTitle = _prettyEpisodeTitle(f.name, i + 1, sorted.length);
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

function _prettyEpisodeTitle(name, fallbackIndex, totalCount) {
  if (!name) return totalCount === 1 ? "正片" : "第 " + fallbackIndex + " 集";
  var trimmed = String(name)
    .replace(/\.[A-Za-z0-9]{2,5}$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!trimmed) return totalCount === 1 ? "正片" : "第 " + fallbackIndex + " 集";

  var seasonEpisode = trimmed.match(/S\s*(\d{1,2})\s*E\s*(\d{1,3})/i);
  if (seasonEpisode) {
    return "S" + seasonEpisode[1].padStart(2, "0") + "E" + seasonEpisode[2].padStart(2, "0");
  }

  var chineseEpisode = trimmed.match(/第\s*0*(\d{1,3})\s*[集话話]/);
  if (chineseEpisode) return "第" + parseInt(chineseEpisode[1], 10) + "集";

  var epMarker = trimmed.match(/(?:^|[\s.\-_\[\(])(?:EP|E)\s*0*(\d{1,3})(?:\b|[\s.\-_\]\)])/i);
  if (epMarker) return "第" + parseInt(epMarker[1], 10) + "集";

  var numericPrefix = trimmed.match(/^(?:\[\s*0*(\d{1,3})\s*\]|0*(\d{1,3})(?=[\s.\-_]))/);
  if (numericPrefix) {
    var prefixNumber = parseInt(numericPrefix[1] || numericPrefix[2], 10);
    if (prefixNumber > 0) return "第" + prefixNumber + "集";
  }

  if (totalCount === 1) return "正片";
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
