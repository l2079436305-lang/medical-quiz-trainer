/* =========================================================================
 * views/home.js — 首页：开始随机练习（主按钮）+ 快捷入口
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Quiz = root.MQQuiz, Stats = root.MQStats;
  var App = null;

  function render() {
    var box = Dom.$('#view-home');
    if (Bank.isEmpty()) {
      box.innerHTML = `
        <div class="card">
          <h2>欢迎使用医学题库通关</h2>
          <p class="muted">这是一个完全本地的个人题库训练器：数据只保存在你的浏览器里，不上传、不需登录、可离线使用。</p>
          <div class="hero-actions" style="margin-top:14px">
            <button class="primary big" data-act="go-import">导入题库</button>
            <button class="ghost big" data-act="load-demo">先加载示例题库体验</button>
          </div>
        </div>`;
      return;
    }

    var ov = Stats.overview();
    var active = Quiz.hasActive();

    box.innerHTML = `
      <div class="card">
        <div class="hero-actions">
          <button class="primary big" data-act="start-random">开始随机练习</button>
          ${active ? '<button class="ghost big" data-act="resume">继续上次练习（' + Quiz.loadSession().label + '，第 ' + (Quiz.loadSession().index + 1) + ' / ' + Quiz.loadSession().questions.length + ' 题）</button>' : ''}
          <div class="row">
            <button data-act="wrong">错题强化 <span class="muted">(${ov.wrongPool})</span></button>
            <button data-act="chapters">章节练习</button>
            <button data-act="all">全部题库</button>
            <button data-act="fav">收藏题 <span class="muted">(${ov.favorite})</span></button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>学习概况</h2>
        <div class="stat-grid">
          <div class="stat">今日做题<span class="num">${ov.today.attempts}</span></div>
          <div class="stat">今日正确率<span class="num ${ov.today.accuracy >= 80 ? 'ok' : ov.today.accuracy > 0 && ov.today.accuracy < 60 ? 'bad' : ''}">${ov.today.attempts ? ov.today.accuracy + '%' : '—'}</span></div>
          <div class="stat">总题数<span class="num">${ov.total}</span></div>
          <div class="stat">完成率<span class="num accent">${ov.completion}%</span></div>
          <div class="stat">总正确率<span class="num ${ov.overallAccuracy >= 80 ? 'ok' : ''}">${ov.overallAccuracy ? ov.overallAccuracy + '%' : '—'}</span></div>
          <div class="stat">待强化错题<span class="num ${ov.wrongPool ? 'bad' : ''}">${ov.wrongPool}</span></div>
        </div>
      </div>

      <div class="card">
        <h3>章节练习</h3>
        <div id="home-chapters"></div>
      </div>`;
    renderChapters(Dom.$('#home-chapters'));
  }

  function renderChapters(box) {
    var list = Stats.chapterStats().slice(0, 12);
    if (!list.length) { box.innerHTML = '<p class="muted">暂无数据</p>'; return; }
    var html = '<table class="list"><thead><tr><th>章节</th><th>题数</th><th>完成</th><th>正确率</th><th></th></tr></thead><tbody>';
    list.forEach(function (c) {
      html += `<tr class="clickable" data-chapter="${Dom.esc(c.chapter)}">
        <td>${Dom.esc(c.chapter)}</td>
        <td>${c.total}</td>
        <td><div class="bar"><i style="width:${c.doneRate}%"></i></div><span class="muted">${c.doneRate}%</span></td>
        <td>${c.correct + c.wrong ? c.accuracy + '%' : '—'}</td>
        <td><button class="ghost" data-chapter-go="${Dom.esc(c.chapter)}">练习</button></td>
      </tr>`;
    });
    html += '</tbody></table>';
    box.innerHTML = html;
  }

  function init(app) {
    App = app;
    var box = Dom.$('#view-home');
    box.addEventListener('click', function (e) {
      var go = e.target.closest('[data-chapter-go]');
      if (go) {
        App.startSetup({ chapter: go.getAttribute('data-chapter-go') });
        return;
      }
      var tr = e.target.closest('tr[data-chapter]');
      if (tr && !e.target.closest('button')) {
        App.startSetup({ chapter: tr.getAttribute('data-chapter') });
        return;
      }
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'go-import' || a === 'load-demo') App.show('import', a === 'load-demo' ? { demo: true } : null);
      else if (a === 'start-random') App.show('setup');
      else if (a === 'resume') App.startQuiz({ resume: true });
      else if (a === 'wrong') App.startSetup({ specialPool: 'wrong' });
      else if (a === 'all') App.startSetup({ specialPool: 'all' });
      else if (a === 'fav') App.startSetup({ specialPool: 'favorite' });
      else if (a === 'chapters') App.show('stats', { anchor: 'chapters' });
    });
  }

  root.MQViews = root.MQViews || {};
  root.MQViews.home = { render: render, init: init };

})(typeof window !== 'undefined' ? window : globalThis);
