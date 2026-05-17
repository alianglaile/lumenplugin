// CloudSaver 网盘聚合插件
// 流程：搜 TG 公开频道 -> 正则识别网盘链接 -> 用户点击 -> 原生层转存+解析直链 -> 播放
//
// 关键约束（来自 SKILL.md）：
// - JavaScriptCore，无 fetch / no XMLHttpRequest / no Promise.all
// - 仅用 $http.fetch / $next.* / $cloud.*
// - 不要在 if/for 块里 function 声明
// - 永不传 undefined/null 给 $next 方法

var DEBUG = false;
function _log(label, params) {
  if (!DEBUG) return;
  try { console.log("[cloudsaver:" + label + "] " + JSON.stringify(params || {})); } catch (e) {}
}

var SINGLE_CHANNEL_TIMEOUT_SEC = 10;

// ============================================================
// Search: 跨多个 TG 频道并发抓取，匹配网盘链接，归一化为 MediaData
// ============================================================
function Search(inputURL, key) {
  _log("Search.start", { inputURL: inputURL, key: key });

  $cloud.getSearchChannels().then(function (channels) {
    if (!channels || channels.length === 0) {
      $next.emptyView("请先在 设置 → 网盘 → 搜索频道 添加 TG 频道");
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
      _log("Search.emit", { count: dedup.length });
      $next.toSearchMedias(JSON.stringify(dedup), String(key || ""));
    };

    for (var i = 0; i < channels.length; i++) {
      var ch = channels[i];
      _fetchChannel(ch, keyword, function (items) {
        for (var j = 0; j < items.length; j++) collected.push(items[j]);
        tryEmit();
      });
    }
  }, function (err) {
    _log("Search.bridgeError", { err: err });
    $next.emptyView("无法读取频道配置: " + err);
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
  var detail = "cloudsaver://share?type=" + encodeURIComponent(link.type) +
               "&url=" + encodeURIComponent(link.url) +
               "&passcode=" + encodeURIComponent(passcode || "") +
               "&title=" + encodeURIComponent(title);
  return {
    id: link.type + ":" + msg.messageId + ":" + _hashStr(link.url),
    title: title,
    coverURLString: msg.image || "",
    descriptionText: desc,
    detailURLString: detail
  };
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

// ============================================================
// Episodes: 把 cloudsaver://share URL 转成单集（首版只暴露单一"播放"项）
// 真实分享内多文件的展开放到 v0.2（需要扩展 $cloud.listShareFiles）
// ============================================================
function Episodes(inputURL, _key) {
  _log("Episodes.start", { inputURL: inputURL });
  var info = _parseShareURL(inputURL);
  if (!info) {
    $next.emptyView("无效的分享链接参数");
    return;
  }
  var playURL = "cloudsaver://play?type=" + encodeURIComponent(info.type) +
                "&shareUrl=" + encodeURIComponent(info.url) +
                "&passcode=" + encodeURIComponent(info.passcode || "") +
                "&title=" + encodeURIComponent(info.title || "");
  $next.toEpisodes(JSON.stringify([
    {
      id: "play",
      title: info.title || "播放",
      episodeDetailURL: playURL
    }
  ]));
}

function _parseShareURL(url) {
  if (!url || url.indexOf("cloudsaver://share") !== 0) return null;
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
    $next.emptyView("无效的播放参数");
    return;
  }
  $cloud.playOrSave({
    cloudType: info.type,
    shareUrl: info.url,
    passcode: info.passcode || "",
    title: info.title || ""
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
  if (!url || url.indexOf("cloudsaver://play") !== 0) return null;
  return {
    type:     _qs(url, "type"),
    url:      _qs(url, "shareUrl"),
    passcode: _qs(url, "passcode"),
    title:    _qs(url, "title")
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
      var playURL = "cloudsaver://playFile?type=" + encodeURIComponent(f.cloudType) +
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
