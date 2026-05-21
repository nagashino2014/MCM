"""
review-diagnostic 32건 PDF 의 필드 추출 실패 원인 진단.

빌트인 룰(scraper/lib/ieps/builtin-rules.ts)과 동일한 키워드/정규식을 가지고
PDF 텍스트를 직접 뽑아 보면서, 각 필드별로 다음을 판정한다.

  - text_extracted_ok / mostly_scanned          : 텍스트 레이어 자체 진단
  - decision_no:
      ok                  : "결정번호" 키워드 + 정규식 매치 둘 다 OK
      keyword_not_found   : "결정번호" 라는 키워드 자체가 PDF 안에 없음
      regex_no_match      : 키워드는 있는데 "제 NNNN-NN호" 정규식이 안 잡힘
                            → 키워드 부근 컨텍스트 100자 샘플 출력
  - permit_date:
      ok / no_match       : 동일 패턴.
                            "부로|환경부" 앵커 없이 날짜만 적힌 케이스 별도 분류
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pdfplumber

JSON_PATH = Path(r"C:\Users\nagas\Downloads\review-diagnostic-2026-05-11T08-00-13-563Z.json")
DB_PATH = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"

# builtin-rules.ts 의 룰 정의를 그대로 옮긴다.
DECISION_NO_RE = re.compile(r"제\s*\d{4}\s*-\s*\d+\s*호")
PERMIT_DATE_FULL_RE = re.compile(
    r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?\s*(?:부로|\n?\s*환경부)"
)
# 보조 진단용 — 앵커("부로"/"환경부") 없이 자유 형식 날짜.
DATE_LOOSE_RE = re.compile(r"(\d{4})\s*[\.년\-/]\s*(\d{1,2})\s*[\.월\-/]\s*(\d{1,2})\s*[\.일]?")
BUSINESS_REG_RE = re.compile(r"\d{3}\s*[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212]\s*\d{2}\s*[\-\u2010\u2011\u2012\u2013\u2014\u2015\u2212]\s*\d{5}")

DECISION_PAGE_RANGE = (1, 25)
PERMIT_DATE_PAGE_RANGE = (5, 25)


def extract_pages(pdf_path: Path, page_range: tuple[int, int]) -> tuple[list[str], int, int]:
    """페이지 범위(1-based, inclusive) 의 텍스트와 (총 페이지수, 총 글자수)."""
    texts: list[str] = []
    total_chars = 0
    with pdfplumber.open(str(pdf_path)) as pdf:
        page_count = len(pdf.pages)
        lo = max(1, page_range[0])
        hi = min(page_count, page_range[1])
        for idx in range(lo, hi + 1):
            page = pdf.pages[idx - 1]
            txt = page.extract_text() or ""
            total_chars += len(txt)
            texts.append(txt)
    return texts, page_count, total_chars


def sample_context(text: str, keyword: str, span: int = 80) -> list[str]:
    """텍스트에서 keyword 등장 지점들의 주변 컨텍스트 샘플."""
    out: list[str] = []
    start = 0
    while True:
        i = text.find(keyword, start)
        if i == -1:
            break
        lo = max(0, i - 10)
        hi = min(len(text), i + span)
        snippet = text[lo:hi].replace("\n", "⏎")
        out.append(snippet)
        start = i + len(keyword)
        if len(out) >= 4:
            break
    return out


def diagnose_attachment(att: dict[str, Any]) -> dict[str, Any]:
    pdf_path = Path(att["pdfPath"])
    result: dict[str, Any] = {
        "attachmentId": att["attachmentId"],
        "fileName": att["fileName"],
        "pdf_exists": pdf_path.exists(),
        "failed": att.get("failedRuleIds") or [],
    }
    if not pdf_path.exists():
        result["error"] = "pdf_not_found"
        return result

    try:
        decision_texts, page_count, decision_chars = extract_pages(pdf_path, DECISION_PAGE_RANGE)
        date_texts, _, date_chars = extract_pages(pdf_path, PERMIT_DATE_PAGE_RANGE)
    except Exception as e:
        result["error"] = f"extract_failed: {e}"
        return result

    result["page_count"] = page_count
    # 평균 페이지 글자수 → 텍스트 레이어 유무 진단.
    pages_scanned = max(1, len(decision_texts))
    avg_chars_per_page = decision_chars / pages_scanned
    result["avg_chars_per_page"] = round(avg_chars_per_page, 1)
    result["text_quality"] = (
        "scanned_or_image" if avg_chars_per_page < 50
        else "low_text" if avg_chars_per_page < 200
        else "ok"
    )

    decision_full = "\n".join(decision_texts)
    date_full = "\n".join(date_texts)

    # 결정번호 진단
    keyword_hits = decision_full.count("결정번호")
    regex_match = DECISION_NO_RE.search(decision_full)
    if regex_match:
        result["decision_no"] = {"status": "ok", "value": regex_match.group(0)}
    elif keyword_hits > 0:
        result["decision_no"] = {
            "status": "regex_no_match",
            "keyword_hits": keyword_hits,
            "context_samples": sample_context(decision_full, "결정번호"),
        }
    else:
        result["decision_no"] = {
            "status": "keyword_not_found",
            "keyword_hits": 0,
            # 폴백 — 정규식만 단독으로라도 발견되는지
            "loose_regex_hits": [m.group(0) for m in DECISION_NO_RE.finditer(decision_full)][:3],
        }

    # 허가일자 진단
    perm_match = PERMIT_DATE_FULL_RE.search(date_full)
    if perm_match:
        y, m, d = perm_match.group(1, 2, 3)
        result["permit_date"] = {"status": "ok", "value": f"{y}-{int(m):02d}-{int(d):02d}"}
    else:
        # 어떤 단서까지 보이는지 단계별 진단
        has_부로 = "부로" in date_full
        has_환경부 = "환경부" in date_full
        loose_dates = [
            f"{y}-{int(mo):02d}-{int(da):02d}"
            for (y, mo, da) in DATE_LOOSE_RE.findall(date_full)
        ]
        result["permit_date"] = {
            "status": "no_match",
            "has_부로": has_부로,
            "has_환경부": has_환경부,
            "loose_date_count": len(loose_dates),
            "loose_date_samples": loose_dates[:5],
        }
        # 부로/환경부 키워드 주변 컨텍스트 (정규식이 왜 실패했는지 보려고)
        ctx_samples: list[str] = []
        for kw in ("부로", "환경부"):
            ctx_samples.extend(sample_context(date_full, kw, span=120))
        result["permit_date"]["context_samples"] = ctx_samples[:4]

    # 사업자등록번호 진단 (간단)
    if BUSINESS_REG_RE.search(decision_full):
        result["business_registration_no"] = "ok"
    else:
        # 페이지 전체로 다시 한번
        try:
            full_texts, _, _ = extract_pages(pdf_path, (1, page_count))
            full = "\n".join(full_texts)
        except Exception:
            full = decision_full
        result["business_registration_no"] = (
            "ok_in_full" if BUSINESS_REG_RE.search(full) else "no_match"
        )

    return result


def main() -> None:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    atts = data["attachments"]
    print(f"진단 대상 첨부: {len(atts)}건")
    print()

    diagnoses: list[dict[str, Any]] = []
    for i, att in enumerate(atts, 1):
        print(f"[{i}/{len(atts)}] {att['fileName']}")
        d = diagnose_attachment(att)
        diagnoses.append(d)

    print()
    print("=" * 80)
    print("진단 요약")
    print("=" * 80)

    text_quality = Counter(d.get("text_quality", "?") for d in diagnoses)
    decision_status = Counter(d.get("decision_no", {}).get("status", "?") if isinstance(d.get("decision_no"), dict) else d.get("decision_no", "?") for d in diagnoses)
    permit_date_status = Counter(d.get("permit_date", {}).get("status", "?") if isinstance(d.get("permit_date"), dict) else d.get("permit_date", "?") for d in diagnoses)
    biz_status = Counter(d.get("business_registration_no", "?") for d in diagnoses)

    print("text_quality:", dict(text_quality))
    print("decision_no status:", dict(decision_status))
    print("permit_date status:", dict(permit_date_status))
    print("business_registration_no status:", dict(biz_status))

    # 사유별 상세 출력
    print()
    print("=== decision_no: regex_no_match 상세 ===")
    for d in diagnoses:
        info = d.get("decision_no") or {}
        if isinstance(info, dict) and info.get("status") == "regex_no_match":
            print(f"- {d['fileName']}")
            for s in info.get("context_samples", []):
                print(f"    · {s}")

    print()
    print("=== decision_no: keyword_not_found 상세 ===")
    for d in diagnoses:
        info = d.get("decision_no") or {}
        if isinstance(info, dict) and info.get("status") == "keyword_not_found":
            print(f"- {d['fileName']}  (loose_regex_hits={info.get('loose_regex_hits')})")

    print()
    print("=== permit_date: no_match 상세 ===")
    for d in diagnoses:
        info = d.get("permit_date") or {}
        if isinstance(info, dict) and info.get("status") == "no_match":
            print(f"- {d['fileName']}")
            print(f"    has_부로={info['has_부로']}, has_환경부={info['has_환경부']}, loose_dates={info['loose_date_samples']}")
            for s in info.get("context_samples", []):
                print(f"    · {s}")

    print()
    print("=== 텍스트 레이어 빈약 (scanned_or_image / low_text) 첨부 ===")
    for d in diagnoses:
        if d.get("text_quality") in ("scanned_or_image", "low_text"):
            print(f"- {d['fileName']}  page_count={d.get('page_count')}, avg_chars/page={d.get('avg_chars_per_page')}, quality={d['text_quality']}")

    # 결과 JSON 저장
    out_path = Path(__file__).parent / "pdf-field-diagnosis.json"
    out_path.write_text(json.dumps(diagnoses, ensure_ascii=False, indent=2), encoding="utf-8")
    print()
    print(f"상세 결과 저장: {out_path}")


if __name__ == "__main__":
    main()
