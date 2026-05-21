"""verify-rule-engine.json 요약 (회복/잔존/회귀)."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
data = json.loads(Path(r"C:\CodingProject\MCM\scripts\verify-rule-engine.json").read_text(encoding="utf-8"))

print(f"총 첨부: {len(data)}")
recovered_total = sum(len(d["recovered"]) for d in data)
newly_failed_total = sum(len(d["newly_failed"]) for d in data)
print(f"총 회복 필드 수: {recovered_total}")
print(f"총 회귀 필드 수: {newly_failed_total}")
print()

print("=== decision_no 회복/잔존 ===")
for d in data:
    fn = d["file"][:90]
    if "decision_no" in d["recovered"]:
        print(f"  RECOVER  {fn}")
    elif "decision_no" in d["after_failed"]:
        print(f"  STILL ❌ {fn}")

print()
print("=== permit_date 회복/잔존 ===")
for d in data:
    fn = d["file"][:90]
    if "permit_date" in d["recovered"]:
        print(f"  RECOVER  {fn}")
    elif "permit_date" in d["after_failed"]:
        print(f"  STILL ❌ {fn}")
