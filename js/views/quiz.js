/* =========================================================================
 * views/quiz.js — 答题界面：题号/进度/选项/标记/答题卡，提交前不显示答案
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Quiz = root.MQQuiz, Parser = root.MQParser;

  var App = null;
  var session = null;

  function setSession(s) { session = s; }

  function render() {
    if (!session || !session.questions.length) {
      App.show('home');
      return;
    }
    var box = Dom.$('#view-quiz');
    var q = Bank.get(session.questions[session.index].uid);
    if (!q) { App.show('home'); return; }
    var sq = session.questions[session.index];
    var flags = session.flags[q.uid] || {};
    var userAns = session.answers[q.uid] || '';
    var isMulti = q.type === 'X';
    var nTotal = session.questions.length;

    var optionsHtml = (sq.options || []).map(function (o) {
      var sel = userAns.indexOf(o.letter) >= 0;
      return `<label class="option ${sel ? 'selected' : ''}">
        <input type="${isMulti ? 'checkbox' : 'radio'}" name="opt" value="${o.letter}" ${sel ? 'checked' : ''}>
        <span class="letter">${o.letter}.</span>
        <span class="text">${Dom.esc(o.text)}</span>
      </label>`;
    }).join('');

    var paletteHtml = session.questions.map(function (sqq, i) {
      var cls = [];
      if (session.answers[sqq.uid]) cls.push('answered');
      if (session.flags[sqq.uid] && session.flags[sqq.uid].marked) cls.push('marked');
      if (i === session.index) cls.push('current');
      return `<button class="${cls.join(' ')}" data-jump="${i}">${i + 1}</button>`;
    }).join('');

    box.innerHTML = `
      <div class="card">
        <div class="quiz-head">
          <strong>第 ${session.index + 1} / ${nTotal} 题</strong>
          <span class="chip">${Dom.esc(q.chapter)}</span>
          ${q.section ? `<span class="chip">${Dom.esc(q.section)}</span>` : ''}
          <span class="chip type">${Dom.esc(Parser.typeLabel(q.type))}${isMulti ? '（多选）' : ''}</span>
          ${Parser.isCaseType(q.type) && q.caseTotal ? `<span class="chip">病例题 第 ${q.caseIndex} / ${q.caseTotal} 问</span>` : ''}
          ${flags.marked ? '<span class="chip warn">已标记</span>' : ''}
          ${flags.unsure ? '<span class="chip warn">不确定</span>' : ''}
        </div>
        <div class="progress"><i style="width:${Math.round(((session.index + 1) / nTotal) * 100)}%"></i></div>
      </div>

      <div class="card">
        ${q.caseStem ? `<div class="case-stem"><span class="chip warn">病例共用题干</span><div class="case-stem-text">${Dom.esc(q.caseStem)}</div></div>` : ''}
        ${Parser.isCaseType(q.type) && !q.caseStem ? '<p class="muted" style="margin:0 0 6px">⚠ 本病例的共用题干在题库中缺失，可在「导入 / 导出」页补录。</p>' : ''}
        ${q.image ? `<img class="q-image" src="${Dom.esc(q.image)}" alt="题目图片">` : ''}
        <div class="q-title">${Dom.esc(q.title)}</div>
        <div id="opt-box">${optionsHtml}</div>
        <div class="quiz-actions">
          <button data-nav2="prev" ${session.index === 0 ? 'disabled' : ''}>上一题</button>
          <button data-nav2="mark">${flags.marked ? '取消标记' : '标记'}</button>
          <button data-nav2="unsure">${flags.unsure ? '取消不确定' : '不确定'}</button>
          <span class="spacer"></span>
          <button data-nav2="next" ${session.index === nTotal - 1 ? 'disabled' : ''}>下一题</button>
          <button class="primary" data-nav2="submit">提交</button>
        </div>
      </div>

      <div class="card">
        <h3>答题卡 <span class="muted">（绿底=已作答，黄底=已标记）</span></h3>
        <div class="palette">${paletteHtml}</div>
      </div>`;

    bind(q);
  }

  function bind(q) {
    var box = Dom.$('#view-quiz');

    box.onchange = function (e) {
      var input = e.target.closest('input[name=opt]');
      if (!input) return;
      var isMulti = q.type === 'X';
      var userAns;
      if (isMulti) {
        var checked = Dom.$$('#view-quiz input[name=opt]:checked').map(function (i) { return i.value; });
        userAns = checked.sort().join('');
      } else {
        userAns = input.value;
      }
      Quiz.saveAnswer(session, q.uid, userAns);
      // 更新选中样式
      Dom.$$('#view-quiz .option').forEach(function (n) {
        var v = n.querySelector('input').value;
        n.classList.toggle('selected', userAns.indexOf(v) >= 0);
      });
      var btn = Dom.$(`.palette [data-jump="${session.index}"]`);
      if (btn) btn.classList.add('answered');
    };

    box.onclick = function (e) {
      var jump = e.target.closest('[data-jump]');
      if (jump) {
        session.index = parseInt(jump.getAttribute('data-jump'), 10);
        Quiz.saveSession(session);
        render();
        return;
      }
      var act = e.target.closest('[data-nav2]');
      if (!act) return;
      var a = act.getAttribute('data-nav2');
      if (a === 'prev' && session.index > 0) { session.index--; Quiz.saveSession(session); render(); }
      else if (a === 'next' && session.index < session.questions.length - 1) { session.index++; Quiz.saveSession(session); render(); }
      else if (a === 'mark') { Quiz.toggleFlag(session, q.uid, 'marked'); render(); }
      else if (a === 'unsure') { Quiz.toggleFlag(session, q.uid, 'unsure'); render(); }
      else if (a === 'submit') trySubmit();
    };
  }

  function trySubmit() {
    var total = session.questions.length;
    var answered = session.questions.filter(function (sq) { return session.answers[sq.uid]; }).length;
    var blank = total - answered;
    var msg = blank > 0
      ? `还有 ${blank} 题未作答，未作答按错误计分。\n确定提交试卷？`
      : '确定提交试卷？';
    if (!Dom.confirmBox(msg)) return;
    var summary = Quiz.submitSession(session);
    App.showResult(session, summary);
  }

  function init(app) { App = app; }

  root.MQViews = root.MQViews || {};
  root.MQViews.quiz = { render: render, init: init, setSession: setSession };

})(typeof window !== 'undefined' ? window : globalThis);
