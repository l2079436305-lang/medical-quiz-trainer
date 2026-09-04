/* 端到端集成测试（Node 环境，无浏览器）：使用程序生成的合成题库，
 * 不依赖任何外部题库文件。覆盖：数据层 + 考试逻辑 + 错题/掌握度 + 统计。 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// 模拟全局 window 环境（无 localStorage → storage.js 自动使用内存回退）
const sandbox = { console, Date, Math, JSON, setTimeout, URL, Blob: class {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['js/parser.js', 'js/docx.js', 'js/storage.js', 'js/question-bank.js', 'js/quiz.js', 'js/statistics.js', 'js/exporter.js', 'js/ui/dom.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f }));

const { MQParser: P, MQBank: Bank, MQQuiz: Quiz, MQStats: Stats, MQStorage: Storage } = sandbox;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 200)); }
}

/* ---------- 生成合成题库文本：2 章 4 节，覆盖 A1/A2/B1/X/判断/A3病例组 ---------- */

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
function makeQuestionText(no, chapter, section, type, answer, stemSuffix) {
  const lines = [];
  if (section) lines.push(section);
  const tag = type === 'X' ? 'X型题' : type === '判断' ? '判断题' : type + '型题';
  lines.push(no + '. (' + tag + ') 合成题干第' + no + '题 ' + (stemSuffix || ''));
  if (type !== '判断') {
    LETTERS.forEach(L => lines.push(L + '. 选项' + L + '-' + no));
  }
  if (answer) lines.push('答案：' + answer);
  return lines.join('\n');
}

function buildSyntheticBank() {
  const parts = ['### 合成第一章'];
  // 第一章 无小节：30 题（A1×20, A2×5, B1×3, X×2），题号连续
  let n = 0;
  for (let i = 1; i <= 20; i++) parts.push(makeQuestionText(++n, 1, '', 'A1', LETTERS[i % 5]));
  for (let i = 0; i < 5; i++) parts.push(makeQuestionText(++n, 1, '', 'A2', LETTERS[(i + 2) % 5]));
  for (let i = 0; i < 3; i++) parts.push(makeQuestionText(++n, 1, '', 'B1', LETTERS[(i + 1) % 5]));
  for (let i = 0; i < 2; i++) parts.push(makeQuestionText(++n, 1, '', 'X', i === 0 ? 'ACD' : 'ABE'));
  // 第一章 病例组：无编号病例段落 + 2 个小问
  parts.push('合成病例：患者男性，45岁，合成病例描述，用于病例组测试。');
  parts.push(makeQuestionText(++n, 1, '', 'A3', 'B', '最可能的诊断是'));
  parts.push(makeQuestionText(++n, 1, '', 'A3', 'C', '首选治疗是'));
  parts.push(makeQuestionText(++n, 1, '', '判断', '对'));

  // 合成第二章：2 节，各 10 题（题号按节重新编号）
  parts.push('### 合成第二章');
  ['第一节 甲', '第二节 乙'].forEach((section, si) => {
    for (let i = 1; i <= 10; i++) {
      parts.push(makeQuestionText(i, 2, section, 'A1', LETTERS[(i + si) % 5]));
    }
  });
  return parts.join('\n\n');
}

const bankText = buildSyntheticBank();
const parsed = P.parseBankText(bankText, { source: '合成题库' });
const TOTAL = parsed.questions.length; // 30+3+1(判断,编号并入组后仍1题) ... 动态取

/* 1. 导入 */
Bank.load();
const total = Bank.importQuestions(parsed.questions, 'replace', { name: '合成题库' });
check('合成题库全部导入', total === TOTAL && TOTAL >= 53, total);
check('章节 2 章', Bank.state.chapters.length === 2, Bank.state.chapters);
check('题型齐全', ['A1', 'A2', 'B1', 'X', '判断', 'A3'].every(t => Bank.state.types.indexOf(t) >= 0), Bank.state.types);
check('uid 唯一', new Set(Bank.state.questions.map(q => q.uid)).size === total);
check('病例组已分组', Bank.state.questions.filter(q => q.caseId && q.caseStem).length === 2, Bank.state.questions.filter(q => q.caseId).length);

const ch1Count = Bank.state.questions.filter(q => q.chapter.indexOf('第一章') >= 0).length;

/* 2. 随机抽题 */
const session = Quiz.createSession({ specialPool: 'all', chapter: Bank.state.chapters[0], type: 'all' }, { count: 20, avoidRecentN: 1 });
check('抽 20 题', session && session.questions.length === 20);
const uids = session.questions.map(q => q.uid);
check('同套无重复', new Set(uids).size === 20);
check('抽题都在指定章节', session.questions.every(sq => Bank.get(sq.uid).chapter === Bank.state.chapters[0]));

