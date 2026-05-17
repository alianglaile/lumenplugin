var CLOUD_PATTERNS = [
  { type: "quark",    re: /https?:\/\/pan\.quark\.cn\/s\/[A-Za-z0-9]+/g },
  { type: "cloud115", re: /https?:\/\/(?:115\.com|anxia\.com|115cdn\.com)\/s\/[A-Za-z0-9?#=&_-]+/g }
];

function extractCloudLinks(text) {
  if (!text || typeof text !== "string") return [];
  var out = [];
  for (var i = 0; i < CLOUD_PATTERNS.length; i++) {
    var p = CLOUD_PATTERNS[i];
    p.re.lastIndex = 0;
    var m;
    while ((m = p.re.exec(text)) !== null) {
      out.push({ type: p.type, url: m[0] });
    }
  }
  return out;
}

function extractPasscode(text) {
  if (!text) return null;
  var re = /(?:提取码|密码|pwd|password)\s*[:：]?\s*([A-Za-z0-9]{4,8})/i;
  var m = text.match(re);
  return m ? m[1] : null;
}
