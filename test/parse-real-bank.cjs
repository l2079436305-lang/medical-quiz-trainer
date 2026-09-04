/* 用真实题库验证解析器：统计识别数、答案匹配率、异常 */
'use strict';
const path = require('path');
const fs = require('fs');
const P = require(path.join(__dirname, '..', 'js', 'parser.js'));

const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'real-bank.txt'), 'utf8');
const t0 = Date.now();
const r = P.parseBankText(text, { source: '执医3000' });
const ms = Date.now() - t0;

const s = r.stats;
console.log('=== 真实题库解析结果 ===');
console.log('耗时:', ms + 'ms');
console.log('总题数:', s.total);
console.log('题型分布:', JSON.stringify(s.byType));
console.log('章节数:', s.chapters);
console.log('已识别答案:', s.answered, ' 未识别答案:', s.unanswered);
console.log('答案键条目:', s.answerKeyTotal, ' 成功匹配:', s.answerKeyMatched);
console.log('异常数:', s.anomalies);

const byKind = {};
for (const a of r.anomalies) byKind[a.kind] = (byKind[a.kind] || 0) + 1;
console.log('异常分类:', JSON.stringify(byKind));

console.log('\n=== 抽样检查 ===');
for (const i of [0, 1, 23, 28, 29, 30, 100, 500, 1500, 2999]) {
  if (i >= r.questions.length) continue;
  const q = r.questions[i];
  console.log(`\n#[${i}] ${q.chapter} / ${q.section || '-'} / 题号${q.num} [${q.type}] 答案:${q.answer || '无'}`);
  console.log('  题干:', q.title.slice(0, 50));
  console.log('  选项:', Object.keys(q.options).map(k => k + '.' + String(q.options[k]).slice(0, 12)).join(' | ').slice(0, 150));
}

// 无答案题目清单（前 20 条）
const noAns = r.questions.filter(q => !q.answer);
console.log('\n=== 无答案题目（前20）===');
for (const q of noAns.slice(0, 20)) {
  console.log(`- ${q.chapter} / ${q.section || '-'} / 题号${q.num} ${q.title.slice(0, 30)}`);
}

// 异常详情（前 20 条）
console.log('\n=== 异常（前20）===');
for (const a of r.anomalies.slice(0, 20)) {
  console.log(`- [${a.kind}] ${a.chapter}/${a.section || '-'} 题号${a.num}: ${a.message}`);
}

// 校验：uid 唯一性
const uids = new Set(r.questions.map(q => q.uid));
console.log('\nuid 唯一性:', uids.size === r.questions.length ? 'OK' : `重复! ${uids.size}/${r.questions.length}`);

fs.writeFileSync(path.join(__dirname, 'fixtures', 'parsed-bank.json'), JSON.stringify(r.questions), 'utf8');
console.log('\n已输出解析结果到 test/fixtures/parsed-bank.json');
