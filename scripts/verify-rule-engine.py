"""
변경된 rule_engine.py 를 32 건 needsReview 첨부에 직접 돌려 회복/회귀 검증.

review-diagnostic JSON 의 attachments[].pdfPath 와 failedRuleIds 를 기준으로
- 각 PDF 를 PyMuPDF 로 페이지별 추출
- backend.app.ieps.rule_engine.run_rules 로 빌트인 룰 적용
- 변경 전(review-diagnostic) needsReview 와 변경 후 결과를 룰 단위로 비교
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import List, Tuple

# backend 모듈 import 를 위해 sys.path 추가.
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import fitz  # PyMuPDF
from app.ieps.rule_engine import run_rules, BUILTIN_RULES  # type: ignore

JSON_PATH = Path(r"C:\Users\nagas\Downloads\review-diagnostic-2026-05-11T08-00-13-563Z.json")


def extract_pages(pdf_path: Path) -> List[Tuple[int, str]]:
    pages: List[Tuple[int, str]] = []
    doc = fitz.open(str(pdf_path))
    for i, page in enumerate(doc, start=1):
        pages.append((i, page.get_text() or ""))
    doc.close()
    return pages


def main() -> None:
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    atts = data["attachments"]
    print(f"검증 대상 첨부: {len(atts)}건\n")

    # 변경 전(review-diagnostic) 룰별 fail 카운트
    before_by_rule: Counter[str] = Counter()
    for att in atts:
        for rid in att.get("failedRuleIds") or []:
            before_by_rule[rid] += 1

    after_by_rule: Counter[str] = Counter()
    recovered: dict[str, list[tuple[str, str]]] = defaultdict(list)  # rule_id -> [(file, value)]
    newly_failed: dict[str, list[str]] = defaultdict(list)  # rule_id -> [file]
    still_failed: dict[str, list[str]] = defaultdict(list)
    file_results: list[dict] = []

    for idx, att in enumerate(atts, 1):
        pdf_path = Path(att["pdfPath"])
        before_failed = set(att.get("failedRuleIds") or [])
        print(f"[{idx}/{len(atts)}] {att['fileName']}")
        if not pdf_path.exists():
            print("    PDF 없음 — 스킵")
            continue
        try:
            pages = extract_pages(pdf_path)
        except Exception as e:
            print(f"    추출 실패: {e}")
            continue
        try:
            fields = run_rules(pages, list(BUILTIN_RULES))
        except Exception as e:
            print(f"    run_rules 실패: {e}")
            continue
        after_failed = set()
        per_rule: dict[str, dict] = {}
        for f in fields:
            per_rule[f.rule_id] = {
                "needsReview": f.needs_review,
                "value": (f.value or "")[:60],
                "normalized": str(f.normalized)[:80] if f.normalized is not None else None,
                "confidence": f.confidence,
            }
            if f.needs_review:
                after_failed.add(f.rule_id)
                after_by_rule[f.rule_id] += 1

        # 회복/잔여/회귀 분류
        for rid in before_failed:
            if rid in after_failed:
                still_failed[rid].append(att["fileName"])
            else:
                v = per_rule.get(rid, {}).get("value") or per_rule.get(rid, {}).get("normalized")
                recovered[rid].append((att["fileName"], str(v)))
        for rid in after_failed:
            if rid not in before_failed:
                newly_failed[rid].append(att["fileName"])

        file_results.append({
            "file": att["fileName"],
            "before_failed": sorted(before_failed),
            "after_failed": sorted(after_failed),
            "recovered": sorted(before_failed - after_failed),
            "newly_failed": sorted(after_failed - before_failed),
        })

    print()
    print("=" * 80)
    print("룰 단위 fail 카운트 비교")
    print("=" * 80)
    all_rule_ids = sorted(set(before_by_rule) | set(after_by_rule))
    for rid in all_rule_ids:
        b = before_by_rule.get(rid, 0)
        a = after_by_rule.get(rid, 0)
        diff = a - b
        sign = "  " if diff == 0 else ("↑" if diff > 0 else "↓")
        print(f"  {rid:30s}  before={b:3d}  after={a:3d}  {sign} diff={diff:+d}")

    print()
    print(f"총 변경 전 fail: {sum(before_by_rule.values())}")
    print(f"총 변경 후 fail: {sum(after_by_rule.values())}")

    print()
    print("=" * 80)
    print("회복된 케이스 (회복=before fail이었으나 after 통과)")
    print("=" * 80)
    for rid, items in sorted(recovered.items()):
        print(f"[{rid}] {len(items)}건")
        for fname, val in items:
            print(f"  · {fname}")
            print(f"      → {val}")

    if any(newly_failed.values()):
        print()
        print("=" * 80)
        print("⚠️  새로 fail (회귀) 케이스")
        print("=" * 80)
        for rid, files in sorted(newly_failed.items()):
            print(f"[{rid}] {len(files)}건")
            for fname in files:
                print(f"  · {fname}")
    else:
        print()
        print("회귀 케이스 없음 ✓")

    print()
    print("=" * 80)
    print("여전히 fail 잔존 케이스")
    print("=" * 80)
    for rid, files in sorted(still_failed.items()):
        print(f"[{rid}] {len(files)}건")
        for fname in files:
            print(f"  · {fname}")

    out_path = Path(__file__).parent / "verify-rule-engine.json"
    out_path.write_text(json.dumps(file_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n파일별 상세: {out_path}")


if __name__ == "__main__":
    main()
