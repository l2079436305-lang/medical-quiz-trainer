/* =========================================================================
 * question-bank.js — 题库数据层：题库 + 作答记录 + 收藏/错题/掌握度
 * ========================================================================= */

(function (root) {
  'use strict';

  var Storage = root.MQStorage;

  var state = {
    questions: [],      // 题目数组（parser 输出结构）
    byUid: {},          // uid -> question
    chapters: [],       // 章节名列表（按出现顺序）
    sections: {},       // chapter -> [section...]
    types: [],          // 题型代码列表
    records: {},        // uid -> record
    settings: { shuffleOptions: false, avoidRecentN: 1, defaultCount: 20 },
    loaded: false
  };

  /* ------------------------- 记录（数据结构见规格十一） ------------------------- */

  function blankRecord() {
    return {
      attempts: 0, correct: 0, wrong: 0,
      streak: 0,                 // 连续正确次数
      lastResult: null,          // true/false/null
      lastAnsweredAt: null,      // ISO 时间
      lastUserAnswer: '',
      favorite: false,
      unsure: false,             // 标记"不确定"
      seenSessions: []           // 最近出现的考试 id（用于"避免最近N次"）
    };
  }

  function recordOf(uid) {
    if (!state.records[uid]) {
      state.records[uid] = blankRecord();
    }
    return state.records[uid];
  }

  /** 掌握度状态（规格十二） */
  function statusOf(rec) {
    if (!rec || rec.attempts === 0) return 'new';
    if (rec.lastResult === false) return 'high';        // 再次错误 → 高优先级
    if (rec.streak >= 3) return 'mastered';             // 连续正确 3 次 → 基本掌握
    if (rec.streak === 2) return 'low';                 // 连续正确 2 次 → 降低优先级
    return 'normal';                                    // 错过但尚未连续答对
  }

  var STATUS_LABELS = { new: '未做', high: '待强化', normal: '错题', low: '渐稳', mastered: '已掌握' };

  function isWrongPool(q) {
    var rec = state.records[q.uid];
    if (!rec || rec.wrong === 0) return false;
    return statusOf(rec) !== 'mastered';
  }

  /* ----------------------------- 装载与索引 ----------------------------- */

  function load() {
    var bank = Storage.get(Storage.KEYS.BANK, null);
    state.questions = bank && Array.isArray(bank.questions) ? bank.questions : [];
    state.records = Storage.get(Storage.KEYS.RECORDS, {}) || {};
    var s = Storage.get(Storage.KEYS.SETTINGS, null);
    if (s) state.settings = Object.assign(state.settings, s);
    rebuildIndex();
    state.loaded = true;
  }

  function rebuildIndex() {
    state.byUid = {};
    var chapters = [], sections = {}, types = [];
    for (var i = 0; i < state.questions.length; i++) {
      var q = state.questions[i];
      if (!q.uid) q.uid = 'q' + i + '-' + q.num;
      state.byUid[q.uid] = q;
      if (chapters.indexOf(q.chapter) < 0) chapters.push(q.chapter);
      if (!sections[q.chapter]) sections[q.chapter] = [];
      if (q.section && sections[q.chapter].indexOf(q.section) < 0) sections[q.chapter].push(q.section);
      if (types.indexOf(q.type) < 0) types.push(q.type);
    }
    state.chapters = chapters;
    state.sections = sections;
    state.types = types;
  }

  function saveBank(meta) {
    var payload = {
      questions: state.questions,
      meta: Object.assign({ name: meta && meta.name || '我的题库', importedAt: new Date().toISOString() }, meta || {})
    };
    Storage.set(Storage.KEYS.BANK, payload);
  }

  function saveRecords() { Storage.set(Storage.KEYS.RECORDS, state.records); }
  function saveSettings() { Storage.set(Storage.KEYS.SETTINGS, state.settings); }

  /** 导入：覆盖或追加（按 uid 去重） */
  function importQuestions(questions, mode, meta) {
    if (mode === 'replace') {
      state.questions = questions;
    } else {
      var existing = {};
      state.questions.forEach(function (q) { existing[q.uid] = true; });
      var added = 0;
      for (var i = 0; i < questions.length; i++) {
        if (!existing[questions[i].uid]) { state.questions.push(questions[i]); existing[questions[i].uid] = true; added++; }
      }
      meta = meta || {};
      meta.appended = added;
    }
    rebuildIndex();
    saveBank(meta);
    return state.questions.length;
  }

  function updateQuestion(uid, patch) {
    var q = state.byUid[uid];
    if (!q) return null;
    Object.assign(q, patch);
    saveBank();
    return q;
  }

  function setRecord(uid, patch) {
    var rec = recordOf(uid);
    Object.assign(rec, patch);
    saveRecords();
    return rec;
  }

  function toggleFavorite(uid) {
    var rec = recordOf(uid);
    rec.favorite = !rec.favorite;
    saveRecords();
    return rec.favorite;
  }

  function toggleUnsure(uid) {
    var rec = recordOf(uid);
    rec.unsure = !rec.unsure;
    saveRecords();
    return rec.unsure;
  }

  /* ------------------------------- 筛选池 -------------------------------
   * specialPool: all | wrong | favorite | unseen | recentWrong | freqWrong
   * chapter: 'all' 或章节名；type: 'all' 或题型代码
   * --------------------------------------------------------------------- */

  function buildPool(filters) {
    filters = filters || {};
    var pool = [];
    for (var i = 0; i < state.questions.length; i++) {
      var q = state.questions[i];
      var rec = state.records[q.uid] || blankRecord();

      var sp = filters.specialPool || 'all';
      if (sp === 'wrong' && !isWrongPool(q)) continue;
      if (sp === 'favorite' && !rec.favorite) continue;
      if (sp === 'unseen' && rec.attempts !== 0) continue;
      if (sp === 'recentWrong' && rec.lastResult !== false) continue;
      if (sp === 'freqWrong' && rec.wrong < 2) continue;

      if (filters.chapter && filters.chapter !== 'all' && q.chapter !== filters.chapter) continue;
      if (filters.type && filters.type !== 'all' && q.type !== filters.type) continue;

      pool.push(q);
    }
    if (filters.specialPool === 'freqWrong') {
      pool.sort(function (a, b) { return (state.records[b.uid] || blankRecord()).wrong - (state.records[a.uid] || blankRecord()).wrong; });
    }
    return pool;
  }

  function get(uid) { return state.byUid[uid]; }
  function size() { return state.questions.length; }
  function isEmpty() { return state.questions.length === 0; }

  function clearBank() {
    state.questions = [];
    state.records = {};
    rebuildIndex();
    Storage.remove(Storage.KEYS.BANK);
    Storage.remove(Storage.KEYS.RECORDS);
    Storage.remove(Storage.KEYS.SESSION);
    Storage.remove(Storage.KEYS.HISTORY);
    Storage.remove(Storage.KEYS.DAILY);
  }

  root.MQBank = {
    state: state,
    load: load,
    rebuildIndex: rebuildIndex,
    saveBank: saveBank,
    saveRecords: saveRecords,
    saveSettings: saveSettings,
    importQuestions: importQuestions,
    updateQuestion: updateQuestion,
    setRecord: setRecord,
    recordOf: recordOf,
    blankRecord: blankRecord,
    statusOf: statusOf,
    STATUS_LABELS: STATUS_LABELS,
    isWrongPool: isWrongPool,
    toggleFavorite: toggleFavorite,
    toggleUnsure: toggleUnsure,
    buildPool: buildPool,
    get: get,
    size: size,
    isEmpty: isEmpty,
    clearBank: clearBank
  };

})(typeof window !== 'undefined' ? window : globalThis);
