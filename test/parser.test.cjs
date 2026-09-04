/* 规格书必测格式 + 边界情况测试 */
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'js', 'parser.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('PASS', name); }
  else { failed++; console.log('FAIL', name, detail || ''); }
}

/* ---- 格式1：规格书指定格式 ---- */
const fmt1 = `### 第一章 解剖学

1. (A1型题) 腹股沟管深环的体表投影位于腹股沟韧带中点

A. 下方3cm
B. 上方3cm
C. 上方1cm
D. 上方2cm
E. 下方2cm

答案：B
`;
const r1 = P.parseBankText(fmt1);
check('格式1 识别1题', r1.questions.length === 1, r1.questions.length);
check('格式1 题型A1', r1.questions[0].type === 'A1');
check('格式1 章节', r1.questions[0].chapter === '第一章 解剖学', r1.questions[0].chapter);
check('格式1 答案B', r1.questions[0].answer === 'B');
check('格式1 选项E', r1.questions[0].options.E === '下方2cm');

/* ---- 格式2：【题号 1】【休克】A 英文题干 ---- */
const fmt2 = `【题号 1】【休克】A

70-year-old man is brought to the Emergency Department because of light-headedness...

A. Metoprolol.
B. Dopamine.
C. Intravenous pacemaker.
D. Permanent pacemaker.
E. Adrenaline.
`;
const r2 = P.parseBankText(fmt2);
check('格式2 识别1题', r2.questions.length === 1, r2.questions.length);
const q2 = r2.questions[0];
check('格式2 内嵌答案A', q2.answer === 'A', q2.answer);
check('格式2 标签[休克]', q2.tags.indexOf('休克') >= 0, JSON.stringify(q2.tags));
check('格式2 题干保留', q2.title.indexOf('70-year-old') === 0, q2.title.slice(0, 30));
check('格式2 选项5个', Object.keys(q2.options).length === 5, JSON.stringify(q2.options));

/* ---- 格式3：正确答案：C 变体 ---- */
const r3 = P.parseBankText(`1. 【A1型题】题干
A. xxx
B. yyy
C. zzz
D. aaa
E. bbb

正确答案：C
解析：这是解析内容。`);
check('格式3 答案C', r3.questions[0].answer === 'C');
check('格式3 解析', r3.questions[0].explanation === '这是解析内容。');

/* ---- 一行挤在一起的选项（真实题库格式） ---- */
const r4 = P.parseBankText(`1. (A1型题) 测试题
A.选项1B.选项2C.选项3D.选项4E.选项5
答案：E`);
check('一行选项切分', r4.questions[0].options.E === '选项5', JSON.stringify(r4.questions[0].options));
check('一行选项5个', Object.keys(r4.questions[0].options).length === 5);

/* ---- 多选题 X ---- */
const r5 = P.parseBankText(`1. (X型题) 多选测试
A.甲
B.乙
C.丙
D.丁
E.戊
答案：ACD`);
check('X型识别', r5.questions[0].type === 'X');
check('X型答案ACD', r5.questions[0].answer === 'ACD', r5.questions[0].answer);

/* ---- 判断题 ---- */
const r6 = P.parseBankText(`1. (判断题) 判断测试
答案：对`);
check('判断题识别', r6.questions[0].type === '判断', r6.questions[0].type);
check('判断题答案→A', r6.questions[0].answer === 'A', r6.questions[0].answer);
check('判断题自动选项', r6.questions[0].options.A === '正确' && r6.questions[0].options.B === '错误');

/* ---- 无答案题目不丢弃 ---- */
const r7 = P.parseBankText(`1. (A1型题) 无答案题
A.甲
B.乙
C.丙
D.丁
E.戊`);
check('无答案题保留', r7.questions.length === 1 && !r7.questions[0].answer);
check('无答案记异常', r7.anomalies.some(a => a.kind === 'no-answer'));

