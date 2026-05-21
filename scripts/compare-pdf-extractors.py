"""
PyMuPDF (백엔드) vs pdfplumber 텍스트 추출 비교.

review-diagnostic 의 needsReview 27 건(decision_no)이 PyMuPDF 에서 사라지고
pdfplumber 에서는 보인다면 — 라이브러리 차이가 원인.

샘플로 첨부 6 개에 대해 동일 페이지를 양쪽으로 추출하고:
- "제 NNNN-NN호" 매치 유무
- "결정번호" 키워드 등장 유무
- 페이지당 텍스트 길이
를 비교한다.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF
import pdfplumber

DECISION_NO_RE = re.compile(r"제\s*\d{4}\s*-\s*\d+\s*호")
PERMIT_DATE_RE = re.compile(r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?\s*(?:부로|\n?\s*환경부)")

# review-diagnostic 32 건 중 패턴이 다양한 샘플 6 건.
TARGETS = [
    # decision_no needsReview, permit_date needsReview, 텍스트 ok로 진단된 케이스들
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\012-02. 배출시설등 설치·운영허가(변경) 검토결과서((주)신승에너지).pdf",
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\Dec_230630_배출시설등 설치운영허가 검토 결과서_에스케이실트론(주) 청주공장_비공개ver.pdf",
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\0727_02_배출시설등_설치운영_허가_검토_결과서_㈜이수스페셜티케미컬_231113비공개반영.pdf",
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\343-01. 배출시설등 설치·운영허가 검토결과서((주)동남 서산공장).pdf",
    # keyword_not_found 케이스
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\321-01. 배출시설등 설치·운영허가 검토결과서(엠에코에너지(주)).pdf",
    # scanned 케이스
    r"C:\CodingProject\MCM\data\ieps\scrape\ieps-integrated-permit\attachments\0693-01. 배출시설등 설치·운영허가 검토결과서_(주)한화방산 보은사업장(비공개).pdf",
]


def extract_with_pymupdf(pdf_path: str, max_page: int = 25) -> tuple[str, int, int]:
    doc = fitz.open(pdf_path)
    total = len(doc)
    hi = min(total, max_page)
    chunks: list[str] = []
    for i in range(hi):
        chunks.append(doc[i].get_text())
    doc.close()
    full = "\n".join(chunks)
    return full, total, len(full)


def extract_with_pdfplumber(pdf_path: str, max_page: int = 25) -> tuple[str, int, int]:
    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)
        hi = min(total, max_page)
        chunks: list[str] = []
        for i in range(hi):
            chunks.append(pdf.pages[i].extract_text() or "")
    full = "\n".join(chunks)
    return full, total, len(full)


def has_decision_keyword(text: str) -> int:
    return text.count("결정번호")


def has_decision_match(text: str) -> str | None:
    m = DECISION_NO_RE.search(text)
    return m.group(0) if m else None


def has_permit_date_match(text: str) -> str | None:
    m = PERMIT_DATE_RE.search(text)
    if not m:
        return None
    y, mo, d = m.group(1, 2, 3)
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def context(text: str, kw: str, span: int = 80) -> str:
    i = text.find(kw)
    if i == -1:
        return ""
    lo = max(0, i - 10)
    hi = min(len(text), i + span)
    return text[lo:hi].replace("\n", "⏎")


def main() -> None:
    out: list[dict] = []
    for path in TARGETS:
        p = Path(path)
        if not p.exists():
            print(f"NOT FOUND: {p.name}")
            continue
        name = p.name
        py_text, py_pages, py_chars = extract_with_pymupdf(path)
        pl_text, pl_pages, pl_chars = extract_with_pdfplumber(path)

        py_kw = has_decision_keyword(py_text)
        pl_kw = has_decision_keyword(pl_text)
        py_dec = has_decision_match(py_text)
        pl_dec = has_decision_match(pl_text)
        py_dt = has_permit_date_match(py_text)
        pl_dt = has_permit_date_match(pl_text)

        print("=" * 80)
        print(f"file: {name}")
        print(f"  pages: PyMuPDF={py_pages}  pdfplumber={pl_pages}")
        print(f"  text chars (1~25p): PyMuPDF={py_chars}  pdfplumber={pl_chars}")
        print(f"  decision keyword hits: PyMuPDF={py_kw}  pdfplumber={pl_kw}")
        print(f"  decision_no match    : PyMuPDF={py_dec!r}  pdfplumber={pl_dec!r}")
        print(f"  permit_date match    : PyMuPDF={py_dt!r}  pdfplumber={pl_dt!r}")
        if py_kw and not py_dec:
            print(f"  -- PyMuPDF '결정번호' 컨텍스트: {context(py_text, '결정번호', 100)}")
        if pl_kw and not pl_dec:
            print(f"  -- pdfplumber '결정번호' 컨텍스트: {context(pl_text, '결정번호', 100)}")
        if py_kw == 0 and pl_kw == 0:
            # 두 추출 모두 키워드 없음 — 표지 페이지 PyMuPDF 텍스트 일부 출력
            sample = py_text[:300].replace("\n", "⏎")
            print(f"  -- PyMuPDF 표지 추출 샘플: {sample}")
        out.append({
            "file": name,
            "py_pages": py_pages,
            "py_chars_25p": py_chars,
            "pl_chars_25p": pl_chars,
            "py_decision_kw": py_kw,
            "pl_decision_kw": pl_kw,
            "py_decision": py_dec,
            "pl_decision": pl_dec,
            "py_permit_date": py_dt,
            "pl_permit_date": pl_dt,
        })

    Path(__file__).parent.joinpath("compare-extractors.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
