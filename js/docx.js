/* =========================================================================
 * docx.js — 浏览器内直接解析 Word (.docx) 文件，提取纯文本
 *
 * 原理：.docx 是 ZIP 容器，用原生 DecompressionStream('deflate-raw')
 *       解压 word/document.xml，再剥离 XML 标签得到段落文本。
 * 零第三方依赖、完全离线、数据不出本机。
 * 兼容：Chrome 80+ / Edge 80+ / Firefox 113+ / Safari 16.4+
 * ========================================================================= */

(function (root) {
  'use strict';

  /** 解析 ZIP 中央目录，返回条目列表 [{name, method, compSize, dataStart}] */
  function readZipEntries(buffer) {
    var dv = new DataView(buffer);
    var eocd = -1;
    var minPos = Math.max(0, dv.byteLength - 22 - 65536);
    for (var i = dv.byteLength - 22; i >= minPos; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP / DOCX 文件');

    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var entries = [];
    var td = new TextDecoder();

    for (var n = 0; n < count; n++) {
      if (off + 46 > dv.byteLength || dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true);
      var compSize = dv.getUint32(off + 20, true);
      var nameLen = dv.getUint16(off + 28, true);
      var extraLen = dv.getUint16(off + 30, true);
      var commentLen = dv.getUint16(off + 32, true);
      var localOff = dv.getUint32(off + 42, true);
      var name = td.decode(new Uint8Array(buffer, off + 46, nameLen));

      if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('ZIP 局部文件头损坏');
      var lNameLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var dataStart = localOff + 30 + lNameLen + lExtraLen;

      entries.push({ name: name, method: method, compSize: compSize, dataStart: dataStart });
      off += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  /** 解压单个条目并按 UTF-8 解码 */
  async function inflateEntry(buffer, entry) {
    var bytes = new Uint8Array(buffer, entry.dataStart, entry.compSize);
    if (entry.method === 0) return new TextDecoder('utf-8').decode(bytes);
    if (entry.method !== 8) throw new Error('不支持的 ZIP 压缩方式: ' + entry.method);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持原生解压（DecompressionStream），请改用 Chrome/Edge 较新版本，或先将 docx 另存为 txt 再导入');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    var buf = await new Response(stream).arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  }

  function decodeEntities(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /** document.xml → 段落文本（每个 <w:p> 一行） */
  function xmlToText(xml) {
    var body = xml;
    var m = xml.match(/<w:body[\s>]/);
    if (m) body = xml.slice(m.index);
    return decodeEntities(
      body
        .replace(/<w:tab\b[^>]*\/?>/g, '\t')
        .replace(/<w:br\b[^>]*\/?>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
    ).replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 提取 .docx 文本
   * @param {ArrayBuffer} buffer
   * @returns {Promise<string>}
   */
  async function extractDocxText(buffer) {
    var entries = readZipEntries(buffer);
    var doc = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].name === 'word/document.xml') { doc = entries[i]; break; }
    }
    if (!doc) {
      throw new Error('不是有效的 Word (.docx) 文档（缺少 word/document.xml）。提示：老版 .doc 格式请先在 Word 中另存为 .docx 或 .txt');
    }
    var xml = await inflateEntry(buffer, doc);
    return xmlToText(xml);
  }

  var API = { extractDocxText: extractDocxText, readZipEntries: readZipEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MQDocx = API;

})(typeof window !== 'undefined' ? window : globalThis);
