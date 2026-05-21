"""
review-diagnostic JSON 분석.

목적:
1. 32개 첨부의 카테고리(통합/변경/연간) 분포가 의도와 일치하는지
2. 87건 needsReview 의 분포와 사유
3. 카테고리 미스라우팅(예: 변경허가 잡인데 연간보고서 PDF가 섞임 등) 여부
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

JSON_PATH = Path(r"C:\Users\nagas\Downloads\review-diagnostic-2026-05-11T08-00-13-563Z.json")
DB_PATH = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"

TITLE_INTEGRATED_FIRST_RE = re.compile(r"\[\s*통\s*합\s*허\s*가")
TITLE_INTEGRATED_CHANGE_RE = re.compile(r"\[\s*변\s*경\s*허\s*가")
TITLE_ANNUAL_RE = re.compile(r"\[\s*연\s*간\s*(?:점검\s*)?보\s*고\s*서")


def title_category(title: str | None) -> str:
    if not title:
        return "no_title"
    if TITLE_ANNUAL_RE.search(title):
        return "annual"
    if TITLE_INTEGRATED_CHANGE_RE.search(title):
        return "change"
    if TITLE_INTEGRATED_FIRST_RE.search(title):
        return "first"
    return "other"


def main() -> None:
    if not JSON_PATH.exists():
        print(f"JSON 없음: {JSON_PATH}", file=sys.stderr)
        sys.exit(2)
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))

    print("totals:", data["totals"])
    print("scope:", data["scope"])
    print()
    print("failureByRule:")
    for r in data["failureByRule"]:
        print(f"  {r['count']:5d}  {r['ruleId']:30s} ({r['fieldLabel']})")
    print()

    atts = data["attachments"]
    print(f"attachments: {len(atts)}")

    # DB 에서 doc_id → title 매핑
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    doc_ids = [a["docId"] for a in atts if a.get("docId")]
    placeholders = ",".join("?" * len(doc_ids))
    cur.execute(
        f"SELECT doc_id, title, source_url, published_date FROM documents WHERE doc_id IN ({placeholders})",
        doc_ids,
    )
    doc_meta = {row[0]: {"title": row[1], "source_url": row[2], "published_date": row[3]} for row in cur.fetchall()}
    # attachment → permit 매핑
    att_ids = [a["attachmentId"] for a in atts]
    placeholders2 = ",".join("?" * len(att_ids))
    cur.execute(
        f"SELECT source_attachment_id, permit_type, decision_no, permit_date FROM permits WHERE source_attachment_id IN ({placeholders2})",
        att_ids,
    )
    permit_meta = {row[0]: {"permit_type": row[1], "decision_no": row[2], "permit_date": row[3]} for row in cur.fetchall()}
    cur.execute(
        f"SELECT source_attachment_id, report_year FROM facility_annual_reports WHERE source_attachment_id IN ({placeholders2})",
        att_ids,
    )
    annual_meta = {row[0]: {"report_year": row[1]} for row in cur.fetchall()}
    con.close()

    # 카테고리 분포 (제목 prefix 기준)
    print()
    print("=== 첨부의 게시 제목 카테고리 분포 ===")
    cat_counter = Counter()
    cat_to_atts: dict[str, list[dict]] = defaultdict(list)
    for a in atts:
        title = doc_meta.get(a["docId"], {}).get("title")
        cat = title_category(title)
        cat_counter[cat] += 1
        cat_to_atts[cat].append({**a, "_title": title})
    for k, v in cat_counter.most_common():
        print(f"  {k:8s}: {v}")

    # 각 카테고리별로 어디로 적재됐는지 검사 — permit_type 일관성
    print()
    print("=== 첨부 → 적재 테이블 일관성 ===")
    for cat, items in cat_to_atts.items():
        per_types = Counter()
        in_annual = 0
        in_permits = 0
        in_neither = 0
        for a in items:
            aid = a["attachmentId"]
            if aid in permit_meta:
                per_types[permit_meta[aid]["permit_type"] or "?"] += 1
                in_permits += 1
            if aid in annual_meta:
                in_annual += 1
            if aid not in permit_meta and aid not in annual_meta:
                in_neither += 1
        print(f"  [{cat}] 첨부 {len(items)}건 → permits {in_permits} / facility_annual_reports {in_annual} / 양쪽 없음 {in_neither}")
        if per_types:
            print(f"     permit_type 분포: {dict(per_types)}")

    # 첨부별 상세 출력 (제목/파일명/실패 필드)
    print()
    print("=== 첨부별 상세 (32건) ===")
    for a in atts:
        title = doc_meta.get(a["docId"], {}).get("title")
        cat = title_category(title)
        failed = a.get("failedRuleIds") or []
        nr = a.get("needsReviewCount", 0)
        print(f"- [{cat}] needsReview={nr} failed={failed}")
        print(f"    title : {title}")
        print(f"    file  : {a['fileName']}")
        if a["attachmentId"] in permit_meta:
            print(f"    permit: {permit_meta[a['attachmentId']]}")
        if a["attachmentId"] in annual_meta:
            print(f"    annual: {annual_meta[a['attachmentId']]}")


if __name__ == "__main__":
    main()
