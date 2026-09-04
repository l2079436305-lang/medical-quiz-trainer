/* =========================================================================
 * exporter.js — 题库导出（JSON / TXT / Markdown）与学习记录导出
 * ========================================================================= */

(function (root) {
  'use strict';

  var Bank = root.MQBank;
  var Parser = root.MQParser;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toBankJSON() {
    return JSON.stringify({
      name: (Bank.state.questions.length && '医学题库') || '医学题库',
      exportedAt: new Date().toISOString(),
      questions: Bank.state.questions.map(function (q) {
        return {
          chapter: q.chapter, section: q.section, type: q.type, title: q.title,
          options: q.options, answer: q.answer, explanation: q.explanation,
          tags: q.tags, images: q.images, source: q.source,
          caseId: q.caseId || '', caseStem: q.caseStem || '',
          caseIndex: q.caseIndex || 0, caseTotal: q.caseTotal || 0
        };
      })
    }, null, 2);
  }

  function toBankText(markdown) {
    var out = [];
    var lastChapter = null, lastSection = null;
    var n = 0;
    for (var i = 0; i < Bank.state.questions.length; i++) {
      var q = Bank.state.questions[i];
      if (q.chapter !== lastChapter) {
        out.push((markdown ? '\n### ' : '') + q.chapter);
        lastChapter = q.chapter; lastSection = null;
      }
      if (q.section && q.section !== lastSection) {
        out.push((markdown ? '\n#### ' : '') + q.section);
        lastSection = q.section;
      }
      n++;
      out.push('');
      // 病例组：在第一问前输出共用题干
      if (q.caseStem && (q.caseIndex === 1 || !q.caseIndex)) {
        out.push('【病例】' + q.caseStem);
      }
      out.push(n + '. (' + q.type + '型题) ' + q.title);
      Object.keys(q.options).forEach(function (L) {
        out.push(L + '. ' + q.options[L]);
      });
      if (q.answer) out.push('答案：' + q.answer);
      if (q.explanation) out.push('解析：' + q.explanation);
    }
    return out.join('\n');
  }

  function toRecordsJSON() {
    var records = Bank.state.records;
    var rows = [];
    for (var i = 0; i < Bank.state.questions.length; i++) {
      var q = Bank.state.questions[i];
      var rec = records[q.uid] || Bank.blankRecord();
      rows.push({
        chapter: q.chapter, section: q.section, num: q.num, type: q.type,
        title: q.title.slice(0, 50), answer: q.answer,
        attempts: rec.attempts, correct: rec.correct, wrong: rec.wrong,
        streak: rec.streak, lastResult: rec.lastResult,
        lastAnsweredAt: rec.lastAnsweredAt, lastUserAnswer: rec.lastUserAnswer,
        status: Bank.statusOf(rec), favorite: rec.favorite, unsure: rec.unsure
      });
    }
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      summary: root.MQStats.overview(),
      history: root.MQStorage.get(root.MQStorage.KEYS.HISTORY, []),
      daily: root.MQStorage.get(root.MQStorage.KEYS.DAILY, {}),
      records: rows
    }, null, 2);
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    return root.MQStats.dateKey(new Date()).replace(/-/g, '');
  }

  root.MQExport = {
    toBankJSON: toBankJSON,
    toBankText: toBankText,
    toRecordsJSON: toRecordsJSON,
    downloadBankJSON: function () { download('题库-' + stamp() + '.json', toBankJSON(), 'application/json;charset=utf-8'); },
    downloadBankTXT: function () { download('题库-' + stamp() + '.txt', toBankText(false)); },
    downloadBankMD: function () { download('题库-' + stamp() + '.md', toBankText(true), 'text/markdown;charset=utf-8'); },
    downloadRecords: function () { download('学习记录-' + stamp() + '.json', toRecordsJSON(), 'application/json;charset=utf-8'); },
    download: download
  };

})(typeof window !== 'undefined' ? window : globalThis);
