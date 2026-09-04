/* 端到端集成测试（Node 环境，无浏览器）：数据层 + 考试逻辑 + 统计 */
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

/* 1. 导入真实题库 */
const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'real-bank.txt'), 'utf8');
const parsed = P.parseBankText(text, { source: '执医3000' });
Bank.load();
const total = Bank.importQuestions(parsed.questions, 'replace', { name: '执医3000' });
check('导入 3000 题', total === 3000, total);
check('章节 26', Bank.state.chapters.length === 26, Bank.state.chapters.length);
check('题型 4 种', Bank.state.types.length === 4, Bank.state.types);

/* 2. 随机抽题：解剖学 20 题 */
const session = Quiz.createSession({ specialPool: 'all', chapter: '第一章 解剖学', type: 'all' }, { count: 20, avoidRecentN: 1 });
check('解剖学抽 20 题（章内共30）', session && session.questions.length === 20, session && session.questions.length);
const uids = session.questions.map(q => q.uid);
check('同套无重复', new Set(uids).size === 20);
check('抽题都在解剖学', session.questions.every(sq => Bank.get(sq.uid).chapter === '第一章 解剖学'));

/* 3. 模拟作答：全错 5 题、对 15 题 */
session.questions.forEach((sq, i) => {
  const q = Bank.get(sq.uid);
  Quiz.saveAnswer(session, sq.uid, i < 5 ? 'X'.replace('X', q.answer === 'A' ? 'B' : 'A') : q.answer);
});
const summary = Quiz.submitSession(session);
check('判分 15 对 5 错', summary.correct === 15 && summary.wrong === 5, summary);
check('未作答 0', summary.blank === 0);

/* 4. 错题系统 */
check('5 题进入错题池', Bank.buildPool({ specialPool: 'wrong' }).length === 5);
check('最近错误池 5', Bank.buildPool({ specialPool: 'recentWrong' }).length === 5);
check('状态=待强化', Bank.statusOf(Bank.recordOf(uids[0])) === 'high');

/* 5. 错题强化 + 连续答对提升掌握度 */
const s2 = Quiz.createSession({ specialPool: 'wrong' }, { count: 5 });
check('错题强化只抽错题', s2.questions.length === 5 && s2.questions.every(sq => {
  const rec = Bank.recordOf(sq.uid); return rec.wrong > 0;
}));
s2.questions.forEach(sq => Quiz.saveAnswer(s2, sq.uid, Bank.get(sq.uid).answer));
Quiz.submitSession(s2);
check('连续对1次→普通错题', Bank.statusOf(Bank.recordOf(uids[0])) === 'normal', Bank.statusOf(Bank.recordOf(uids[0])));

const s3 = Quiz.createSession({ specialPool: 'wrong' }, { count: 5 });
s3.questions.forEach(sq => Quiz.saveAnswer(s3, sq.uid, Bank.get(sq.uid).answer));
Quiz.submitSession(s3);
check('连续对2次→降低优先级(low)', Bank.statusOf(Bank.recordOf(uids[0])) === 'low', Bank.statusOf(Bank.recordOf(uids[0])));

const s4 = Quiz.createSession({ specialPool: 'wrong' }, { count: 5 });
s4.questions.forEach(sq => Quiz.saveAnswer(s4, sq.uid, Bank.get(sq.uid).answer));
Quiz.submitSession(s4);
check('连续对3次→基本掌握', Bank.statusOf(Bank.recordOf(uids[0])) === 'mastered', Bank.statusOf(Bank.recordOf(uids[0])));
check('掌握后移出错题池', Bank.buildPool({ specialPool: 'wrong' }).length === 0);

/* 6. 再次做错 → 重新进入高优先级 */
const s5 = Quiz.createSession({ specialPool: 'all', chapter: '第一章 解剖学' }, { count: 30, avoidRecentN: 0 });
const target = s5.questions.find(sq => sq.uid === uids[0]);
s5.questions.forEach(sq => Quiz.saveAnswer(s5, sq.uid, sq.uid === uids[0] ? (Bank.get(sq.uid).answer === 'A' ? 'B' : 'A') : Bank.get(sq.uid).answer));
Quiz.submitSession(s5);
check('再错→重新高优先级', Bank.statusOf(Bank.recordOf(uids[0])) === 'high', Bank.statusOf(Bank.recordOf(uids[0])));
check('重新进入错题池', Bank.buildPool({ specialPool: 'wrong' }).some(q => q.uid === uids[0]));

