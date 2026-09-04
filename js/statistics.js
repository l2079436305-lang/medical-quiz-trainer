/* =========================================================================
 * statistics.js — 统计逻辑：Dashboard / 章节统计 / 题型统计 / 历史记录
 * ========================================================================= */

(function (root) {
  'use strict';

  var Storage = root.MQStorage;
  var Bank = root.MQBank;

  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function pct(a, b) {
    return b ? Math.round((a / b) * 100) : 0;
  }

  /** 首页/Dashboard 总览（规格十三） */
  function overview() {
    var total = Bank.size();
    var attempted = 0, correct = 0, wrongPool = 0, fav = 0, unseen = 0, mastered = 0, unsure = 0;
    var todayKey = dateKey(new Date());
    var daily = Storage.get(Storage.KEYS.DAILY, {});
    var today = daily[todayKey] || { attempts: 0, correct: 0 };

    for (var i = 0; i < Bank.state.questions.length; i++) {
      var q = Bank.state.questions[i];
      var rec = Bank.state.records[q.uid];
      if (rec && rec.attempts > 0) {
        attempted++;
        correct += rec.correct;
      } else {
        unseen++;
      }
      if (Bank.isWrongPool(q)) wrongPool++;
      var st = Bank.statusOf(rec);
      if (st === 'mastered') mastered++;
      if (rec && rec.favorite) fav++;
      if (rec && rec.unsure) unsure++;
    }

    return {
      total: total,
      attempted: attempted,
      accuracy: pct(correct, attempted === 0 ? 0 : correct + countWrongAnswered()),
      // 总正确率 = 所有作答中正确的比例
      overallAccuracy: overallAccuracy(),
      completion: pct(attempted, total),
      today: {
        attempts: today.attempts,
        correct: today.correct,
        accuracy: pct(today.correct, today.attempts)
      },
      wrongPool: wrongPool,
      favorite: fav,
      unseen: unseen,
      mastered: mastered,
      unsure: unsure,
      sessions: (Storage.get(Storage.KEYS.HISTORY, []) || []).length
    };
  }

  function countWrongAnswered() {
    var wrong = 0;
    var recs = Bank.state.records;
    for (var uid in recs) {
      if (recs.hasOwnProperty(uid)) wrong += recs[uid].wrong;
    }
    return wrong;
  }

  function overallAccuracy() {
    var c = 0, w = 0;
    var recs = Bank.state.records;
    for (var uid in recs) {
      if (!recs.hasOwnProperty(uid)) continue;
      c += recs[uid].correct;
      w += recs[uid].wrong;
    }
    return pct(c, c + w);
  }

  /** 章节统计（规格十四）：完成率 / 正确率，可点击直接练习 */
  function chapterStats() {
    var map = {};
    for (var i = 0; i < Bank.state.questions.length; i++) {
      var q = Bank.state.questions[i];
      if (!map[q.chapter]) map[q.chapter] = { chapter: q.chapter, total: 0, done: 0, attempts: 0, correct: 0, wrong: 0, mastered: 0 };
      var m = map[q.chapter];
      m.total++;
      var rec = Bank.state.records[q.uid];
      if (rec && rec.attempts > 0) {
        m.done++;
        m.attempts += rec.attempts;
        m.correct += rec.correct;
        m.wrong += rec.wrong;
      }
      if (Bank.statusOf(rec) === 'mastered') m.mastered++;
    }
    var list = Object.keys(map).map(function (k) {
      var m = map[k];
      m.doneRate = pct(m.done, m.total);
      m.accuracy = pct(m.correct, m.correct + m.wrong);
      return m;
    });
    list.sort(function (a, b) { return a.chapter.localeCompare(b.chapter, 'zh-Hans-CN'); });
    return list;
  }

  /** 题型统计 */
  function typeStats() {
    var map = {};
    for (var i = 0; i < Bank.state.questions.length; i++) {
      var q = Bank.state.questions[i];
      if (!map[q.type]) map[q.type] = { type: q.type, total: 0, done: 0, correct: 0, wrong: 0 };
      var t = map[q.type];
      t.total++;
      var rec = Bank.state.records[q.uid];
      if (rec && rec.attempts > 0) {
        t.done++;
        t.correct += rec.correct;
        t.wrong += rec.wrong;
      }
    }
    return Object.keys(map).map(function (k) {
      var t = map[k];
      t.label = root.MQParser.typeLabel(t.type);
      t.doneRate = pct(t.done, t.total);
      t.accuracy = pct(t.correct, t.correct + t.wrong);
      return t;
    }).sort(function (a, b) { return b.total - a.total; });
  }

  /** 错题本视图：按优先级排序（高 > 普通 > 低），已掌握不显示 */
  function wrongBook() {
    var rank = { high: 0, normal: 1, low: 2 };
    var list = [];
    for (var i = 0; i < Bank.state.questions.length; i++) {
      var q = Bank.state.questions[i];
      var rec = Bank.state.records[q.uid];
      if (!rec || rec.wrong === 0) continue;
      var st = Bank.statusOf(rec);
      if (st === 'mastered') continue;
      list.push({ q: q, rec: rec, status: st, rank: rank[st] });
    }
    list.sort(function (a, b) { return a.rank - b.rank || b.rec.wrong - a.rec.wrong; });
    return list;
  }

  /** 历史练习记录（最近在前） */
  function history(limit) {
    var h = Storage.get(Storage.KEYS.HISTORY, []).slice().reverse();
    return limit ? h.slice(0, limit) : h;
  }

  root.MQStats = {
    overview: overview,
    chapterStats: chapterStats,
    typeStats: typeStats,
    wrongBook: wrongBook,
    history: history,
    dateKey: dateKey,
    pct: pct
  };

})(typeof window !== 'undefined' ? window : globalThis);
