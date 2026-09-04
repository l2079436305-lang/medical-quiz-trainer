/* =========================================================================
 * quiz.js — 考试逻辑：随机抽题 / 会话管理 / 自动判分 / 记录回写
 *
 * 会话结构（可持久化，支持"继续上次练习"）：
 * {
 *   id, createdAt, label, submitted,
 *   questions: [{ uid, options:[{letter,text}...] }],  // options 为显示顺序
 *   answers: { uid: 'ACD' }, flags: { uid: {marked, unsure} },
 *   index: 0, meta: { specialPool, chapter, type, count, shuffleOptions }
 * }
 * ========================================================================= */

(function (root) {
  'use strict';

  var Storage = root.MQStorage;
  var Bank = root.MQBank;
  var Parser = root.MQParser;

  /* ------------------------------- 工具 ------------------------------- */

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function shuffleOptions(q) {
    var entries = Object.keys(q.options || {}).map(function (L) { return { letter: L, text: q.options[L] }; });
    if (q.type === '判断' || entries.length < 3) return entries; // 判断题不乱序
    return shuffle(entries);
  }

  /* ---------------------------- 抽题（规格六/七） ---------------------------- */

  /**
   * @param {Object} filters {specialPool, chapter, type}
   * @param {Object} opts {count, shuffleOptions, avoidRecentN, label}
   * @returns {session|null}
   */
  function createSession(filters, opts) {
    opts = opts || {};
    var pool = Bank.buildPool(filters);
    if (!pool.length) return null;

    var count = Math.max(1, Math.min(parseInt(opts.count, 10) || 20, pool.length));

    // 「避免最近 N 次出现过的题目」：优先抽没出现过的，不足时回填
    var N = Math.max(0, parseInt(opts.avoidRecentN, 10) || 0);
    var chosen = [];
    if (N > 0) {
      var recent = recentSessionIds(N);
      var fresh = [], rest = [];
      pool.forEach(function (q) {
        var rec = Bank.recordOf(q.uid);
        var seen = (rec.seenSessions || []).some(function (sid) { return recent.indexOf(sid) >= 0; });
        (seen ? rest : fresh).push(q);
      });
      chosen = shuffle(fresh);
      if (chosen.length < count) chosen = chosen.concat(shuffle(rest));
    } else {
      chosen = shuffle(pool);
    }

    var session = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      label: opts.label || sessionLabel(filters),
      submitted: false,
      index: 0,
      answers: {},
      flags: {},
      meta: {
        specialPool: filters.specialPool || 'all',
        chapter: filters.chapter || 'all',
        type: filters.type || 'all',
        count: count,
        shuffleOptions: !!opts.shuffleOptions
      },
      questions: chosen.slice(0, count).map(function (q) {
        return {
          uid: q.uid,
          options: opts.shuffleOptions ? shuffleOptions(q) : Object.keys(q.options || {}).map(function (L) { return { letter: L, text: q.options[L] }; })
        };
      })
    };
    saveSession(session);
    return session;
  }

  function sessionLabel(filters) {
    var f = filters || {};
    var poolNames = { all: '全部', wrong: '错题', favorite: '收藏', unseen: '未做', recentWrong: '最近错误', freqWrong: '高频错误' };
    var parts = [];
    if (f.specialPool && f.specialPool !== 'all') parts.push(poolNames[f.specialPool] || f.specialPool);
    if (f.chapter && f.chapter !== 'all') parts.push(f.chapter);
    if (f.type && f.type !== 'all') parts.push(Parser.typeLabel(f.type));
    return parts.length ? parts.join(' · ') : '随机练习';
  }

  function recentSessionIds(n) {
    var history = Storage.get(Storage.KEYS.HISTORY, []);
    return history.slice(-n).map(function (h) { return h.id; });
  }

  /* --------------------------- 会话存取与导航 --------------------------- */

  function saveSession(session) {
    if (!session) return;
    Storage.set(Storage.KEYS.SESSION, session);
  }

  function loadSession() { return Storage.get(Storage.KEYS.SESSION, null); }
  function hasActive() {
    var s = loadSession();
    return !!(s && !s.submitted && s.questions && s.questions.length);
  }
  function clearSession() { Storage.remove(Storage.KEYS.SESSION); }

  function currentQuestion(session) {
    return session.questions[session.index] || null;
  }

  function saveAnswer(session, uid, answer) {
    session.answers[uid] = answer;
    saveSession(session);
  }

  function toggleFlag(session, uid, kind) {
    if (!session.flags[uid]) session.flags[uid] = {};
    session.flags[uid][kind] = !session.flags[uid][kind];
    if (kind === 'unsure') Bank.toggleUnsure(uid);
    saveSession(session);
    return session.flags[uid][kind];
  }

  /* ------------------------------ 判分（规格九/十） ------------------------------ */

  function isCorrect(q, userAns) {
    var std = Parser.normalizeAnswer(q.answer);
    var mine = Parser.normalizeAnswer(userAns);
    if (!std || !mine) return false;
    return std === mine; // 多选已排序去重后整体比对：AC === ACD 为错
  }

  /**
   * 提交试卷：判分 + 更新每题记录 + 今日统计 + 历史记录
   * @returns {{total, answered, correct, wrong, blank, accuracy, results:[...]}}
   */
  function submitSession(session) {
    var total = session.questions.length;
    var correct = 0, answered = 0;
    var results = [];
    var today = dateKey(new Date());
    var daily = Storage.get(Storage.KEYS.DAILY, {});
    if (!daily[today]) daily[today] = { attempts: 0, correct: 0 };

    for (var i = 0; i < total; i++) {
      var sq = session.questions[i];
      var q = Bank.get(sq.uid);
      if (!q) continue;
      var user = session.answers[sq.uid] || '';
      var rec = Bank.recordOf(q.uid);
      var ok = isCorrect(q, user);
      if (user) answered++;
      if (ok) correct++;

      // ---- 记录回写（规格十一/十二）----
      rec.attempts++;
      if (ok) { rec.correct++; rec.streak++; } else { rec.wrong++; rec.streak = 0; }
      rec.lastResult = ok;
      rec.lastUserAnswer = user;
      rec.lastAnsweredAt = new Date().toISOString();
      rec.seenSessions = (rec.seenSessions || []).concat(session.id).slice(-6);
      Bank.setRecord(q.uid, rec); // 持久化

      daily[today].attempts++;
      if (ok) daily[today].correct++;

      results.push({ index: i, uid: q.uid, user: user, answer: q.answer, correct: ok, blank: !user });
    }

    session.submitted = true;
    session.index = 0;
    Storage.set(Storage.KEYS.DAILY, daily);

    var accuracy = total ? Math.round((correct / total) * 1000) / 10 : 0;
    var history = Storage.get(Storage.KEYS.HISTORY, []);
    history.push({
      id: session.id, at: session.createdAt, finishedAt: new Date().toISOString(),
      label: session.label, total: total, answered: answered,
      correct: correct, wrong: total - correct, accuracy: accuracy
    });
    if (history.length > 200) history = history.slice(-200);
    Storage.set(Storage.KEYS.HISTORY, history);
    saveSession(session);

    return { total: total, answered: answered, correct: correct, wrong: total - correct, blank: total - answered, accuracy: accuracy, results: results };
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  root.MQQuiz = {
    createSession: createSession,
    sessionLabel: sessionLabel,
    saveSession: saveSession,
    loadSession: loadSession,
    hasActive: hasActive,
    clearSession: clearSession,
    currentQuestion: currentQuestion,
    saveAnswer: saveAnswer,
    toggleFlag: toggleFlag,
    isCorrect: isCorrect,
    submitSession: submitSession,
    shuffle: shuffle
  };

})(typeof window !== 'undefined' ? window : globalThis);
