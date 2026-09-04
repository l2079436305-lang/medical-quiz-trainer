/* =========================================================================
 * views/import.js — 导入（粘贴/文件/docx/txt/md/json/csv）+ 解析预览
 *                  + 异常题目手动修正 + 导出题库/学习记录 + 数据管理
 * ========================================================================= */

(function (root) {
  'use strict';

  var Dom = root.MQDom, Bank = root.MQBank, Parser = root.MQParser, Export = root.MQExport;

  var App = null;
  var pending = null;   // { questions, anomalies, stats, sourceName }

  var DEMO = `### 第一章 解剖学

1. (A1型题) 腹股沟管深环的体表投影位于腹股沟韧带中点
A. 下方3cm
B. 上方3cm
C. 上方1cm
D. 上方2cm
E. 下方2cm
答案：B

2. (X型题) 下列属于腹股沟管结构的是
A. 腹股沟韧带
B. 联合腱
C. 腹内斜肌
D. 子宫圆韧带
E. 髂腹下神经
答案：ACDE

【题号 1】【休克】A

70-year-old man is brought to the Emergency Department because of light-headedness...

A. Metoprolol.
B. Dopamine.
C. Intravenous pacemaker.
D. Permanent pacemaker.
E. Adrenaline.

### 第二章 生理学

1. (判断题) 正常成人的静息心率约为每分钟 60-100 次。
答案：对`;

  function render(opts) {
    var box = Dom.$('#view-import');
    box.innerHTML = `
      <div class="card">
        <h2>导入题库</h2>
        <p class="muted">支持直接粘贴文本（Markdown / TXT / Word 复制内容），或导入文件：.docx / .txt / .md / .json / .csv。所有解析都在你的浏览器本地完成，题目不会离开这台设备。</p>
        <textarea id="i-text" placeholder="把题库粘贴到这里…

支持的写法：
1. (A1型题) 题干…… / A. xx / 答案：B
【题号 1】【休克】A（答案内嵌在标题行）
### 第一章 解剖学（章节标题）
文末统一答案区（参考答案 → 第X章 → 1.D　2.E）"></textarea>
        <div class="controls" style="margin-top:12px">
          <button class="primary" data-act="parse">解析预览</button>
          <button class="ghost" data-act="file">选择文件…（docx / txt / md / json / csv）</button>
          <input type="file" id="i-file" class="hidden" accept=".docx,.txt,.md,.markdown,.json,.csv">
          <button class="ghost" data-act="demo">加载示例</button>
        </div>
      </div>

      <div id="i-preview" class="hidden"></div>

      <div id="i-anomalies"></div>

      <div class="card">
        <h2>导出</h2>
        <div class="controls">
          <button data-act="exp-json" ${Bank.isEmpty() ? 'disabled' : ''}>导出题库 JSON</button>
          <button data-act="exp-txt" ${Bank.isEmpty() ? 'disabled' : ''}>导出题库 TXT</button>
          <button data-act="exp-md" ${Bank.isEmpty() ? 'disabled' : ''}>导出题库 Markdown</button>
          <button data-act="exp-rec" ${Bank.isEmpty() ? 'disabled' : ''}>导出学习记录 JSON</button>
        </div>
      </div>

      <div class="card">
        <h2>数据管理</h2>
        <p class="muted">本地占用约 ${(root.MQStorage.usage() / 1024 / 1024).toFixed(2)} MB。清空将删除题库、做题记录、收藏与统计，不可恢复（建议先导出备份）。</p>
        <div class="controls">
          <button class="danger" data-act="clear">清空全部本地数据</button>
        </div>
      </div>`;

    hidePreview();
    bind();
    if (opts && opts.demo) {
      Dom.$('#i-text').value = DEMO;
      Dom.toast('已载入示例题库，点击「解析预览」查看效果');
    } else {
      renderAnomalyEditor(); // 已导入题库若存在异常，提供修正入口
    }
  }

  function hidePreview() {
    var p = Dom.$('#i-preview');
    if (p) { p.classList.add('hidden'); p.innerHTML = ''; }
  }

  /* ------------------------------ 解析预览 ------------------------------ */

  function showPreview(result, sourceName) {
    pending = Object.assign({}, result, { sourceName: sourceName });
    var s = result.stats;
    var box = Dom.$('#i-preview');

    var typeRows = Object.keys(s.byType).map(function (t) {
      return `<tr><td>${Dom.esc(Parser.typeLabel(t))}</td><td><strong>${s.byType[t]}</strong></td></tr>`;
    }).join('');

    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="card">
        <h2>解析预览 ${sourceName ? '· ' + Dom.esc(sourceName) : ''}</h2>
        <div class="stat-grid">
          <div class="stat">成功识别<span class="num accent">${s.total}</span></div>
          <div class="stat">章节数<span class="num">${s.chapters}</span></div>
          <div class="stat">已识别答案<span class="num ok">${s.answered}</span></div>
          <div class="stat">未识别答案<span class="num ${s.unanswered ? 'bad' : ''}">${s.unanswered}</span></div>
          <div class="stat">异常题目<span class="num ${s.anomalies ? 'bad' : ''}">${s.anomalies}</span></div>
        </div>
        ${typeRows ? `<h3 style="margin-top:14px">题型分布</h3><table class="list"><tbody>${typeRows}</tbody></table>` : ''}
        ${s.answerKeyTotal ? `<p class="muted" style="margin-top:8px">文末答案区共 ${s.answerKeyTotal} 条，成功匹配 ${s.answerKeyMatched} 条。</p>` : ''}
        ${s.anomalies ? `<p class="muted" style="margin-top:8px">⚠ 有 ${s.anomalies} 道题目解析异常（缺答案/缺选项/题号重复等），这些题目已保留，可在下方手动修正后一并导入。</p>` : ''}
        <div class="controls" style="margin-top:14px">
          <label class="field">导入方式
            <select id="i-mode">
              <option value="replace">覆盖现有题库</option>
              <option value="append" ${Bank.isEmpty() ? 'disabled' : ''}>追加到现有题库（按题目去重）</option>
            </select>
          </label>
          <button class="primary" data-act="confirm-import">确认导入</button>
          <button class="ghost" data-act="cancel-import">取消</button>
        </div>
      </div>
      <div id="i-anomalies"></div>`;

    renderAnomalyEditor(result.anomalies);
    box.scrollIntoView({ behavior: 'smooth' });
  }

  /* --------------------------- 异常题目编辑器 --------------------------- */

  function renderAnomalyEditor(anomalies) {
    var wrap = Dom.$('#i-anomalies');
    if (!wrap) return;
    var list = anomalies && anomalies.length
      ? anomalies
      : (Bank.isEmpty() ? [] : (function () {
          // 已导入题库：病例缺失按组去重，其余异常逐题列出
          var seenCase = {};
          var out = [];
          Bank.state.questions.forEach(function (q) {
            if (!q.anomalies || !q.anomalies.length) return;
            if (q.anomalies.indexOf('case-stem-missing') >= 0) {
              if (q.caseId && seenCase[q.caseId]) return;
              seenCase[q.caseId] = true;
            }
            out.push({
              uid: q.uid, kind: q.anomalies[0], num: q.num,
              chapter: q.chapter, section: q.section,
              message: q.anomalies.indexOf('case-stem-missing') >= 0 ? '病例共用题干缺失' : anomalyText(q)
            });
          });
          return out;
        })());

    if (!list.length) {
      wrap.innerHTML = anomalies && anomalies.length === 0 && !Bank.isEmpty()
        ? '' : '<div class="card hidden"></div>';
      return;
    }

    var KIND_TEXT = {
      'no-answer': '没有识别到答案',
      'no-options': '没有识别到选项',
      'dup-number': '题号重复',
      'unknown-type': '无法判断题型',
      'answer-invalid': '答案不在选项中',
      'multi-answer': '多个答案字母',
      'case-stem-missing': '病例共用题干缺失'
    };

    var html = `<div class="card">
      <h2>解析异常题目（${list.length}） <span class="muted">请手动修正后点击保存修正</span></h2>`;

    function findQ(uid) {
      if (pending) {
        for (var i = 0; i < pending.questions.length; i++) {
          if (pending.questions[i].uid === uid) return pending.questions[i];
        }
      }
      return Bank.get(uid) || null;
    }

    list.slice(0, 200).forEach(function (a, idx) {
      var q = findQ(a.uid);
      var isCase = a.kind === 'case-stem-missing';
      html += `<div class="anomaly-item" data-idx="${idx}">
        <div class="msg">第 ${a.num} 题解析异常 · ${Dom.esc(a.chapter)}${a.section ? ' / ' + Dom.esc(a.section) : ''} · ${KIND_TEXT[a.kind] || a.message || ''}</div>
        ${a.message && a.kind === 'case-stem-missing' ? `<div class="muted" style="margin-bottom:8px">${Dom.esc(a.message)}</div>` : ''}
        ${isCase
          ? `<input type="text" data-f="casestem" value="${Dom.esc((q && q.caseStem) || '')}" placeholder="病例共用题干（补录后对该组所有小问生效）" style="margin-bottom:6px">`
          : `<input type="text" data-f="title" value="${Dom.esc((q && q.title) || a.title || '')}" placeholder="题干">`}
        ${isCase ? '' : `<div class="opts-grid">
          ${'ABCDE'.split('').map(function (L) {
            var v = q && q.options ? (q.options[L] || '') : '';
            return `<input type="text" data-f="opt-${L}" value="${Dom.esc(v)}" placeholder="选项 ${L}">`;
          }).join('')}
        </div>
        <div class="controls" style="margin-top:8px">
          <input type="text" data-f="answer" value="${Dom.esc((q && q.answer) || '')}" placeholder="答案（如 B 或 ACD）" style="flex:1">
          <select data-f="type" style="flex:1">
            ${['', 'A1', 'A2', 'A3', 'A4', 'B1', 'X', '判断'].map(function (t) {
              var qType = q ? q.type : '';
              return `<option value="${t}" ${qType === t ? 'selected' : ''}>${t ? Dom.esc(Parser.typeLabel(t)) : '（未知题型）'}</option>`;
            }).join('')}
          </select>
        </div>`}
        <div class="controls" style="margin-top:8px">
          <button data-fix="${idx}" data-uid="${Dom.esc(a.uid)}" data-case="${isCase ? 1 : 0}">保存修正</button>
        </div>
      </div>`;
    });

    if (list.length > 200) html += `<p class="muted">仅显示前 200 条异常，修正后其余异常可在题库统计中继续处理。</p>`;
    html += '</div>';
    wrap.innerHTML = html;

    wrap.onclick = function (e) {
      var btn = e.target.closest('[data-fix]');
      if (!btn) return;
      var item = btn.closest('.anomaly-item');
      var uid = btn.getAttribute('data-uid');
      var isCase = btn.getAttribute('data-case') === '1';
      var patch;
      if (isCase) {
        patch = { caseStem: item.querySelector('[data-f=casestem]').value.trim() };
      } else {
        patch = {
          title: item.querySelector('[data-f=title]').value.trim(),
          options: {},
          answer: Parser.normalizeAnswer(item.querySelector('[data-f=answer]').value),
          type: item.querySelector('[data-f=type]').value
        };
        'ABCDE'.split('').forEach(function (L) {
          var v = item.querySelector('[data-f=opt-' + L + ']').value.trim();
          if (v) patch.options[L] = v;
        });
        patch.typeLabel = patch.type ? Parser.typeLabel(patch.type) : '';
      }
      patch.anomalies = [];

      function applyCaseStem(target) {
        // 病例题干对该组所有小问生效
        var cid = target.caseId;
        var n = 0;
        var scope = pending ? pending.questions : Bank.state.questions;
        for (var i = 0; i < scope.length; i++) {
          if (scope[i].caseId && scope[i].caseId === cid) {
            if (pending) Object.assign(scope[i], patch);
            else Bank.updateQuestion(scope[i].uid, patch);
            n++;
          }
        }
        return n;
      }

      function markFixed() {
        item.style.opacity = '.45';
        btn.textContent = '已修正';
        btn.disabled = true;
      }

      if (isCase) {
        var first = findQ(uid);
        if (first) {
          applyCaseStem(first);
          markFixed();
          Dom.toast('病例题干已补录，对全组生效');
        }
      } else if (pending) {
        // 预览阶段修正：直接改待导入数据
        var target = findQ(uid);
        if (target) {
          Object.assign(target, patch);
          pending.stats.anomalies = Math.max(0, pending.stats.anomalies - 1);
          markFixed();
          Dom.toast('已修正，确认导入后生效');
        }
      } else {
        var updated = Bank.updateQuestion(uid, patch);
        if (updated) {
          markFixed();
          Dom.toast('修正已保存');
        }
      }
    };
  }

  function anomalyText(q) {
    var msgs = [];
    if (!q.answer) msgs.push('没有答案');
    if (Object.keys(q.options || {}).length < 2) msgs.push('缺少选项');
    if (!q.type) msgs.push('题型未知');
    return msgs.join('、') || '存在异常';
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function bind() {
    var box = Dom.$('#view-import');

    box.onclick = function (e) {
      var act = e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'parse') doParse();
      else if (a === 'file') Dom.$('#i-file').click();
      else if (a === 'demo') { Dom.$('#i-text').value = DEMO; Dom.toast('已载入示例，点击「解析预览」'); }
      else if (a === 'confirm-import') doConfirmImport();
      else if (a === 'cancel-import') { pending = null; hidePreview(); }
      else if (a === 'exp-json') Export.downloadBankJSON();
      else if (a === 'exp-txt') Export.downloadBankTXT();
      else if (a === 'exp-md') Export.downloadBankMD();
      else if (a === 'exp-rec') Export.downloadRecords();
      else if (a === 'clear') doClear();
    };

    var fileInput = Dom.$('#i-file');
    fileInput.onchange = function () {
      var f = fileInput.files[0];
      if (!f) return;
      readFile(f);
      fileInput.value = '';
    };
  }

  function doParse() {
    var text = Dom.$('#i-text').value.trim();
    if (!text) { Dom.toast('请先粘贴题库文本或选择文件', 'error'); return; }
    runParse(text, '粘贴文本');
  }

  function runParse(text, sourceName) {
    try {
      var result = Parser.parseAny(text);
      if (!result.questions.length) {
        Dom.toast('没有识别到题目：请确认题号形如 "1. xxx" 或 "【题号 1】xxx"', 'error');
        return;
      }
      showPreview(result, sourceName);
    } catch (err) {
      Dom.toast('解析失败：' + err.message, 'error');
    }
  }

  function doConfirmImport() {
    if (!pending) return;
    var mode = Dom.$('#i-mode').value;
    try {
      var total = Bank.importQuestions(pending.questions, mode, { name: pending.sourceName });
      pending = null;
      hidePreview();
      renderAnomalyEditor(); // 刷新遗留异常列表
      Dom.toast('导入成功，题库共 ' + total + ' 题');
      App.onBankChanged();
      App.show('home');
    } catch (err) {
      Dom.toast(err.quota ? err.message : '导入失败：' + err.message, 'error');
    }
  }

  function readFile(file) {
    var name = file.name;
    var lower = name.toLowerCase();
    var reader = new FileReader();
    if (lower.endsWith('.docx')) {
      reader.onload = function () {
        root.MQDocx.extractDocxText(reader.result).then(function (text) {
          Dom.$('#i-text').value = text;
          runParse(text, name);
        }).catch(function (err) {
          Dom.toast(err.message, 'error');
        });
      };
      reader.readAsArrayBuffer(file);
      return;
    }
    reader.onload = function () {
      var text = String(reader.result || '');
      Dom.$('#i-text').value = text;
      runParse(text, name);
    };
    reader.readAsText(file, 'utf-8');
  }

  function doClear() {
    if (!Dom.confirmBox('确定清空全部本地数据（题库、记录、统计）？此操作不可恢复！')) return;
    if (!Dom.confirmBox('再次确认：真的要删除所有数据吗？建议先导出备份。')) return;
    Bank.clearBank();
    root.MQQuiz.clearSession();
    Dom.toast('已清空全部数据');
    App.onBankChanged();
    render();
  }

  function init(app) { App = app; }

  root.MQViews = root.MQViews || {};
  root.MQViews.import = { render: render, init: init };

})(typeof window !== 'undefined' ? window : globalThis);