/* ---- 重复题号检测 ---- */
const r8 = P.parseBankText(`1. (A1型题) 第一题
A.甲
B.乙
C.丙
D.丁
E.戊
答案：A
1. (A1型题) 同号题
A.甲
B.乙
C.丙
D.丁
E.戊
答案：B`);
check('重复题号都保留', r8.questions.length === 2, r8.questions.length);
check('重复题号记异常', r8.anomalies.some(a => a.kind === 'dup-number'));

/* ---- 文末答案区（无"参考答案"标题也能识别） ---- */
const r9 = P.parseBankText(`第一章 测试
1. (A1型题) 甲题
A.1
B.2
C.3
D.4
E.5
2. (A1型题) 乙题
A.1
B.2
C.3
D.4
E.5

答案
1.A　2.B`);
check('文末答案匹配', r9.questions[0].answer === 'A' && r9.questions[1].answer === 'B');

/* ---- JSON 导入 ---- */
const rj = P.parseStructured(JSON.stringify([
  { chapter: '第一章', type: 'A1', title: 'JSON题', options: { A: '1', B: '2' }, answer: 'A', explanation: '解析' },
  { title: 'JSON多选', options: ['x', 'y', 'z'], answer: 'AB' }
]));
check('JSON 2题', rj.questions.length === 2);
check('JSON 答案', rj.questions[0].answer === 'A');
check('JSON 数组选项', rj.questions[1].options.A === 'x' && rj.questions[1].type === 'X', JSON.stringify(rj.questions[1].options));

/* ---- CSV 导入 ---- */
const rc = P.parseCSV('chapter,type,title,a,b,c,d,e,answer\n第一章,A1,CSV题,甲,乙,丙,丁,戊,B');
check('CSV 1题', rc.questions.length === 1);
check('CSV 答案B', rc.questions[0].answer === 'B');
check('CSV 选项', rc.questions[0].options.E === '戊');

/* ---- 答案归一化 ---- */
check('归一化 acd→ACD', P.normalizeAnswer('acd') === 'ACD');
check('归一化 D,C,A → ACD', P.normalizeAnswer('D,C,A') === 'ACD');
check('归一化 对→T', P.normalizeAnswer('对') === 'T');
check('归一化 错误→F', P.normalizeAnswer('错误') === 'F');

/* ---- B型题（配伍） ---- */
const rb = P.parseBankText(`1. (B型题) 配伍测试
A.选项甲
B.选项乙
C.选项丙
D.选项丁
E.选项戊
答案：C`);
check('B型→B1', rb.questions[0].type === 'B1', rb.questions[0].type);

/* ---- 病例组题（A3/A4）形式1：无编号病例段落 + 多个小问题 ---- */
const rc1 = P.parseBankText(`第一章 测试

1. (A1型题) 普通题
A.甲
B.乙
C.丙
D.丁
E.戊
答案：A

男，45岁。突发胸痛2小时，心电图示Ⅱ、Ⅲ、aVF导联ST段抬高。血压90/60mmHg，颈静脉怒张，肺部听诊呼吸音清晰。

2. (A3/A4型题) 最可能的诊断是
A.急性前壁心肌梗死
B.急性下壁心肌梗死
C.主动脉夹层
D.急性肺栓塞
E.急性心包炎

3. (A3/A4型题) 该患者最可能出现的心律失常是
A.房性期前收缩
B.室性期前收缩
C.房室传导阻滞
D.心房颤动
E.窦性心动过速
`);
check('病例组识别为A3', rc1.questions.filter(q => q.type === 'A3').length === 2, rc1.questions.map(q => q.type));
const caseQs = rc1.questions.filter(q => q.caseId);
check('病例组共2问', caseQs.length === 2);
check('病例共用题干提取', caseQs[0].caseStem.indexOf('突发胸痛') >= 0, caseQs[0].caseStem);
check('病例题干两个成员一致', caseQs[0].caseStem === caseQs[1].caseStem);
check('病例序号', caseQs[0].caseIndex === 1 && caseQs[1].caseIndex === 2 && caseQs[0].caseTotal === 2);
check('病例题干不误入上一题选项', rc1.questions[0].options.E === '戊', rc1.questions[0].options.E);
check('病例题干不误入小问题干', caseQs[0].title === '最可能的诊断是', caseQs[0].title);

