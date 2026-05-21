"""review-diagnostic v2 (변경 적용 후) 분석.

이전 진단(v1)과 동일한 구조 — 첨부의 카테고리 분포, 룰별 fail, 잔존 케이스의 패턴 분류.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

JSON_PATH = Path(r"C:\Users\nagas\Downloads\review-diagnostic-2026-05-11T11-20-29-656Z.json")
DB_PATH = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"

sys.stdout.reconfigure(encoding="utf-8")

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
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    print("generatedAt:", data["generatedAt"])
    print("scope     :", data["scope"])
    print("totals    :", data["totals"])
    print()
    print("failureByRule:")
    for r in data["failureByRule"]:
        print(f"  {r['count']:5d}  {r['ruleId']:30s} ({r['fieldLabel']})")
    print()

    atts = data["attachments"]
    print(f"attachments: {len(atts)}")

    # DB에서 doc_id → title, permit 적재 여부 매핑
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    doc_ids = list({a["docId"] for a in atts if a.get("docId")})
    placeholders = ",".join("?" * len(doc_ids))
    cur.execute(
        f"SELECT doc_id, title FROM documents WHERE doc_id IN ({placeholders})",
        doc_ids,
    )
    doc_title = {row[0]: row[1] for row in cur.fetchall()}

    att_ids = list({a["attachmentId"] for a in atts})
    placeholders2 = ",".join("?" * len(att_ids))
    cur.execute(
        f"SELECT source_attachment_id, permit_type, decision_no, permit_date FROM permits WHERE source_attachment_id IN ({placeholders2})",
        att_ids,
    )
    permit_meta = {row[0]: dict(zip(["permit_type", "decision_no", "permit_date"], row[1:])) for row in cur.fetchall()}
    cur.execute(
        f"SELECT source_attachment_id, report_year FROM facility_annual_reports WHERE source_attachment_id IN ({placeholders2})",
        att_ids,
    )
    annual_meta = {row[0]: {"report_year": row[1]} for row in cur.fetchall()}
    con.close()

    # 카테고리 분포
    cat_counter = Counter()
    cat_to_atts: dict[str, list[dict]] = defaultdict(list)
    for a in atts:
        title = doc_title.get(a["docId"])
        cat = title_category(title)
        cat_counter[cat] += 1
        cat_to_atts[cat].append({**a, "_title": title})
    print()
    print("=== 첨부 카테고리 분포 ===")
    for k, v in cat_counter.most_common():
        print(f"  {k:8s}: {v}")

    # 카테고리별 룰 fail 분포
    print()
    print("=== 카테고리별 룰 fail 분포 ===")
    for cat, items in cat_to_atts.items():
        rule_count: Counter[str] = Counter()
        for a in items:
            for rid in a.get("failedRuleIds") or []:
                rule_count[rid] += 1
        print(f"  [{cat}] 첨부 {len(items)}건")
        for rid, n in rule_count.most_common():
            print(f"      {n:3d}  {rid}")

    # 적재 일관성
    print()
    print("=== 적재 일관성 ===")
    no_permit_no_annual: list[dict] = []
    for cat, items in cat_to_atts.items():
        in_p = sum(1 for a in items if a["attachmentId"] in permit_meta)
        in_a = sum(1 for a in items if a["attachmentId"] in annual_meta)
        in_none = sum(1 for a in items if a["attachmentId"] not in permit_meta and a["attachmentId"] not in annual_meta)
        for a in items:
            if a["attachmentId"] not in permit_meta and a["attachmentId"] not in annual_meta:
                no_permit_no_annual.append({**a, "_cat": cat})
        print(f"  [{cat}] permits={in_p}  annual={in_a}  양쪽 없음={in_none}")
    if no_permit_no_annual:
        print()
        print(f"=== 양쪽 적재 없음 ({len(no_permit_no_annual)}건) ===")
        for a in no_permit_no_annual[:30]:
            print(f"  - [{a['_cat']}] {a['fileName']}")
            print(f"      title: {a['_title']}")
            print(f"      failed: {a.get('failedRuleIds')}")

    # 변경허가 vs 통합허가 첨부 — 변경허가는 표지 처분사항 표 폴백이 동작했을 텐데
    # 잔존 fail의 결정번호/허가일자 패턴 분석.
    print()
    print("=== 결정번호 fail 잔존 케이스 (전체) ===")
    decision_failed = [a for a in atts if "decision_no" in (a.get("failedRuleIds") or [])]
    print(f"총 {len(decision_failed)}건")
    for a in decision_failed:
        title = doc_title.get(a["docId"])
        cat = title_category(title)
        print(f"  - [{cat}] {a['fileName']}")
        print(f"      title: {title}")

    print()
    print("=== 허가일자 fail 잔존 케이스 (전체) ===")
    date_failed = [a for a in atts if "permit_date" in (a.get("failedRuleIds") or [])]
    print(f"총 {len(date_failed)}건")
    for a in date_failed:
        title = doc_title.get(a["docId"])
        cat = title_category(title)
        print(f"  - [{cat}] {a['fileName']}")
        print(f"      title: {title}")


if __name__ == "__main__":
    main()
