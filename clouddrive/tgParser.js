// 极简 Telegram /s/<channel> 页面解析器。无需 cheerio。
// 提取每条 .tgme_widget_message_wrap 的：messageId / text / image / pubDate / tags

var TG_MSG_BLOCK_RE = /<div class="tgme_widget_message_wrap[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
var TG_POST_ID_RE = /data-post="([^"]+)"/;
var TG_TEXT_RE = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
var TG_PHOTO_RE = /tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/;
var TG_VIDEO_THUMB_RE = /<video[^>]*poster="([^"]+)"/;
var TG_DATE_RE = /<time[^>]*datetime="([^"]+)"/;
var TG_TAG_RE = /href="\?q=([^"]+)"[^>]*>#([^<]+)</g;

function _stripHTML(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function _firstLine(text) {
  if (!text) return "";
  var parts = String(text).split(/\n/);
  for (var i = 0; i < parts.length; i++) {
    var line = parts[i].trim();
    if (line.length > 0) return line;
  }
  return "";
}

function parseTGPage(html) {
  if (!html || typeof html !== "string") return [];
  var out = [];
  TG_MSG_BLOCK_RE.lastIndex = 0;
  var m;
  while ((m = TG_MSG_BLOCK_RE.exec(html)) !== null) {
    var block = m[0];

    var postId = "";
    var idMatch = block.match(TG_POST_ID_RE);
    if (idMatch) {
      var parts = idMatch[1].split("/");
      postId = parts.length > 1 ? parts[1] : idMatch[1];
    }

    var rawText = "";
    var textMatch = block.match(TG_TEXT_RE);
    if (textMatch) rawText = textMatch[1];
    var plainText = _stripHTML(rawText);

    var image = "";
    var photoMatch = block.match(TG_PHOTO_RE);
    if (photoMatch) {
      image = photoMatch[1];
    } else {
      var videoMatch = block.match(TG_VIDEO_THUMB_RE);
      if (videoMatch) image = videoMatch[1];
    }

    var pubDate = "";
    var dateMatch = block.match(TG_DATE_RE);
    if (dateMatch) pubDate = dateMatch[1];

    var tags = [];
    TG_TAG_RE.lastIndex = 0;
    var tagMatch;
    while ((tagMatch = TG_TAG_RE.exec(block)) !== null) {
      tags.push(tagMatch[2]);
    }

    if (postId && (plainText || image)) {
      out.push({
        messageId: postId,
        text: plainText,
        title: _firstLine(plainText) || ("消息 " + postId),
        image: image,
        pubDate: pubDate,
        tags: tags
      });
    }
  }
  return out;
}
