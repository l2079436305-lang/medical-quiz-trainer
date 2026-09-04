/* =========================================================================
 * app.js — 应用入口与路由
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Quiz = root.MQQuiz;

  var VIEWS = ['home', 'setup', 'quiz', 'result', 'stats', 'import'];
  var NAV_MAP = { home: 'home', stats: 'stats', import: 'import' };
  var current = 'home';

  function show(name, opts) {
    current = name;
    VIEWS.forEach(function (v) {
      var sec = Dom.$('#view-' + v);
      if (sec) sec.classList.toggle('hidden', v !== name);
    });
    // 导航高亮
    Dom.$$('.nav-tabs button').forEach(function (b) {
      b.classList.toggle('active', NAV_MAP[name] === b.getAttribute('data-nav'));
    });
    // 渲染对应视图
    if (name === 'home') MQViews.home.render();
    else if (name === 'setup') MQViews.setup.render(opts);
    else if (name === 'quiz') MQViews.quiz.render();
    else if (name === 'result') { /* 由 showResult 直接渲染 */ }
    else if (name === 'stats') MQViews.stats.render(opts);
    else if (name === 'import') MQViews.import.render(opts);
    window.scrollTo(0, 0);
  }

  /** 进入练习设置页 */
  function startSetup(prefill) {
    show('setup', prefill || {});
  }

  /** 开始 / 恢复一次练习 */
  function startQuiz(params) {
    params = params || {};
    var session;
    if (params.resume) {
      session = Quiz.loadSession();
      if (!session || session.submitted) { Dom.toast('没有进行中的练习'); show('home'); return; }
    } else {
      session = Quiz.createSession(params.filters, params.opts);
      if (!session) { Dom.toast('该范围没有符合条件的题目', 'error'); return; }
    }
    MQViews.quiz.setSession(session);
    show('quiz');
  }

  /** 交卷后展示结果 */
  function showResult(session, summary) {
    current = 'result';
    VIEWS.forEach(function (v) {
      Dom.$('#view-' + v).classList.toggle('hidden', v !== 'result');
    });
    MQViews.result.render(session, summary);
    window.scrollTo(0, 0);
  }

  function onBankChanged() {
    // 题库变化后清理遗留会话
    Quiz.clearSession();
  }

  function bindNav() {
    Dom.$$('.nav-tabs button, .brand').forEach(function (b) {
      b.addEventListener('click', function () {
        var target = b.getAttribute('data-nav');
        if (!target) return;
        if (current === 'quiz' && target !== 'quiz') {
          if (!Dom.confirmBox('练习尚未提交，离开后进度会保留，确定离开？')) return;
        }
        show(target);
      });
    });
  }

  function init() {
    Bank.load();
    MQViews.home.init(App);
    MQViews.setup.init(App);
    MQViews.quiz.init(App);
    MQViews.result.init(App);
    MQViews.stats.init(App);
    MQViews.import.init(App);
    bindNav();

    if (!root.MQStorage.available()) {
      warnNoPersistence();
    }

    if (Bank.isEmpty()) show('import');
    else if (Quiz.hasActive()) show('home');
    else show('home');
  }

  /** 本地存储不可用时（如微信预览/部分沙盒环境）给出醒目警告 */
  function warnNoPersistence() {
    var bar = Dom.el('div', { class: 'storage-warn' },
      '⚠ 当前打开方式不支持保存数据（做题记录将不会保留）。' +
      '请把整个文件夹拷贝到平板后，用 Chrome 打开 index.html（通过"打开方式"选择 Chrome），' +
      '或改用局域网方式访问。');
    var close = Dom.el('button', { class: 'ghost' }, '知道了');
    close.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(close);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  var App = {
    show: show,
    startSetup: startSetup,
    startQuiz: startQuiz,
    showResult: showResult,
    onBankChanged: onBankChanged
  };

  root.App = App;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

})(typeof window !== 'undefined' ? window : globalThis);
