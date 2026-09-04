/* =========================================================================
 * views/result.js — 交卷结果：判分摘要 + 逐题回顾（我的答案/正确答案/解析）
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Parser = root.MQParser;

  var App = null;

  function render(session, summary) {
    var box = Dom.$('#view-result');
    var s = summary;

    var items = s.results.map(function (r) {
      var q = Bank.get(r.uid);
      if (!q) return '';
      var sq = session.questions[r.index];
      var optsHtml = (sq.options || []).map(function (o) {
        var isTruth = Parser.normalizeAnswer(q.answer).indexOf(o.letter) >= 0;
        var isMine = Parser.normalizeAnswer(r.user).indexOf(o.letter) >= 0;
        var cls = [];
        if (isMine && isTruth) cls.push('mine truth');
        else if (isMine) cls.push(q.answer ? 'bad' : 'mine');
        else if (isTruth) cls.push('truth');
        return `<div class="opt-line ${cls.join(' ')}">
          <strong>${o.letter}.</strong> ${Dom.esc(o.text)}
          ${isTruth ? ' <span class="chip ok">正确答案</span>' : ''}
          ${isMine && !isTruth ? ' <span class="chip bad">你的选择</span>' : ''}
          ${isMine && isTruth ? ' <span class="chip ok">你的选择</span>' : ''}
        </div>`;
      }).join('');

      var rec = Bank.recordOf(q.uid);
      return `
        <div class="card result-item ${r.correct ? 'correct' : 'wrong'}">
          <div>
            <span class="chip">第 ${r.index + 1} 题</span>
            <span class="chip type">${Dom.esc(Parser.typeLabel(q.type))}</span>
            <span class="chip">${Dom.esc(q.chapter)}</span>
            ${r.blank ? '<span class="chip warn">未作答</span>' : r.correct ? '<span class="chip ok">✓ 正确</span>' : '<span class="chip bad">✗ 错误</span>'}
            <span class="muted" style="font-size:12px">累计：做 ${rec.attempts} 次 · 对 ${rec.correct} · 错 ${rec.wrong} · ${Bank.STATUS_LABELS[Bank.statusOf(rec)]}</span>
          </div>
          <div class="q-title" style="font-size:15px">
            ${q.caseStem ? `<div class="case-stem" style="margin-bottom:10px"><span class="chip warn">病例共用题干</span><div class="case-stem-text">${Dom.esc(q.caseStem)}</div></div>` : ''}
            ${Dom.esc(q.title)}
          </div>
          <div class="opts-review">${optsHtml}</div>
          ${!q.answer ? '<p class="muted">⚠ 该题没有录入答案，已计入错题，可在「导入/导出」中修正。</p>' : ''}
          ${q.explanation ? `<div class="explanation"><strong>解析：</strong>${Dom.esc(q.explanation)}</div>` : ''}
        </div>`;
    }).join('');

    box.innerHTML = `
      <div class="card">
        <h2>本次练习结果 · ${Dom.esc(session.label)}</h2>
        <div class="stat-grid">
          <div class="stat">总题数<span class="num">${s.total}</span></div>
          <div class="stat">已作答<span class="num">${s.answered}</span></div>
          <div class="stat">正确<span class="num ok">${s.correct}</span></div>
          <div class="stat">错误<span class="num bad">${s.wrong}</span></div>
          <div class="stat">正确率<span class="num accent">${s.accuracy}%</span></div>
        </div>
        <div class="controls" style="margin-top:16px">
          <button class="primary" data-act="again">再来一套</button>
          <button data-act="wrong-strength">错题强化</button>
          <button data-act="stats">查看统计</button>
          <button class="ghost" data-act="home">返回首页</button>
        </div>
      </div>
      <div id="result-list">${items}</div>`;

    box.onclick = function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'again') App.startSetup({ specialPool: session.meta.specialPool, chapter: session.meta.chapter, type: session.meta.type });
      else if (a === 'wrong-strength') App.startSetup({ specialPool: 'wrong' });
      else if (a === 'stats') App.show('stats');
      else if (a === 'home') App.show('home');
    };
  }

  function init(app) { App = app; }

  root.MQViews = root.MQViews || {};
  root.MQViews.result = { render: render, init: init };

})(typeof window !== 'undefined' ? window : globalThis);
