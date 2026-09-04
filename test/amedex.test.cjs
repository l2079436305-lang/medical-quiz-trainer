/* amedex-2023 JSON 题库走应用完整链路验证 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const sandbox = { console, Date, Math, JSON, setTimeout, URL, Blob: class {} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['js/parser.js', 'js/storage.js', 'js/question-bank.js', 'js/quiz.js', 'js/statistics.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), sandbox, { filename: f }));

const { MQParser: P, MQBank: Bank, MQQuiz: Quiz, MQStats: Stats } = sandbox;

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 200)); }
}

/* 1. 应用的 JSON 导入路径 */
const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'amedex-2023.json'), 'utf8');
fs.copyFileSync(path.join(__dirname, 'fixtures', 'amedex-2023.json'), path.join(__dirname, '..', '题库-amedex-2023.json'));
const r = P.parseStructured(raw);

check('识别 1434 题', r.stats.total === 1434, r.stats.total);
check('答案全识别', r.stats.answered === 1434, r.stats.answered);
check('单章节', r.stats.chapters === 1, r.stats.chapters);
const uids = new Set(r.questions.map(q => q.uid));
check('uid 唯一', uids.size === 1434, uids.size);
check('题型 A1', r.stats.byType.A1 === 1434, r.stats.byType);
check('解析非空比例>99%', r.questions.filter(q => q.explanation).length > 1420, r.questions.filter(q => q.explanation).length);

/* 2. 抽查内容质量 */
const q1 = r.questions[0];
check('q1 题干', q1.title.indexOf('shoulder tip pain') > 0, q1.title.slice(0, 60));
check('q1 选项E', q1.options.E === 'Peptic ulcer disease.', q1.options.E);
check('q1 答案C', q1.answer === 'C');
const q2 = r.questions[1];
check('q2 答案D', q2.answer === 'D', q2.answer);
check('q2 解析含双抗', q2.explanation.indexOf('antiplatelet') >= 0 || q2.explanation.indexOf('aspirin') >= 0, q2.explanation.slice(0, 80));

/* 题干长度分布（过短说明解析出错） */
const shortTitles = r.questions.filter(q => q.title.length < 20);
check('无异常短题干', shortTitles.length === 0, shortTitles.map(q => q.num).slice(0, 10));

/* 3. 题库层 */
Bank.load();
Bank.importQuestions(r.questions, 'replace', { name: 'AMC amedex-2023' });
check('题库 1434', Bank.size() === 1434);

/* 4. 随机抽题 + 判分 + 错题闭环 */
const s1 = Quiz.createSession({ specialPool: 'all' }, { count: 20, avoidRecentN: 0 });
check('抽 20 题', s1 && s1.questions.length === 20);
s1.questions.forEach((sq, i) => {
  const q = Bank.get(sq.uid);
  Quiz.saveAnswer(s1, sq.uid, i < 6 ? (q.answer === 'A' ? 'B' : 'A') : q.answer);
});
const sum1 = Quiz.submitSession(s1);
check('判分 14/20', sum1.correct === 14 && sum1.wrong === 6, sum1);
check('错题池 6', Bank.buildPool({ specialPool: 'wrong' }).length === 6);
const s2 = Quiz.createSession({ specialPool: 'wrong' }, { count: 6 });
check('错题强化抽 6', s2.questions.length === 6);
s2.questions.forEach(sq => Quiz.saveAnswer(s2, sq.uid, Bank.get(sq.uid).answer));
Quiz.submitSession(s2);
const s3 = Quiz.createSession({ specialPool: 'wrong' }, { count: 6 });
s3.questions.forEach(sq => Quiz.saveAnswer(s3, sq.uid, Bank.get(sq.uid).answer));
Quiz.submitSession(s3);
const s4 = Quiz.createSession({ specialPool: 'wrong' }, { count: 6 });
s4.questions.forEach(sq => Quiz.saveAnswer(s4, sq.uid, Bank.get(sq.uid).answer));
Quiz.submitSession(s4);
check('连续 3 次答对→清空错题池', Bank.buildPool({ specialPool: 'wrong' }).length === 0);
check('基本掌握 6 题', Bank.state.questions.filter(q => Bank.statusOf(Bank.recordOf(q.uid)) === 'mastered').length === 6);

/* 5. 统计 */
const ov = Stats.overview();
check('统计已做 20', ov.attempted === 20, ov.attempted);
check('今日做题 38（4 场合计）', ov.today.attempts === 38, ov.today.attempts);
check('历史 4 场', Stats.history(10).length === 4);

console.log(`\n========== amedex 集成验证 ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