/* ---- 病例组题形式2：编号但无选项的 A3 块作为病例描述 ---- */
const rc2 = P.parseBankText(`1. (A3/A4型题) 男，30岁。反复腹泻、黏液脓血便2个月，伴里急后重。结肠镜示黏膜弥漫性充血水肿，颗粒状，脆性增加。
2. (A3/A4型题) 最可能的诊断是
A.克罗恩病
B.溃疡性结肠炎
C.肠结核
D.细菌性痢疾
E.结肠癌
答案：B
3. (A3/A4型题) 首选治疗药物是
A.美沙拉嗪
B.柳氮磺吡啶
C.糖皮质激素
D.硫唑嘌呤
E.甲硝唑
答案：C`);
check('编号病例描述不作为独立题目', rc2.questions.length === 2, rc2.questions.map(q => q.num));
check('编号病例描述并入题干', rc2.questions[0].caseStem.indexOf('黏液脓血便') >= 0, rc2.questions[0].caseStem);
check('编号病例组成员答案正常', rc2.questions[0].answer === 'B' && rc2.questions[1].answer === 'C');

/* ---- 病例题干缺失检测（纯题目版格式） ---- */
const rc3 = P.parseBankText(`第一章 测试
1. (A1型题) 普通题
A.甲
B.乙
C.丙
D.丁
E.戊
答案：A
3. (A3/A4型题) 最可能的诊断是
A.甲
B.乙
C.丙
D.丁
E.戊
答案：B
4. (A3/A4型题) 首选治疗是
A.甲
B.乙
C.丙
D.丁
E.戊
答案：C`);
check('缺失病例题干仍保留题目', rc3.questions.length === 3, rc3.questions.length);
const missAn = rc3.anomalies.filter(a => a.kind === 'case-stem-missing');
check('缺失病例题干记异常', missAn.length === 1, rc3.anomalies.map(a => a.kind));
check('缺失提示疑似原第2题', missAn.length && missAn[0].message.indexOf('原第 2 题') >= 0, missAn.length && missAn[0].message);
check('组成员标记缺失', rc3.questions[1].caseStemMissing === true || (rc3.questions[1].anomalies || []).indexOf('case-stem-missing') >= 0);

/* ---- 病例组按小节切组 ---- */
const rc4 = P.parseBankText(`第一章 测试
第一节 甲
1. (A3/A4型题) 问1
A.甲
B.乙
C.丙
D.丁
E.戊
答案：A
第二节 乙
2. (A3/A4型题) 问2
A.甲
B.乙
C.丙
D.丁
E.戊
答案：B`);
const groups4 = Array.from(new Set(rc4.questions.map(q => q.caseId)));
check('不同小节的A3不并组', groups4.length === 2, groups4.length);

/* ---- 图片题 ---- */
const ri = P.parseBankText(`1. (A1型题) 如下图所示
![img](assets/1.png)
A.甲
B.乙
C.丙
D.丁
E.戊
答案：A`);
check('图片提取', ri.questions[0].image === 'assets/1.png', ri.questions[0].image);
check('图片标记', ri.questions[0].tags.indexOf('图片题') >= 0);

/* ---- 分数/公式干扰下的选项切分 ---- */
const r10 = P.parseBankText(`1. (A1型题) 酶动力学
A.Km=0.10[S]B.Km=0.25[S]C.Km=0.22[S]D.Km=0.40[S]E.Km=0.50[S]
答案：C`);
check('公式选项切分', Object.keys(r10.questions[0].options).length === 5, JSON.stringify(r10.questions[0].options));
check('公式选项内容', r10.questions[0].options.D === 'Km=0.40[S]');

console.log(`\n========== ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed ? 1 : 0);
