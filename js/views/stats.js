/* =========================================================================
 * views/stats.js — 统计 Dashboard：总览 / 章节统计 / 题型统计 / 错题本 / 历史
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Stats = root.MQStats, Parser = root.MQParser;

  var App = null;

  function render(opts) {
    var box = Dom.$('#view-stats');
    if (Bank.isEmpty()) {
      box.innerHTML = '<div class="card"><h2>统计</h2><p class="muted">尚未导入题库。请先到「导入 / 导出」导入题库。</p></div>';
      return;
    }
    var ov = Stats.overview();

    box.innerHTML = `
      <div class="card">
        <h2>今日学习</h2>
        <div class="stat-grid">
          <div class="stat">做题<span class="num">${ov.today.attempts}</span></div>
          <div class="stat">今日正确率<span class="num">${ov.today.attempts ? ov.today.accuracy + '%' : '—'}</span></div>
        </div>
        <h2 style="margin-top:18px">总体</h2>
        <div class="stat-grid">
          <div class="stat">总题数<span class="num">${ov.total}</span></div>
          <div class="stat">已做<span class="num">${ov.attempted}</span></div>
          <div class="stat">完成率<span class="num accent">${ov.completion}%</span></div>
          <div class="stat">总正确率<span class="num ${ov.overallAccuracy >= 80 ? 'ok' : ''}">${ov.overallAccuracy ? ov.overallAccuracy + '%' : '—'}</span></div>
          <div class="stat">错题<span class="num ${ov.wrongPool ? 'bad' : ''}">${ov.wrongPool}</span></div>
          <div class="stat">收藏<span class="num">${ov.favorite}</span></div>
          <div class="stat">未做<span class="num">${ov.unseen}</span></div>
          <div class="stat">基本掌握<span class="num ok">${ov.mastered}</span></div>
          <div class="stat">不确定标记<span class="num">${ov.unsure}</span></div>
          <div class="stat">累计练习<span class="num">${ov.sessions} 次</span></div>
        </div>
      </div>

      <div class="card" id="sec-chapters">
        <h2>章节统计 <span class="muted">（点击行可直接练习该章节）</span></h2>
        ${chapterTable()}
      </div>

      <div class="card">
        <h2>题型统计</h2>
        ${typeTable()}
      </div>

      <div class="card">
        <h2>错题本（按复习优先级） <span class="muted">共 ${Stats.wrongBook().length} 题待强化，已掌握的不再列出</span></h2>
        ${wrongTable()}
      </div>

      <div class="card">
        <h2>历史练习</h2>
        ${historyTable()}
      </div>`;

    bind();
    if (opts && opts.anchor) {
      var sec = Dom.$('#sec-' + opts.anchor);
      if (sec) sec.scrollIntoView();
    }
  }

  function chapterTable() {
    var list = Stats.chapterStats();
    if (!list.length) return '<p class="muted">暂无数据</p>';
    var html = '<table class="list"><thead><tr><th>章节</th><th>题数</th><th>完成率</th><th>正确率</th><th>已掌握</th><th></th></tr></thead><tbody>';
    list.forEach(function (c) {
      html += `<tr class="clickable" data-chapter="${Dom.esc(c.chapter)}">
        <td>${Dom.esc(c.chapter)}</td>
        <td>${c.total}</td>
        <td><div class="bar"><i style="width:${c.doneRate}%"></i></div> ${c.doneRate}%</td>
        <td><div class="bar"><i class="ok" style="width:${c.accuracy}%"></i></div> ${c.correct + c.wrong ? c.accuracy + '%' : '—'}</td>
        <td>${c.mastered}</td>
        <td><button class="ghost" data-chapter-go="${Dom.esc(c.chapter)}">练习</button></td>
      </tr>`;
    });
    return html + '</tbody></table>';
  }

  function typeTable() {
    var list = Stats.typeStats();
    var html = '<table class="list"><thead><tr><th>题型</th><th>题数</th><th>完成率</th><th>正确率</th><th></th></tr></thead><tbody>';
    list.forEach(function (t) {
      html += `<tr class="clickable" data-type="${Dom.esc(t.type)}">
        <td>${Dom.esc(t.label)}</td>
        <td>${t.total}</td>
        <td><div class="bar"><i style="width:${t.doneRate}%"></i></div> ${t.doneRate}%</td>
        <td>${t.correct + t.wrong ? t.accuracy + '%' : '—'}</td>
        <td><button class="ghost" data-type-go="${Dom.esc(t.type)}">练习</button></td>
      </tr>`;
    });
    return html + '</tbody></table>';
  }

  function wrongTable() {
    var list = Stats.wrongBook().slice(0, 50);
    if (!list.length) return '<p class="muted">太棒了，当前没有待强化的错题。</p>';
    var html = '<table class="list"><thead><tr><th>优先级</th><th>章节</th><th>题型</th><th>题干</th><th>错次</th><th></th></tr></thead><tbody>';
    list.forEach(function (it) {
      html += `<tr>
        <td><span class="chip ${it.status === 'high' ? 'bad' : it.status === 'low' ? 'ok' : 'warn'}">${Bank.STATUS_LABELS[it.status]}</span></td>
        <td>${Dom.esc(it.q.chapter)}</td>
        <td>${Dom.esc(Parser.typeLabel(it.q.type))}</td>
        <td style="max-width:280px">${Dom.esc(it.q.title.slice(0, 40))}…</td>
        <td>${it.rec.wrong}</td>
        <td><button class="ghost" data-wrong-view="${Dom.esc(it.q.uid)}">查看</button></td>
      </tr>`;
    });
    var more = Stats.wrongBook().length - list.length;
    if (more > 0) html += `<tr><td colspan="6" class="muted">还有 ${more} 题未显示，请优先强化前面的题目</td></tr>`;
    return html + '</tbody></table>';
  }

  function historyTable() {
    var list = Stats.history(30);
    if (!list.length) return '<p class="muted">还没有练习记录</p>';
    var html = '<table class="list"><thead><tr><th>时间</th><th>范围</th><th>题数</th><th>正确</th><th>正确率</th></tr></thead><tbody>';
    list.forEach(function (h) {
      html += `<tr>
        <td>${Dom.esc((h.finishedAt || h.at || '').replace('T', ' ').slice(0, 16))}</td>
        <td>${Dom.esc(h.label || '')}</td>
        <td>${h.total}</td>
        <td>${h.correct}</td>
        <td>${h.accuracy}%</td>
      </tr>`;
    });
    return html + '</tbody></table>';
  }

  function bind() {
    var box = Dom.$('#view-stats');
    box.onclick = function (e) {
      var cg = e.target.closest('[data-chapter-go]');
      if (cg) { App.startSetup({ chapter: cg.getAttribute('data-chapter-go') }); return; }
      var tg = e.target.closest('[data-type-go]');
      if (tg) { App.startSetup({ type: tg.getAttribute('data-type-go') }); return; }
      var tr = e.target.closest('tr[data-chapter]');
      if (tr && !e.target.closest('button')) { App.startSetup({ chapter: tr.getAttribute('data-chapter') }); return; }
      var trt = e.target.closest('tr[data-type]');
      if (trt && !e.target.closest('button')) { App.startSetup({ type: trt.getAttribute('data-type') }); return; }
      var wv = e.target.closest('[data-wrong-view]');
      if (wv) {
        App.startSetup({ specialPool: 'wrong' });
      }
    };
  }

  function init(app) { App = app; }

  root.MQViews = root.MQViews || {};
  root.MQViews.stats = { render: render, init: init };

})(typeof window !== 'undefined' ? window : globalThis);
