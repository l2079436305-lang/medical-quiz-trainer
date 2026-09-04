# -*- coding: utf-8 -*-
"""
convert-amedex.py — 把 AMC MCQ 题库 PDF (amedex-2023.pdf) 转换为
「医学题库通关」可直接导入的 JSON。

PDF 结构（实测 1943 页）：
  - 每道 MCQ 完整占据一页：题干 + A-E 选项 + 作答记录 + 百分比 + Explanation + References
  - 页尾脚注：Time spent: / QID:N / Last updated: / 日期 / N of 1943
  - 其余页面为解析续页或知识条目（不含 "% answered correctly"），跳过

用法：py -X utf8 tools/convert-amedex.py <输入.pdf> <输出.json>
"""
import sys, re, json

import fitz  # PyMuPDF


def clean(text):
    """去掉占位空白、压缩多余空行"""
    lines = [ln.rstrip() for ln in text.replace("\xa0", " ").split("\n")]
    lines = [ln for ln in lines if ln.strip() != "" or True]
    out = []
    blank = 0
    for ln in lines:
        if ln.strip() == "":
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        out.append(ln)
    return "\n".join(out).strip()


def strip_footer(text):
    """去掉页尾脚注：Time spent: / QID: / Last updated: / 日期 / N of 1943"""
    qid = None
    m = re.search(r"QID[:\s]*(\d+)", text)
    if m:
        qid = m.group(1)
    text = re.sub(r"Time spent:.*?(?:\d+\s*of\s*\d+)\s*$", "", text, flags=re.S)
    text = re.sub(r"\d+\s*of\s*\d+\s*$", "", text)
    return text.strip(), qid


OPT_RE = re.compile(r"^([A-E])\.[ \t]*(.*)$", re.M)  # 注意：不能含换行，否则空选项会吞掉下一个标记
RESULT_RE = re.compile(r"(Incorrect\.?\s*)?Correct answer is\s*([A-E])", re.I)
CAIS_RE = re.compile(r"Correct Answer Is\s*([A-E])", re.I)
PCT_RE = re.compile(r"\d+%\s*answered correctly")
EXPL_RE = re.compile(r"^Explanation:\s*$", re.M)


def parse_page(text, page_no=None):
    """把单页文本解析为一道题；返回 (question|None, anomaly|None)"""
    text, qid = strip_footer(text)

    cais = CAIS_RE.search(text)
    answer = cais.group(1) if cais else ""
    if not answer:
        r = RESULT_RE.search(text)
        answer = r.group(2) if r else ""

    # 选项区域：第一个 ^A. 到第一个结果/百分比/解析标记
    opt_starts = [m.start() for m in OPT_RE.finditer(text) if m.group(1) == "A"]
    if not opt_starts:
        return None
    a_start = opt_starts[0]
    stem = clean(text[:a_start]).replace("\n", " ").strip()

    tail = text[a_start:]
    stop = len(tail)
    for pat in (RESULT_RE, PCT_RE):
        m = pat.search(tail)
        if m and m.start() < stop:
            stop = m.start()
    m = EXPL_RE.search(tail)
    if m and m.start() < stop:
        stop = m.start()
    opt_text = tail[:stop]

    # 切分 A-E
    options = {}
    marks = list(OPT_RE.finditer(opt_text))
    # 仅接受从 A 开始递增的标记（与 parser 同样的单调规则）
    accepted, last = [], 0
    for m in marks:
        v = ord(m.group(1))
        if v > last:
            accepted.append(m)
            last = v
    for i, m in enumerate(accepted):
        end = accepted[i + 1].start() if i + 1 < len(accepted) else len(opt_text)
        # 选项正文 = 标记行上的文字 + 直到下一个标记之间的续行
        raw = m.group(2) + "\n" + opt_text[m.end():end]
        # PDF 断词换行：小写字母/标点后换行且接小写字母 → 直接拼接
        raw = re.sub(r"(?<=[a-z,;])\n(?=[a-z])", "", raw)
        body = re.sub(r"\s+", " ", raw).strip()
        options[m.group(1)] = body

    # 解析
    explanation = ""
    m = EXPL_RE.search(text)
    if m:
        explanation = clean(text[m.end():])
        explanation = explanation.replace("\n", " ").strip()

    # 图片选项题：选项标记存在但全部（或部分）无文字 → 填占位并打标，不丢弃
    anomaly = None
    if options:
        empty = [k for k, v in options.items() if not v]
        if empty:
            for k in options:
                if not options[k]:
                    options[k] = "（图片选项）"
            q_tags = ["图片题"]
            anomaly = {
                "page": page_no,
                "kind": "image-options",
                "message": "选项为图片（如心电图），无法转成文字；答案 %s，可在原 PDF 第 %s 页查看" % (answer or "?", page_no)
            }
        else:
            q_tags = []
    else:
        q_tags = []

    return (
        {
            "chapter": "AMC MCQ 题库 (amedex-2023)",
            "type": "A1",
            "title": stem,
            "options": options,
            "answer": answer,
            "explanation": explanation,
            "tags": q_tags,
            "source": ("amedex-2023" + (" QID" + qid if qid else "") + (" 第%s页" % page_no if anomaly else "")),
        },
        anomaly,
    )


def main():
    src, dst = sys.argv[1], sys.argv[2]
    doc = fitz.open(src)
    questions, anomalies = [], []
    for i in range(doc.page_count):
        text = doc[i].get_text().replace("\xa0", " ")
        if not re.search(r"\d+%\s*answered correctly", text):
            continue  # 非 MCQ 页（解析续页 / 知识条目 / 空脚注页）
        q, anomaly = parse_page(text, page_no=i + 1)
        if q is None:
            anomalies.append({"page": i + 1, "kind": "no-options", "message": "未找到 A. 选项标记"})
            continue
        q["num"] = len(questions) + 1
        if anomaly:
            anomalies.append(anomaly)
        if not q["answer"]:
            anomalies.append({"page": i + 1, "kind": "no-answer", "message": "未识别答案"})
        if len(q["options"]) < 2:
            anomalies.append({"page": i + 1, "kind": "no-options", "message": "选项不足: %s" % list(q["options"])})
        if q["answer"] and q["answer"] not in q["options"]:
            anomalies.append({"page": i + 1, "kind": "answer-invalid", "message": "答案 %s 不在选项中" % q["answer"]})
        questions.append(q)

    with open(dst, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=1)

    print("pages:", doc.page_count)
    print("questions:", len(questions))
    print("anomalies:", len(anomalies))
    for a in anomalies[:20]:
        print("  -", a)
    opt_dist = {}
    for q in questions:
        n = len(q["options"])
        opt_dist[n] = opt_dist.get(n, 0) + 1
    print("option count distribution:", opt_dist)
    answered = sum(1 for q in questions if q["answer"])
    print("answered:", answered, "/", len(questions))
    print("saved to:", dst)


if __name__ == "__main__":
    main()
