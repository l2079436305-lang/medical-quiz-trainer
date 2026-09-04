/* =========================================================================
 * parser.js — 题库文本解析器（纯函数，可在浏览器与 Node 中运行）
 *
 * 输入：任意题库纯文本（TXT / Markdown / Word 转出的文本 / 粘贴文本）
 * 输出：{ questions, anomalies, stats }
 *
 * 兼容格式：
 *  1) "1. (A1型题) 题干" + 选项各占一行 或 选项挤在一行 "A.xxB.yyC..."
 *  2) "【题号 1】【休克】A" + 题干 + 选项行（答案内嵌在题号行末尾）
 *  3) "答案：B / 正确答案：C" 内联答案
 *  4) 文末统一答案区："参考答案" 标题 + "第X章/第X节" + "1.D　2.E　3.B"
 *  5) A3/A4 病例组题：一个共用病例题干 + 多个小问题，三种题干形式均支持，
 *     并能检测"病例题干缺失"（纯题目版常见）
 *  6) JSON / CSV 由 parseStructured / parseCSV 处理
 *
 * 解析分两遍（Block 两遍法）：
 *   Pass1 按题号行切块（确定每题的边界与章节上下文）；
 *   Pass2 逐块解析题干/选项/答案/解析；
 *   Pass3 组装病例组（利用块间前瞻，把上一块尾部的散落文本识别为
 *         下一组病例的共用题干，而不是错误拼进上一题的选项）。
 *
 * 不静默丢弃任何题目：无法解析的内容进入 anomalies，供用户手动修正。
 * ========================================================================= */

