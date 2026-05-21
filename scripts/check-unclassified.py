"""
파싱 단계에서 카테고리 식별에 실패하는 첨부를 재현해보고 패턴 분포 분석.

cli-collect.ts 의 walkDownloadedPdfs → classifyDocumentType 과 동일한 로직을 Python 으로 옮겨
실제 950건이 어떤 사유로 unclassified 가 되었는지 확인한다.
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"

# --- cli-collect.ts 와 동일한 정규식/룰 (변경 후 버전) ---
APPENDIX_BLOCK_RE = re.compile(r"(?:부\s*록|별\s*책\s*부\s*록)")
# 진단/리포트용 (변경 전 동작 비교)
APPENDIX_RE_LEGACY = re.compile(r"(?:부\s*록|별\s*책\s*부\s*록|별\s*첨)")
TITLE_INTEGRATED_FIRST_RE = re.compile(r"\[\s*통\s*합\s*허\s*가")
TITLE_INTEGRATED_CHANGE_RE = re.compile(r"\[\s*변\s*경\s*허\s*가")
TITLE_ANNUAL_RE = re.compile(r"\[\s*연\s*간\s*(?:점검\s*)?보\s*고\s*서")


def is_pdf(filename: str) -> bool:
    return bool(re.search(r"\.pdf($|\?|\b)", filename, re.IGNORECASE))


def is_review_report_file(filename: str) -> bool:
    if not filename:
        return True
    if APPENDIX_BLOCK_RE.search(filename):
        return False
    lower = filename.lower()
    if "검토결과서" in filename or "검토 결과서" in filename:
        return True
    if "허가검토서" in filename:
        return True
    if "배출시설" in filename and "허가" in filename:
        return True
    return False


def is_annual_report_file(filename: str) -> bool:
    if not filename:
        return False
    if APPENDIX_BLOCK_RE.search(filename):
        return False
    if "연간보고서" in filename or "연간점검" in filename:
        return True
    return False


def classify_document_type(filename: str, article_title: str | None) -> str | None:
    if article_title:
        if TITLE_ANNUAL_RE.search(article_title):
            if is_annual_report_file(filename):
                return "annual_report"
            if not APPENDIX_BLOCK_RE.search(filename):
                return "annual_report"
            return None
        if TITLE_INTEGRATED_FIRST_RE.search(article_title) or TITLE_INTEGRATED_CHANGE_RE.search(article_title):
            if is_review_report_file(filename):
                return "review_report"
            return None
    if is_annual_report_file(filename):
        return "annual_report"
    if is_review_report_file(filename):
        return "review_report"
    return None


def classify_unclassified_reason(filename: str, title: str | None) -> str:
    """unclassified 가 된 사유 분류."""
    has_title = bool(title)
    has_title_prefix = bool(
        title
        and (
            TITLE_INTEGRATED_FIRST_RE.search(title)
            or TITLE_INTEGRATED_CHANGE_RE.search(title)
            or TITLE_ANNUAL_RE.search(title)
        )
    )
    is_appendix = bool(APPENDIX_BLOCK_RE.search(filename or ""))
    title_kind = "none"
    if title:
        if TITLE_ANNUAL_RE.search(title):
            title_kind = "annual"
        elif TITLE_INTEGRATED_CHANGE_RE.search(title):
            title_kind = "change"
        elif TITLE_INTEGRATED_FIRST_RE.search(title):
            title_kind = "first"
        else:
            title_kind = "other"

    if not has_title:
        # 제목 없음 + 파일명 폴백도 실패
        return "no_title_and_filename_unmatched"

    if not has_title_prefix:
        # 제목은 있는데 카테고리 접두사 없음
        return f"title_no_category_prefix ({title_kind})"

    if title_kind == "annual":
        # annual 카테고리인데 파일에 부록 키워드 → null
        return "annual_appendix_blocked"

    # 통합/변경허가 카테고리인데 isReviewReportFile 가 false 인 케이스
    if is_appendix:
        return f"{title_kind}_appendix_blocked"
    return f"{title_kind}_filename_no_review_keyword"


def main() -> None:
    if not DB_PATH.exists():
        print(f"DB 없음: {DB_PATH}", file=sys.stderr)
        sys.exit(2)

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute(
        """
        SELECT a.file_id, a.doc_id, a.file_name, a.local_path,
               d.title, d.source_url, d.published_date
          FROM attachments a
          JOIN documents d ON d.doc_id = a.doc_id
         WHERE d.board_id = 'ieps-integrated-permit'
           AND a.status = 'downloaded'
           AND a.local_path IS NOT NULL
           AND a.local_path <> ''
           AND LOWER(a.file_name) LIKE '%.pdf'
        """
    )
    rows = cur.fetchall()
    print(f"총 다운로드된 PDF 첨부: {len(rows)}건")

    total = 0
    missing_file = 0
    not_pdf = 0
    classified = Counter()
    unclassified_rows: list[tuple[str, str | None]] = []

    for file_id, doc_id, file_name, local_path, title, source_url, published_date in rows:
        total += 1
        # walkDownloadedPdfs 의 missing-file 분기 (파싱 전수에서 이미 빠지는 것)
        if not local_path or not os.path.exists(local_path):
            missing_file += 1
            continue
        if not is_pdf(file_name or ""):
            not_pdf += 1
            continue

        doc_type = classify_document_type(file_name or "", title)
        if doc_type is None:
            unclassified_rows.append((file_name or "", title))
        else:
            classified[doc_type] += 1

    print(f"missing_file: {missing_file}")
    print(f"non-PDF (filter 제외): {not_pdf}")
    print(f"classified: {dict(classified)}")
    print(f"unclassified: {len(unclassified_rows)}")
    print()

    # 사유 분포
    reasons = Counter(classify_unclassified_reason(fn, t) for fn, t in unclassified_rows)
    print("=== unclassified 사유 분포 ===")
    for reason, cnt in reasons.most_common():
        print(f"  {cnt:5d}  {reason}")

    # "검토결과서" 키워드가 파일명에 들어 있는 unclassified 케이스 (= 사용자가 걱정하는 누락)
    review_keyword_unclassified = [
        (fn, t)
        for fn, t in unclassified_rows
        if "검토결과서" in (fn or "")
        or "검토 결과서" in (fn or "")
        or ("배출시설" in (fn or "") and "허가" in (fn or ""))
    ]
    print()
    print(f"=== unclassified 중 '검토결과서/배출시설…허가' 키워드 포함된 첨부: {len(review_keyword_unclassified)}건 ===")
    # 제목 prefix 별 분포
    by_title_prefix = Counter()
    for fn, t in review_keyword_unclassified:
        if t is None:
            by_title_prefix["title=None"] += 1
        elif TITLE_INTEGRATED_FIRST_RE.search(t):
            by_title_prefix["[통합허가"] += 1
        elif TITLE_INTEGRATED_CHANGE_RE.search(t):
            by_title_prefix["[변경허가"] += 1
        elif TITLE_ANNUAL_RE.search(t):
            by_title_prefix["[연간(점검)보고서"] += 1
        else:
            by_title_prefix[(t[:24] + "…") if len(t) > 24 else t] += 1
    print("  -- 제목 prefix 분포")
    for k, v in by_title_prefix.most_common():
        print(f"    {v:5d}  {k}")

    # === 게시물(doc_id) 단위 누락 분석 ===
    # 한 게시물에 첨부가 여러 개여도, 그 중 1건이라도 분류되면 그 게시물은 누락 아님.
    cur.execute(
        """
        SELECT a.doc_id, a.file_name, a.local_path,
               d.title, d.source_url, d.published_date
          FROM attachments a
          JOIN documents d ON d.doc_id = a.doc_id
         WHERE d.board_id = 'ieps-integrated-permit'
           AND a.status = 'downloaded'
           AND a.local_path IS NOT NULL
           AND a.local_path <> ''
           AND LOWER(a.file_name) LIKE '%.pdf'
        """
    )
    docs: dict[str, dict] = {}
    for doc_id, file_name, local_path, title, source_url, published_date in cur.fetchall():
        if not local_path or not os.path.exists(local_path):
            continue
        if not is_pdf(file_name or ""):
            continue
        entry = docs.setdefault(
            doc_id,
            {
                "title": title,
                "category": (
                    "annual" if title and TITLE_ANNUAL_RE.search(title)
                    else "change" if title and TITLE_INTEGRATED_CHANGE_RE.search(title)
                    else "first" if title and TITLE_INTEGRATED_FIRST_RE.search(title)
                    else "other"
                ),
                "classified": [],
                "unclassified": [],
            },
        )
        doc_type = classify_document_type(file_name or "", title)
        if doc_type is None:
            entry["unclassified"].append(file_name)
        else:
            entry["classified"].append((file_name, doc_type))

    print()
    print("=== 게시물(doc_id) 단위 분석 ===")
    print(f"총 게시물: {len(docs)}")
    cat_total = Counter()
    cat_missing = Counter()
    missing_docs: list[tuple[str, str, list[str]]] = []
    for did, info in docs.items():
        cat = info["category"]
        cat_total[cat] += 1
        if len(info["classified"]) == 0:
            cat_missing[cat] += 1
            missing_docs.append((did, info["title"], info["unclassified"]))
    print("카테고리별 총 게시물:")
    for k, v in cat_total.most_common():
        print(f"  {k:8s}: {v}")
    print("카테고리별 '분류된 PDF가 0건' 게시물 (= 실제 누락 후보):")
    for k, v in cat_missing.most_common():
        print(f"  {k:8s}: {v}")

    if missing_docs:
        print()
        print("=== 분류된 첨부가 0건인 게시물 (전체) ===")
        for did, t, files in missing_docs:
            print(f"- title : {t!r}")
            print(f"  doc_id: {did}")
            for fn in files:
                print(f"    · {fn}")

    # === 추가 진단: '검토'/'허가' 변형 키워드 ===
    print()
    print("=== unclassified 중 '검토' 들어가지만 '검토결과서' 아닌 파일명 (변형 후보) ===")
    variant_hits: list[tuple[str, str]] = []
    for fn, t in unclassified_rows:
        if not fn:
            continue
        if "검토결과서" in fn or "검토 결과서" in fn:
            continue
        if APPENDIX_BLOCK_RE.search(fn):
            continue
        if "검토" in fn:
            variant_hits.append((fn, t or ""))
    print(f"건수: {len(variant_hits)}")
    for fn, t in variant_hits[:30]:
        print(f"- title: {t!r}")
        print(f"  file : {fn!r}")

    pass

    con.close()


if __name__ == "__main__":
    main()
