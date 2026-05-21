"""v1 vs v2 진단 JSON 의 attachmentId 비교 — 같은 첨부 재파싱인지, 새 첨부 유입인지 식별."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

V1 = Path(r"C:\Users\nagas\Downloads\review-diagnostic-2026-05-11T08-00-13-563Z.json")
V2 = Path(r"C:\Users\nagas\Downloads\review-diagnostic-2026-05-11T11-20-29-656Z.json")

a1 = {a["attachmentId"]: a for a in json.loads(V1.read_text(encoding="utf-8"))["attachments"]}
a2 = {a["attachmentId"]: a for a in json.loads(V2.read_text(encoding="utf-8"))["attachments"]}

print(f"v1 attachments: {len(a1)}")
print(f"v2 attachments: {len(a2)}")
print(f"공통        : {len(set(a1) & set(a2))}")
print(f"v1 only     : {len(set(a1) - set(a2))}")
print(f"v2 only     : {len(set(a2) - set(a1))}")
print()

# v1 에 있던 첨부가 v2 에서 사라졌다 = 해소되었거나 reviewed 됐다는 의미.
only_v1 = sorted(set(a1) - set(a2))
if only_v1:
    print(f"=== v1 에만 (해소/리뷰됨): {len(only_v1)} ===")
    for aid in only_v1[:20]:
        print(f"  - {a1[aid]['fileName']}")

# v2 에만 = 새로 needsReview 가 된 첨부.
only_v2 = sorted(set(a2) - set(a1))
if only_v2:
    print(f"\n=== v2 에만 (새로 등장): {len(only_v2)} ===")
    for aid in only_v2[:20]:
        print(f"  - {a2[aid]['fileName']}")

# 공통 첨부 — v1 fail rules vs v2 fail rules 비교.
common = sorted(set(a1) & set(a2))
print(f"\n=== 공통 {len(common)} 건의 fail 변화 ===")
recovered_per_rule = {}  # rule -> count
unchanged_per_rule = {}
newly_failed_per_rule = {}
for aid in common:
    f1 = set(a1[aid].get("failedRuleIds") or [])
    f2 = set(a2[aid].get("failedRuleIds") or [])
    for r in f1 - f2:
        recovered_per_rule[r] = recovered_per_rule.get(r, 0) + 1
    for r in f1 & f2:
        unchanged_per_rule[r] = unchanged_per_rule.get(r, 0) + 1
    for r in f2 - f1:
        newly_failed_per_rule[r] = newly_failed_per_rule.get(r, 0) + 1

print("  recovered (v1 fail, v2 ok):")
for r, n in sorted(recovered_per_rule.items(), key=lambda x: -x[1]):
    print(f"    {n:3d}  {r}")
print("  unchanged (v1 fail, v2 fail):")
for r, n in sorted(unchanged_per_rule.items(), key=lambda x: -x[1]):
    print(f"    {n:3d}  {r}")
print("  newly_failed (v1 ok, v2 fail):")
for r, n in sorted(newly_failed_per_rule.items(), key=lambda x: -x[1]):
    print(f"    {n:3d}  {r}")

# 변경 의도 핵심 케이스 — decision_no 가 회복됐어야 하는데 안 된 공통 첨부 출력.
print()
print("=== 변경 후에도 v2 에서 decision_no fail 잔존한 공통 첨부 (변경이 반영 안 된 신호) ===")
for aid in common:
    f1 = set(a1[aid].get("failedRuleIds") or [])
    f2 = set(a2[aid].get("failedRuleIds") or [])
    if "decision_no" in f1 and "decision_no" in f2:
        print(f"  - {a2[aid]['fileName']}")