(function (root) {
  'use strict';

  /* ----------------------------- 基础工具 ----------------------------- */

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function normName(name) {
    return String(name || '').replace(/[\s　]+/g, '');
  }

  /** 答案归一化：字母排序；判断题 对/错 → T/F */
  function normalizeAnswer(ans) {
    if (ans === null || ans === undefined) return '';
    var s = String(ans).trim();
    if (!s) return '';
    if (/^(对|正确|√|T|true)$/i.test(s)) return 'T';
    if (/^(错|错误|×|X$|F|false)$/i.test(s)) return 'F';
    var letters = s.toUpperCase().replace(/[^A-E]/g, '').split('').sort();
    return Array.from(new Set(letters)).join('');
  }

  /* ----------------------------- 题型系统 -----------------------------
   * 题型不写死：别名表 + 推断规则可扩展（A3/A4/病例/图片/配伍/填空…）
   * ------------------------------------------------------------------ */

  var TYPE_ALIASES = [
    { re: /^A\s*1/i,            code: 'A1',   label: 'A1型' },
    { re: /^A\s*2/i,            code: 'A2',   label: 'A2型' },
    { re: /^A\s*3/i,            code: 'A3',   label: 'A3/A4型(病例)' },
    { re: /^A\s*4/i,            code: 'A4',   label: 'A3/A4型(病例)' },
    { re: /^B\s*1/i,            code: 'B1',   label: 'B1型' },
    { re: /^B\s*(型|$)/i,       code: 'B1',   label: 'B1型' },
    { re: /^(X|多选|不定项)/i,   code: 'X',    label: '多选题' },
    { re: /^(判断|是非)/i,       code: '判断', label: '判断题' },
    { re: /^(配伍|共用)/i,       code: 'B1',   label: 'B1型' },
    { re: /^(病例|案例分析)/i,   code: 'A3',   label: 'A3/A4型(病例)' }
  ];

  var TYPE_LABELS = {
    A1: 'A1型', A2: 'A2型', A3: 'A3/A4型(病例)', A4: 'A3/A4型(病例)',
    B1: 'B1型', X: '多选题', '判断': '判断题'
  };

  /** A3/A4 = 病例组题 */
  function isCaseType(code) { return code === 'A3' || code === 'A4'; }

  function typeLabel(code) {
    return TYPE_LABELS[code] || (code || '未知');
  }

  /** 从括号片段中识别题型，如 "(A1型题)" "【B型题】" */
  function matchTypeAlias(fragment) {
    var f = String(fragment || '').trim();
    if (!f) return null;
    for (var i = 0; i < TYPE_ALIASES.length; i++) {
      if (TYPE_ALIASES[i].re.test(f)) {
        return { code: TYPE_ALIASES[i].code, label: TYPE_ALIASES[i].label, raw: f };
      }
    }
    return null;
  }

  var TYPE_TAG_RE = /[(（【\[]\s*([^)）】\]]{1,14}?)\s*型?题?\s*[)）\]】]/g;

  /** 从题干开头剥离题型标注，返回 {title, type, typeRaw} */
  function extractTypeTag(title) {
    var m = TYPE_TAG_RE.exec(title);
    TYPE_TAG_RE.lastIndex = 0;
    // 只认可紧跟在题干开头的标注（允许前置少量空白）
    if (m && m.index <= 1) {
      var hit = matchTypeAlias(m[1]);
      if (hit) {
        return {
          title: (title.slice(0, m.index) + title.slice(m.index + m[0].length)).replace(/^\s+/, ''),
          type: hit.code, typeRaw: hit.raw, label: hit.label
        };
      }
    }
    return { title: title, type: '', typeRaw: '', label: '' };
  }

  /** 无标注时依据选项/答案推断题型 */
  function inferType(q) {
    if (q.type) return q;
    var keys = Object.keys(q.options || {});
    if (q.answer && q.answer.length > 1) { q.type = 'X'; return q; }
    if (keys.length >= 2 && keys.every(function (k) { return 'AB'.indexOf(k) >= 0; }) &&
        /对|错|正确|错误/.test(q.options.A + q.options.B || '')) {
      q.type = '判断'; return q;
    }
    if (keys.length >= 2) { q.type = 'A1'; return q; } // 无法区分 A1/A2，默认 A1
    return q;
  }

  /* --------------------------- 行级正则集合 --------------------------- */

  var RE_HEADING     = /^#{1,6}\s*(.+?)\s*$/;                                  // Markdown 标题
  var RE_CHAPTER     = /^(第[一二三四五六七八九十百零〇两\d]+[章节篇部分])(?:\s*[、.．:：\-—]?\s*(.*))?$/;
  var RE_QUESTION    = /^(?:【题号\s*(\d{1,4})】\s*(?:\d{1,4}\s*[.、．)）]\s*)?|(\d{1,4})\s*[.、．)）]\s*)(.*)$/;
  var RE_ANSWER_LINE = /^(?:正确答案|参考答案|标准答案|答案|Answer|Ans)\s*[:：]?\s*(.+?)\s*$/i;
  var RE_EXPLAIN     = /^(?:答案解析|解析|解释|说明)\s*[:：]?\s*(.*)$/;
  var RE_ANSWER_HEAD = /^(?:参考|正确|标准|试题)?答案(?:与解析|解析|部分|汇总|区)?\s*$/;
  var RE_PAIRS       = /(\d{1,4})\s*[.、．]\s*(对|错|正确|错误|[A-E]+)(?![A-Za-z0-9])/g;
  var RE_OPTION_MK   = /([A-E])\s*[.、．]/g;
  var RE_MD_IMAGE    = /!\[[^\]]*\]\(([^)]+)\)/g;

  /* --------------------------- 选项行切分 -----------------------------
   * 核心难点：一整行 "A.下方3cmB.上方3cm…E.下方2cm"
   * 策略：扫描 A-E 字母标记，仅接受字母严格递增的标记序列，
   *       中途乱序的标记视为选项正文的一部分。
   * ------------------------------------------------------------------ */

  function splitOptionsLine(line) {
    var candidates = [];
    var m;
    RE_OPTION_MK.lastIndex = 0;
    while ((m = RE_OPTION_MK.exec(line)) !== null) {
      candidates.push({ letter: m[1], value: m[1].charCodeAt(0), textStart: m.index + m[0].length, markStart: m.index });
    }
    var accepted = [];
    var last = 0;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.value > last && c.textStart < line.length + 1) {
        accepted.push(c);
        last = c.value;
      }
    }
    if (!accepted.length) return null;
    var parts = [];
    for (var j = 0; j < accepted.length; j++) {
      var end = j + 1 < accepted.length ? accepted[j + 1].markStart : line.length;
      var text = line.slice(accepted[j].textStart, end).trim();
      parts.push({ letter: accepted[j].letter, text: text });
    }
    // 标记前的引导文本（可能是题干续行）
    var lead = line.slice(0, accepted[0].markStart).trim();
    return { lead: lead, parts: parts };
  }

  function isOptionStartLine(line) {
    return /^[A-E]\s*[.、．]/.test(line);
  }

  /* =====================================================================
   * 主解析：parseBankText
   * ===================================================================== */

  function parseBankText(rawText, options) {
    options = options || {};
    var text = String(rawText || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    var lines = text.split('\n');

    /* ---------- Pass 0：定位文末答案区起点 ---------- */
    var answerStart = -1;
    var qStartCount = 0;
    for (var si = 0; si < lines.length; si++) {
      var sl = lines[si].trim();
      if (!sl) continue;
      var hm0 = sl.match(RE_HEADING);
      if (hm0) sl = hm0[1];
      if (RE_ANSWER_HEAD.test(sl)) { answerStart = si; break; }
      if (RE_CHAPTER.test(sl) || RE_QUESTION.test(sl)) qStartCount++;
      // 无"参考答案"标题的文档：出现答案键风格行即切换
      var pc = countPairs(sl);
      if (qStartCount > 0 && (pc >= 2 || (pc === 1 && /^\d{1,4}\s*[.、．]\s*(对|错|正确|错误|[A-E])\s*$/.test(sl)))) {
        answerStart = si;
        break;
      }
    }
    if (answerStart < 0) answerStart = lines.length;

    /* ---------- Pass 1：正文切块 ---------- */
    var blocks = [];          // { chapter, section, num, first, lines[], startIdx }
    var answerEntries = [];
    var chapter = '', section = '';
    var orphanText = 0;
    var cur = null;

    for (var i = 0; i < answerStart; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var hm = line.match(RE_HEADING);
      if (hm) line = hm[1];

      var cm = line.match(RE_CHAPTER);
      if (cm) {
        cur = null;
        if (cm[1].slice(-1) === '节') {
          section = line;
          if (!chapter) chapter = '未分类章节';
        } else {
          chapter = line;
          section = '';
        }
        continue;
      }

      var qm = line.match(RE_QUESTION);
      if (qm) {
        cur = {
          chapter: chapter || '未分类',
          section: section,
          num: parseInt(qm[1] || qm[2], 10),
          first: qm[3] || '',
          lines: [],
          startIdx: i
        };
        blocks.push(cur);
        continue;
      }

      if (cur) cur.lines.push(line);
      else orphanText++;
    }

    /* ---------- Pass 1b：解析答案区 ---------- */
    // 注意：不重置章节上下文 —— 答案区可能省略章节标题，沿用正文最后一个章节
    for (var ai = answerStart; ai < lines.length; ai++) {
      var aline = lines[ai].trim();
      if (!aline) continue;
      var ahm = aline.match(RE_HEADING);
      if (ahm) aline = ahm[1];
      var acm = aline.match(RE_CHAPTER);
      if (acm) {
        if (acm[1].slice(-1) === '节') {
          section = aline;
          if (!chapter) chapter = '未分类章节';
        } else {
          chapter = aline;
          section = '';
        }
        continue;
      }
      var pm;
      RE_PAIRS.lastIndex = 0;
      while ((pm = RE_PAIRS.exec(aline)) !== null) {
        answerEntries.push({
          chapter: normName(chapter), section: normName(section),
          num: parseInt(pm[1], 10), letter: normalizeAnswer(pm[2])
        });
      }
    }

    /* ---------- Pass 2：逐块解析内容 ---------- */
    var parsed = [];
    for (var bi = 0; bi < blocks.length; bi++) {
      parsed.push(parseBlock(blocks[bi], options));
    }

    /* ---------- Pass 3：病例组（A3/A4）组装 + 产出题目 ---------- */
    var questions = [];
    var anomalies = [];
    var seenNums = {};
    var caseGroups = [];
    var currentGroup = null;
    var prevEmit = null;      // 上一道已产出题目的信息 { num, type, chapter, section, trailing, blockRef }

    function closeGroup() {
      if (!currentGroup) return;
      var g = currentGroup;
      currentGroup = null;
      if (!g.members.length) return;
      for (var mi = 0; mi < g.members.length; mi++) {
        var mq = g.members[mi];
        mq.caseId = g.id;
        mq.caseStem = g.caseStem;
        mq.caseIndex = mi + 1;
        mq.caseTotal = g.members.length;
      }
      if (!g.caseStem.trim()) {
        // 病例共用题干缺失：常见于"纯题目版"，正文与答案区题号同步跳号
        var first = g.members[0];
        var hint = '';
        if (g.prevNum != null && first.num > g.prevNum + 1) hint = '，疑似原第 ' + (g.prevNum + 1) + ' 题为病例描述但本文档未包含';
        else if (g.prevNum == null && first.num > 1) hint = '，疑似本节开头缺病例描述';
        anomalies.push({
          uid: first.uid, num: first.num, chapter: first.chapter, section: first.section,
          kind: 'case-stem-missing', message: '病例共用题干缺失（第 ' +
            g.members.map(function (m) { return m.num; }).join('、') + ' 题共用）' + hint,
          title: first.title, caseId: g.id,
          caseNums: g.members.map(function (m) { return m.num; })
        });
        for (var wi = 0; wi < g.members.length; wi++) {
          if (g.members[wi].anomalies.indexOf('case-stem-missing') < 0) g.members[wi].anomalies.push('case-stem-missing');
        }
      }
      caseGroups.push(g);
    }

    for (var pi = 0; pi < parsed.length; pi++) {
      var b = parsed[pi];
      var bIsCase = isCaseType(b.type);

      if (!bIsCase) {
        closeGroup();
        var rawTrailing = b.trailing.slice(); // 供下一组病例提取共用题干
        // 非 A3 块：选项后的散落普通文本按旧行为并入最后一个选项
        applyTrailingToOptions(b);
        emitQuestion(b, questions, seenNums, anomalies);
        prevEmit = { num: b.num, type: b.type, chapter: b.chapter, section: b.section, trailing: rawTrailing, q: b };
        continue;
      }

      // A3/A4 块：章节/小节变化时切组
      if (currentGroup && (normName(currentGroup.chapter) !== normName(b.chapter) || normName(currentGroup.section) !== normName(b.section))) {
        closeGroup();
      }
      if (!currentGroup) {
        currentGroup = {
          id: 'case' + fnv1a(normName(b.chapter) + '||' + normName(b.section) + '||' + b.num + '||' + (b.title || '').slice(0, 40)),
          chapter: b.chapter, section: b.section,
          caseStem: '', members: [], preambleNums: [], prevNum: prevEmit ? prevEmit.num : null
        };
        // 共用题干来源1：紧邻上一块（非 A3）选项之后的散落段落
        if (prevEmit && prevEmit.trailing && prevEmit.trailing.length &&
            normName(prevEmit.chapter) === normName(b.chapter) &&
            normName(prevEmit.section) === normName(b.section) &&
            !isCaseType(prevEmit.type)) {
          currentGroup.caseStem = prevEmit.trailing.join(' ');
          // 该段落已被并入上一题最后一个选项，识别为病例题干后须从选项中剔除
          stripTrailingFromOptions(prevEmit.q, currentGroup.caseStem);
        }
      }

      // 共用题干来源2：编号但无选项无答案的 A3 块（下一个块也是 A3 时）
      var nextIsCase = pi + 1 < parsed.length && isCaseType(parsed[pi + 1].type) &&
        normName(parsed[pi + 1].chapter) === normName(b.chapter) &&
        normName(parsed[pi + 1].section) === normName(b.section);
      var noOptions = Object.keys(b.options).length === 0;
      if (noOptions && !b.answer && nextIsCase) {
        var stemPart = (b.title + (b.trailing.length ? ' ' + b.trailing.join(' ') : '')).trim();
        currentGroup.caseStem = (currentGroup.caseStem + ' ' + stemPart).trim();
        currentGroup.preambleNums.push(b.num);
        continue; // 该块是病例描述本身，不作为独立题目输出
      }

      // 普通小问题（组成员）：caseId/caseStem/caseIndex 在 closeGroup 时统一写入
      currentGroup.members.push(b);
      applyTrailingToOptions(b);
      emitQuestion(b, questions, seenNums, anomalies);
      prevEmit = { num: b.num, type: b.type, chapter: b.chapter, section: b.section, trailing: b.trailing };
    }
    closeGroup();

    /* ---------- 文末答案键 ↔ 题目匹配 ---------- */
    var matchInfo = matchAnswerKey(questions, answerEntries);
    for (var qi = 0; qi < questions.length; qi++) {
      var q = questions[qi];
      var ans = matchInfo.map[q.uid];
      if (ans && !q.answer) q.answer = ans;
    }

    /* ---------- 校验、推断与统计 ---------- */
    var stats = { total: 0, byType: {}, chapters: 0, answered: 0, unanswered: 0, anomalies: 0, orphanText: orphanText };
    var chapterSet = {};
    for (var wi = 0; wi < questions.length; wi++) {
      var w = questions[wi];
      inferType(w);
      if (w.type === '判断') fixJudgeType(w);
      validateQuestion(w, function (kind, message) {
        anomalies.push({
          uid: w.uid, num: w.num, chapter: w.chapter, section: w.section,
          kind: kind, message: message, title: w.title
        });
        if (w.anomalies.indexOf(kind) < 0) w.anomalies.push(kind);
      });
      stats.total++;
      stats.byType[w.type] = (stats.byType[w.type] || 0) + 1;
      chapterSet[w.chapter] = 1;
      if (w.answer) stats.answered++; else stats.unanswered++;
      if (w.answer && w.options[w.answer] === undefined && w.type !== '判断') {
        anomalies.push({
          uid: w.uid, num: w.num, chapter: w.chapter, section: w.section,
          kind: 'answer-invalid', message: '答案 ' + w.answer + ' 不在选项 A-E 中', title: w.title
        });
        if (w.anomalies.indexOf('answer-invalid') < 0) w.anomalies.push('answer-invalid');
      }
    }

    stats.chapters = Object.keys(chapterSet).length;
    stats.anomalies = anomalies.length;
    stats.anomalyList = anomalies;
    stats.unusedAnswerKeys = matchInfo.unused.slice(0, 50);
    stats.answerKeyTotal = answerEntries.length;
    stats.answerKeyMatched = matchInfo.matchedCount;
    stats.caseGroups = caseGroups.length;
    stats.caseStemMissing = caseGroups.filter(function (g) { return !g.caseStem.trim() && g.members.length; }).length;

    assignIds(questions);
    return { questions: questions, anomalies: anomalies, stats: stats };
  }

  /* --------------------------- Pass 2：块解析 --------------------------- */

  function parseBlock(block, options) {
    var q = {
      num: block.num,
      chapter: block.chapter,
      section: block.section,
      type: '', typeRaw: '', typeLabel: '',
      title: block.first || '',
      options: {}, optionOrder: ['A', 'B', 'C', 'D', 'E'],
      answer: '', explanation: '',
      tags: [], source: options.source || '', images: [], image: '',
      anomalies: [], trailing: []
    };

    // 形如 "【休克】A" 的内嵌答案/标签（在题号行末尾）
    var bm = q.title.match(/^(?:【([^】]*)】\s*)+([A-E]{1,5})\s*$/);
    if (bm) {
      q.answer = normalizeAnswer(bm[2]);
      var tagRe = /【([^】]*)】/g, tg;
      while ((tg = tagRe.exec(bm[0])) !== null) q.tags.push(tg[1]);
      q.title = q.title.slice(bm[0].length).replace(/^\s+/, '');
    }

    var extracted = extractTypeTag(q.title);
    q.title = extracted.title;
    q.type = extracted.type;
    q.typeRaw = extracted.typeRaw;
    q.typeLabel = extracted.label;

    var sawOptions = false, inExplain = false;

    for (var i = 0; i < block.lines.length; i++) {
      var line = block.lines[i];

      // 内联答案行
      var am = line.match(RE_ANSWER_LINE);
      if (am) { q.answer = normalizeAnswer(am[1]); continue; }

      // 解析行
      var em = line.match(RE_EXPLAIN);
      if (em) {
        q.explanation = (q.explanation ? q.explanation + ' ' : '') + em[1];
        inExplain = true;
        continue;
      }

      // 选项行（含一行多选项）
      var split = splitOptionsLine(line);
      if (split && (isOptionStartLine(line) || split.parts.length >= 2)) {
        if (split.lead) {
          if (!sawOptions) q.title = (q.title + ' ' + split.lead).trim();
          else q.explanation = (q.explanation ? q.explanation + ' ' : '') + split.lead;
        }
        sawOptions = true;
        inExplain = false;
        for (var k = 0; k < split.parts.length; k++) {
          var p = split.parts[k];
          if (!q.options[p.letter]) q.options[p.letter] = p.text;
          else q.options[p.letter] += ' ' + p.text; // 选项换行续接
        }
        continue;
      }

      // 图片（Markdown 语法）
      if (line.indexOf('![') >= 0) {
        var im, imgFound = false;
        RE_MD_IMAGE.lastIndex = 0;
        while ((im = RE_MD_IMAGE.exec(line)) !== null) {
          q.images.push(im[1]);
          imgFound = true;
        }
        if (imgFound) {
          q.image = q.images[0];
          q.tags.push('图片题');
          line = line.replace(RE_MD_IMAGE, '').trim();
          if (!line) continue;
        }
      }

      // 普通文本：选项前 → 题干；解析中 → 解析；选项后 → 尾部缓冲（Pass 3 决定归属）
      if (!sawOptions && !inExplain) {
        q.title = (q.title + ' ' + line).trim();
      } else if (inExplain) {
        q.explanation = (q.explanation ? q.explanation + ' ' : '') + line;
      } else {
        q.trailing.push(line);
      }
    }

    return q;
  }

  /** 非 A3 块：选项后的散落文本并入最后一个选项（旧行为，保证兼容） */
  function applyTrailingToOptions(b) {
    if (b.trailingConsumed) return;
    if (!b.trailing.length) return;
    var keys = Object.keys(b.options);
    if (keys.length) {
      b.options[keys[keys.length - 1]] += ' ' + b.trailing.join(' ');
    } else {
      b.title = (b.title + ' ' + b.trailing.join(' ')).trim();
    }
    b.trailing = [];
  }

  /** 把误并入选项的病例题干文本从最后一个选项中剔除 */
  function stripTrailingFromOptions(q, trailingText) {
    if (!q || !trailingText) return;
    var keys = Object.keys(q.options);
    if (!keys.length) return;
    var lastKey = keys[keys.length - 1];
    var val = q.options[lastKey];
    if (val && val.length >= trailingText.length && val.slice(-trailingText.length) === trailingText) {
      var rest = val.slice(0, val.length - trailingText.length).trim();
      if (rest) q.options[lastKey] = rest;
      else delete q.options[lastKey];
    }
  }

  /* --------------------------- 产出/校验题目 --------------------------- */

  function emitQuestion(b, questions, seenNums, anomalies) {
    var q = b; // parseBlock 产出的对象即题目
    q.uid = makeUid(q);
    var key = normName(q.chapter) + '||' + normName(q.section) + '||' + q.num;
    if (seenNums[key]) {
      // 重复题号：保留题目但改用基于标题的 uid，避免记录互相覆盖
      q.uid = 'q' + fnv1a(key + '||' + (q.title || '').slice(0, 80) + '||' + questions.length);
      anomalies.push({
        uid: q.uid, num: q.num, chapter: q.chapter, section: q.section,
        kind: 'dup-number', message: '题号 ' + q.num + ' 重复出现', title: q.title
      });
      if (q.anomalies.indexOf('dup-number') < 0) q.anomalies.push('dup-number');
    }
    seenNums[key] = 1;
    questions.push(q);
    return q;
  }

  function validateQuestion(q, report) {
    var optCount = Object.keys(q.options).length;
    if (optCount === 0) report('no-options', '没有识别到选项');
    else if (optCount < 2) report('no-options', '选项不足 2 个');
    if (!q.answer) report('no-answer', '没有识别到答案');
    if (!q.type) report('unknown-type', '无法判断题型');
    if (optCount >= 2 && q.answer && q.answer.length > 1 && q.type !== 'X' && !isCaseType(q.type)) {
      report('multi-answer', '答案为多个字母，已按多选题处理');
      q.type = 'X';
    }
  }

  function makeUid(q) {
    return 'q' + fnv1a(normName(q.chapter) + '||' + normName(q.section) + '||' + q.num + '||' + (q.title || '').slice(0, 60));
  }

  function assignIds(questions) {
    for (var i = 0; i < questions.length; i++) questions[i].id = i + 1;
  }

  /* ------------------------- 判断题答案修正 ------------------------- */

  function fixJudgeType(q) {
    if (q.answer === 'T' || q.answer === 'F') {
      var hasAB = q.options.A !== undefined && q.options.B !== undefined;
      if (!hasAB) {
        q.options = { A: '正确', B: '错误' };
      }
      q.answer = q.answer === 'T' ? 'A' : 'B';
    }
  }

  /* ---------------------- 答案键匹配（多级回退） ----------------------
   * 1) 章节名完全一致：chapter|section|num
   * 2) 节名不一致：按节在章内出现顺序对齐
   * 3) 无节：chapter|*|num
   * 未匹配的题目保持无答案并计入异常，绝不丢弃。
   * ------------------------------------------------------------------ */

  function countPairs(line) {
    var n = 0, m;
    RE_PAIRS.lastIndex = 0;
    while ((m = RE_PAIRS.exec(line)) !== null) n++;
    return n;
  }

  function matchAnswerKey(questions, entries) {
    var map = {};        // uid -> answer
    var used = {};       // entry index -> true
    var matchedCount = 0;

    // 每章内节的出现顺序
    var bodySections = {};   // normChapter -> [normSection...]
    var keySections = {};
    var i, c, s;
    for (i = 0; i < questions.length; i++) {
      c = normName(questions[i].chapter); s = normName(questions[i].section);
      if (!bodySections[c]) bodySections[c] = [];
      if (s && bodySections[c].indexOf(s) < 0) bodySections[c].push(s);
    }
    for (i = 0; i < entries.length; i++) {
      c = entries[i].chapter; s = entries[i].section;
      if (!keySections[c]) keySections[c] = [];
      if (s && keySections[c].indexOf(s) < 0) keySections[c].push(s);
    }

    // 建立题目索引
    var qIndex = {};   // key -> question
    for (i = 0; i < questions.length; i++) {
      var q = questions[i];
      var qc = normName(q.chapter), qs = normName(q.section);
      var key = qc + '|' + qs + '|' + q.num;
      if (!qIndex[key]) qIndex[key] = q;
    }

    function lookupQuestion(chapter, section, num) {
      var key = chapter + '|' + section + '|' + num;
      if (qIndex[key]) return { q: qIndex[key], via: 'exact' };
      // 回退1：按节顺序对齐
      var bs = bodySections[chapter] || [];
      var ks = keySections[chapter] || [];
      if (section && bs.length) {
        var p = ks.indexOf(section);
        if (p >= 0 && bs[p]) {
          key = chapter + '|' + bs[p] + '|' + num;
          if (qIndex[key]) return { q: qIndex[key], via: 'section-order' };
        }
      }
      // 回退2：答案键无节但正文有节：找"该 num 唯一未匹配的题"
      if (!section && bs.length) {
        var cands = [];
        for (var bi = 0; bi < bs.length; bi++) {
          var t = qIndex[chapter + '|' + bs[bi] + '|' + num];
          if (t && !map[t.uid]) cands.push(t);
        }
        if (cands.length === 1) return { q: cands[0], via: 'unique-num' };
      }
      return null;
    }

    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      var hit = lookupQuestion(e.chapter, e.section, e.num);
      if (hit && !hit.q.answer && !map[hit.q.uid]) {
        map[hit.q.uid] = e.letter;
        used[i] = true;
        matchedCount++;
      }
    }

    var unused = [];
    for (i = 0; i < entries.length; i++) {
      if (!used[i]) unused.push(entries[i]);
    }
    return { map: map, unused: unused, matchedCount: matchedCount };
  }

  /* --------------------------- 结构化导入 --------------------------- */

  function parseStructured(raw) {
    var data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.questions)) data = data.questions;
      else throw new Error('JSON 结构不正确：应为题目数组');
    }
    var questions = [];
    var anomalies = [];
    for (var i = 0; i < data.length; i++) {
      var d = data[i] || {};
      var typeHit = matchTypeAlias(d.type || '');
      var q = {
        uid: '', num: i + 1,
        chapter: d.chapter || d.section || '未分类',
        section: d.section || '',
        type: typeHit ? typeHit.code : (d.type || ''),
        typeRaw: d.type || '', typeLabel: '',
        title: String(d.title || d.question || d.stem || '').trim(),
        options: {}, optionOrder: ['A', 'B', 'C', 'D', 'E'],
        answer: normalizeAnswer(d.answer || d.correct || ''),
        explanation: d.explanation || d.analysis || '',
        tags: d.tags || [], source: d.source || '',
        images: d.images || [], image: d.image || (d.images && d.images[0]) || '',
        anomalies: [],
        caseId: d.caseId || '', caseStem: d.caseStem || '',
        caseIndex: d.caseIndex || 0, caseTotal: d.caseTotal || 0
      };
      var opts = d.options || d.choices || {};
      if (Array.isArray(opts)) {
        for (var oi = 0; oi < opts.length; oi++) {
          var o = opts[oi];
          if (typeof o === 'string') q.options[String.fromCharCode(65 + oi)] = o;
          else if (o && o.key) q.options[String(o.key).toUpperCase().slice(0, 1)] = String(o.text || o.value || '');
        }
      } else if (opts && typeof opts === 'object') {
        Object.keys(opts).forEach(function (k) { q.options[String(k).toUpperCase().slice(0, 1)] = String(opts[k]); });
      }
      q.typeLabel = typeLabel(q.type);
      q.uid = makeUid(q);
      questions.push(q);
    }
    var stats = { total: questions.length, byType: {}, chapters: 0, answered: 0, unanswered: 0, anomalies: 0, orphanText: 0 };
    var chapterSet = {};
    for (var wi = 0; wi < questions.length; wi++) {
      var w = questions[wi];
      inferType(w);
      if (w.type === '判断') fixJudgeType(w);
      stats.byType[w.type] = (stats.byType[w.type] || 0) + 1;
      chapterSet[w.chapter] = 1;
      if (w.answer) stats.answered++; else stats.unanswered++;
    }
    stats.chapters = Object.keys(chapterSet).length;
    assignIds(questions);
    return { questions: questions, anomalies: anomalies, stats: stats };
  }

  /** CSV：表头 chapter,type,title,A,B,C,D,E,answer,explanation */
  function parseCSV(raw) {
    var rows = parseCSVRows(String(raw || ''));
    if (rows.length < 2) throw new Error('CSV 内容为空或缺少表头');
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    function col(row, name) { var idx = head.indexOf(name); return idx >= 0 ? (row[idx] || '') : ''; }
    var questions = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r.length || !r.join('').trim()) continue;
      var options = {};
      'ABCDE'.split('').forEach(function (L) { var v = col(r, L.toLowerCase()); if (v) options[L] = v; });
      var type = col(r, 'type') || col(r, '题型');
      var hit = matchTypeAlias(type);
      questions.push({
        uid: '', num: i, id: i,
        chapter: col(r, 'chapter') || col(r, '章节') || '未分类',
        section: col(r, 'section') || '',
        type: hit ? hit.code : type, typeRaw: type, typeLabel: hit ? hit.label : type,
        title: col(r, 'title') || col(r, '题干') || col(r, 'question'),
        options: options, optionOrder: ['A', 'B', 'C', 'D', 'E'],
        answer: normalizeAnswer(col(r, 'answer') || col(r, '答案')),
        explanation: col(r, 'explanation') || col(r, '解析') || '',
        tags: [], source: col(r, 'source') || '',
        images: [], image: '', anomalies: [],
        caseId: col(r, 'caseid') || '', caseStem: col(r, 'casestem') || col(r, '病例题干') || ''
      });
    }
    var stats = { total: questions.length, byType: {}, chapters: 0, answered: 0, unanswered: 0, anomalies: 0, orphanText: 0 };
    var chapterSet = {};
    for (var wi = 0; wi < questions.length; wi++) {
      var w = questions[wi];
      inferType(w); if (w.type === '判断') fixJudgeType(w);
      w.typeLabel = typeLabel(w.type);
      w.uid = makeUid(w);
      stats.byType[w.type] = (stats.byType[w.type] || 0) + 1;
      chapterSet[w.chapter] = 1;
      if (w.answer) stats.answered++; else stats.unanswered++;
    }
    stats.chapters = Object.keys(chapterSet).length;
    assignIds(questions);
    return { questions: questions, anomalies: [], stats: stats };
  }

  function parseCSVRows(text) {
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r') { /* skip */ }
        else field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /** 统一入口：根据内容自动选择解析方式 */
  function parseAny(raw, kind) {
    if (kind === 'json') return parseStructured(raw);
    if (kind === 'csv') return parseCSV(raw);
    if (kind === 'text') return parseBankText(raw);
    // 自动嗅探
    var head = String(raw || '').slice(0, 200).trim();
    if (head.charAt(0) === '[' || head.charAt(0) === '{') return parseStructured(raw);
    if (/^[^\n,]*,[^\n,]*,[^\n]*\n/.test(raw) && /\btype\b|\banswer\b|题型|答案/i.test(head)) return parseCSV(raw);
    return parseBankText(raw);
  }

  /* ------------------------------ 导出 ------------------------------ */

  var API = {
    parseBankText: parseBankText,
    parseStructured: parseStructured,
    parseCSV: parseCSV,
    parseAny: parseAny,
    normalizeAnswer: normalizeAnswer,
    matchTypeAlias: matchTypeAlias,
    typeLabel: typeLabel,
    isCaseType: isCaseType,
    makeUid: makeUid,
    splitOptionsLine: splitOptionsLine
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.MQParser = API;

})(typeof window !== 'undefined' ? window : globalThis);