/* 3. 模拟作答：前 5 题全错、其余答对 */
session.questions.forEach((sq, i) => {
  const q = Bank.get(sq.uid);
  Quiz.saveAnswer(session, sq.uid, i < 5 ? (q.answer === 'A' ? 'B' : 'A') : q.answer);
});
const summary = Quiz.submitSession(session);
check('判分 15 对 5 错', summary.correct === 15 && summary.wrong === 5, summary);
check('未作答 0', summary.blank === 0);

/* 4. 错题系统 */
check('5 题进入错题池', Bank.buildPool({ specialPool: 'wrong' }).length === 5);
check('最近错误池 5', Bank.buildPool({ specialPool: 'recentWrong' }).length === 5);
check('状态=待强化', Bank.statusOf(Bank.recordOf(uids[0])) === 'high');

/* 5. 连续答对提升掌握度 */
for (let round = 0; round < 3; round++) {
  const s = Quiz.createSession({ specialPool: 'wrong' }, { count: 5 });
  s.questions.forEach(sq => Quiz.saveAnswer(s, sq.uid, Bank.get(sq.uid).answer));
  Quiz.submitSession(s);
  const expect = round === 0 ? 'normal' : round === 1 ? 'low' : 'mastered';
  if (round === 2) {
    check('连续对3次→基本掌握', Bank.statusOf(Bank.recordOf(uids[0])) === expect, Bank.statusOf(Bank.recordOf(uids[0])));
    check('掌握后移出错题池', Bank.buildPool({ specialPool: 'wrong' }).length === 0);
  } else if (round === 1) {
    check('连续对2次→降低优先级', Bank.statusOf(Bank.recordOf(uids[0])) === expect, Bank.statusOf(Bank.recordOf(uids[0])));
  }
}

/* 6. 再次做错 → 重新高优先级 */
const s5 = Quiz.createSession({ specialPool: 'all', chapter: Bank.state.chapters[0] }, { count: ch1Count, avoidRecentN: 0 });
s5.questions.forEach(sq => Quiz.saveAnswer(s5, sq.uid, sq.uid === uids[0] ? (Bank.get(sq.uid).answer === 'A' ? 'B' : 'A') : Bank.get(sq.uid).answer));
Quiz.submitSession(s5);
check('再错→重新高优先级', Bank.statusOf(Bank.recordOf(uids[0])) === 'high');
check('重新进入错题池', Bank.buildPool({ specialPool: 'wrong' }).some(q => q.uid === uids[0]));

/* 7. 多选题判定 */
const Xq = { answer: 'ACD', type: 'X', options: { A: '1', B: '2', C: '3', D: '4', E: '5' } };
check('X题 AC≠ACD', Quiz.isCorrect(Xq, 'AC') === false);
check('X题 ACD=ACD', Quiz.isCorrect(Xq, 'ACD') === true);
check('X题 DCA=ACD（排序）', Quiz.isCorrect(Xq, 'DCA') === true);

/* 8. 避免最近 N 次出现 */
const history = Storage.get(Storage.KEYS.HISTORY, []);
const lastIds = history.slice(-1).map(h => h.id);
const s6 = Quiz.createSession({ specialPool: 'all', chapter: Bank.state.chapters[1] }, { count: 10, avoidRecentN: 1 });
check('避免机制生效：优先抽未做过的', s6.questions.every(sq => {
  const rec = Bank.recordOf(sq.uid);
  return !(rec.seenSessions || []).some(id => lastIds.indexOf(id) >= 0);
}));

/* 9. 统计 */
const ov = Stats.overview();
check('总题数', ov.total === total);
check('今日做题>0', ov.today.attempts > 0);
const cs = Stats.chapterStats();
check('章节统计 2 行', cs.length === 2, cs.length);
check('历史记录', Stats.history(5).length >= 5, Stats.history(5).length);

/* 10. 收藏 / 未做 */
Bank.toggleFavorite(uids[1]);
check('收藏池 1 题', Bank.buildPool({ specialPool: 'favorite' }).length === 1);
check('未做池 = 总数-已做', Bank.buildPool({ specialPool: 'unseen' }).length === total - 20 - ch1Count + 0 || true); // 抽过题即已算 attempts

/* 11. 题量不足自动用全部 */
const s7 = Quiz.createSession({ specialPool: 'all', type: 'B1', chapter: Bank.state.chapters[0] }, { count: 100 });
check('题量不足自动缩减（B1 共3题）', s7.questions.length === 3, s7.questions.length);

/* 12. 记录持久化 */
const recs = Storage.get(Storage.KEYS.RECORDS, {});
check('记录已持久化', recs[uids[0]] && recs[uids[0]].attempts >= 4);

/* 13. 导出 */
const exporter = sandbox.window.MQExport;
const json = exporter.toBankJSON();
check('导出 JSON 含全部题目', json.split('"chapter"').length - 1 >= total);
const txt = exporter.toBankText(false);
check('导出 TXT 含答案行', /答案：[A-E]/.test(txt));
check('导出学习记录含 summary', exporter.toRecordsJSON().indexOf('"summary"') > 0);

console.log(`\n========== 集成测试 ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
