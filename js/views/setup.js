/* =========================================================================
 * views/setup.js — 练习设置：范围 / 题量 / 随机选项 / 避免重复
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Quiz = root.MQQuiz, Parser = root.MQParser;

  var App = null;
  var POOL_NAMES = { all: '全部题目', wrong: '错题（未掌握）', favorite: '收藏题', unseen: '未做题', recentWrong: '最近做错的题', freqWrong: '高频错误题' };

  function render(prefill) {
    prefill = prefill || {};
    var box = Dom.$('#view-setup');
    var st = Bank.state.settings;

    var chapterOpts = '<option value="all">全部章节</option>' + Bank.state.chapters.map(function (c) {
      return '<option value="' + Dom.esc(c) + '"' + (prefill.chapter === c ? ' selected' : '') + '>' + Dom.esc(c) + '</option>';
    }).join('');

    var typeOpts = '<option value="all">全部题型</option>' + Bank.state.types.map(function (t) {
      return '<option value="' + Dom.esc(t) + '"' + (prefill.type === t ? ' selected' : '') + '>' + Dom.esc(Parser.typeLabel(t)) + '</option>';
    }).join('');

    var poolOpts = Object.keys(POOL_NAMES).map(function (k) {
      return '<option value="' + k + '"' + ((prefill.specialPool || 'all') === k ? ' selected' : '') + '>' + POOL_NAMES[k] + '</option>';
    }).join('');

    var counts = [5, 10, 20, 30, 50, 100];
    var defCount = prefill.count || st.defaultCount || 20;
    var countOpts = counts.map(function (n) {
      return '<option value="' + n + '"' + (defCount === n ? ' selected' : '') + '>' + n + '</option>';
    }).join('') + '<option value="custom"' + (counts.indexOf(defCount) < 0 ? ' selected' : '') + '>自定义</option>';

    box.innerHTML = `
      <div class="card">
        <h2>开始练习</h2>
        <div class="controls">
          <label class="field">题库范围
            <select id="s-pool">${poolOpts}</select>
          </label>
          <label class="field">章节
            <select id="s-chapter">${chapterOpts}</select>
          </label>
          <label class="field">题型
            <select id="s-type">${typeOpts}</select>
          </label>
          <label class="field">题目数量
            <select id="s-count">${countOpts}</select>
          </label>
          <label class="field ${counts.indexOf(defCount) >= 0 ? 'hidden' : ''}" id="s-count-custom-wrap">
            自定义数量
            <input type="number" id="s-count-custom" min="1" value="${counts.indexOf(defCount) >= 0 ? 20 : defCount}">
          </label>
        </div>
        <p class="muted" id="s-pool-info" style="margin:10px 0 0"></p>
      </div>

      <div class="card">
        <h2>随机设置</h2>
        <div class="controls">
          <label class="field">避免最近 N 次出现过的题目
            <input type="number" id="s-avoid" min="0" max="10" value="${st.avoidRecentN == null ? 1 : st.avoidRecentN}" style="width:100px">
          </label>
          <label class="field" style="flex-direction:row;align-items:center;gap:8px;padding-bottom:8px">
            <input type="checkbox" id="s-shuffle-opts" ${st.shuffleOptions ? 'checked' : ''}>
            随机打乱选项顺序
          </label>
        </div>
        <p class="muted">同一套练习中题目不会重复；数量超过题库时会自动使用全部符合条件的题目。</p>
      </div>

      <div class="controls">
        <button class="primary big" data-act="start">开始练习</button>
        <button class="ghost big" data-act="back">返回首页</button>
      </div>`;

    refreshInfo();
    bind();
  }

  function readFilters() {
    return {
      specialPool: Dom.$('#s-pool').value,
      chapter: Dom.$('#s-chapter').value,
      type: Dom.$('#s-type').value
    };
  }

  function readCount() {
    var v = Dom.$('#s-count').value;
    if (v === 'custom') return Math.max(1, parseInt(Dom.$('#s-count-custom').value, 10) || 20);
    return parseInt(v, 10);
  }

  function refreshInfo() {
    var pool = Bank.buildPool(readFilters());
    var info = Dom.$('#s-pool-info');
    if (info) info.textContent = '当前范围共 ' + pool.length + ' 道题，本次将抽取 ' + Math.min(readCount(), pool.length) + ' 道。';
  }

  function bind() {
    var box = Dom.$('#view-setup');
    box.onchange = function () {
      var wrap = Dom.$('#s-count-custom-wrap');
      if (wrap) {
        if (Dom.$('#s-count').value === 'custom') wrap.classList.remove('hidden');
        else wrap.classList.add('hidden');
      }
      refreshInfo();
    };
    box.onclick = function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.getAttribute('data-act') === 'start') {
        var filters = readFilters();
        var count = readCount();
        var opts = {
          count: count,
          shuffleOptions: Dom.$('#s-shuffle-opts').checked,
          avoidRecentN: parseInt(Dom.$('#s-avoid').value, 10)
        };
        Bank.state.settings.defaultCount = count;
        Bank.state.settings.shuffleOptions = opts.shuffleOptions;
        Bank.state.settings.avoidRecentN = opts.avoidRecentN;
        Bank.saveSettings();
        App.startQuiz({ filters: filters, opts: opts });
      } else {
        App.show('home');
      }
    };
  }

  function init(app) { App = app; }

  root.MQViews = root.MQViews || {};
  root.MQViews.setup = { render: render, init: init };

})(typeof window !== 'undefined' ? window : globalThis);