/* 7. 多选题判定：AC vs ACD = 错；ACD vs ACD = 对 */
const Xq = { answer: 'ACD', type: 'X', options: { A: '1', B: '2', C: '3', D: '4', E: '5' } };
check('X题 AC≠ACD', Quiz.isCorrect(Xq, 'AC') === false);
check('X题 ACD=ACD', Quiz.isCorrect(Xq, 'ACD') === true);
check('X题 DCA=ACD（排序）', Quiz.isCorrect(Xq, 'DCA') === true);
check('X题 ACDE≠ACD', Quiz.isCorrect(Xq, 'ACDE') === false);

/* 8. 避免最近 N 次出现 */
Bank.state.settings.avoidRecentN = 1;
const history = sandbox.MQStorage.get(sandbox.MQStorage.KEYS.HISTORY, []);
const lastIds = history.slice(-1).map(h => h.id);
const pool = Bank.buildPool({ specialPool: 'all', chapter: '第一章 解剖学' });
const seenCount = pool.filter(q => (Bank.recordOf(q.uid).seenSessions || []).some(id => lastIds.indexOf(id) >= 0)).length;
check('最近一次出现的题目数>0（供避免机制使用）', seenCount > 0, seenCount);
const s6 = Quiz.createSession({ specialPool: 'all', chapter: '第二章 生物化学' }, { count: 10, avoidRecentN: 1 });
check('避免机制生效：优先抽未做过的', s6.questions.every(sq => {
  const rec = Bank.recordOf(sq.uid);
  return !(rec.seenSessions || []).some(id => lastIds.indexOf(id) >= 0);
}), s6.questions.map(sq => {
  const rec = Bank.recordOf(sq.uid);
  return (rec.seenSessions || []).filter(id => lastIds.indexOf(id) >= 0).length;
}).filter(Boolean));

/* 9. 统计 Dashboard */
const ov = Stats.overview();
check('总题数 3000', ov.total === 3000);
check('已做 = 解剖学 30 题', ov.attempted === 30, ov.attempted);
check('今日做题>0', ov.today.attempts > 0);
check('待强化错题 1', ov.wrongPool === 1, ov.wrongPool);

const cs = Stats.chapterStats();
const anat = cs.find(c => c.chapter === '第一章 解剖学');
check('章节统计存在', !!anat && anat.total === 30, anat);
check('章节完成率 100%', anat.doneRate === 100);

const hist = Stats.history(5);
check('历史记录 5 次', hist.length === 5, hist.length);

/* 10. 收藏 */
Bank.toggleFavorite(uids[1]);
check('收藏池 1 题', Bank.buildPool({ specialPool: 'favorite' }).length === 1);

/* 11. 题量不足自动用全部 */
const s7 = Quiz.createSession({ specialPool: 'all', type: 'B1', chapter: '第一章 解剖学' }, { count: 100 });
check('题量不足自动缩减（B型共2题）', s7.questions.length === 2, s7.questions.length);

/* 12. 记录持久化（内存回退下 get 回读） */
const recs = Storage.get(Storage.KEYS.RECORDS, {});
check('记录已持久化', recs[uids[0]] && recs[uids[0]].attempts >= 4, recs[uids[0]]);

/* 13. 导出内容 */
const exporter = sandbox.window.MQExport;
const json = exporter.toBankJSON();
check('导出 JSON 含 3000 题', json.split('"chapter"').length - 1 >= 3000);
const txt = exporter.toBankText(false);
check('导出 TXT 含答案行', /答案：[A-E]/.test(txt));
const recJson = exporter.toRecordsJSON();
check('导出学习记录含 summary', recJson.indexOf('"summary"') > 0);

console.log(`\n========== 集成测试 ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
