"""region_sigungu 누락 현황 진단 — 신고 A·B 의 일반화 여부 확인."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
DB = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"
con = sqlite3.connect(DB)
cur = con.cursor()

print("=== facilities region_sido / region_sigungu 분포 ===")
cur.execute("""
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN region_sido IS NULL OR region_sido='' THEN 1 ELSE 0 END) AS sido_null,
  SUM(CASE WHEN region_sigungu IS NULL OR region_sigungu='' THEN 1 ELSE 0 END) AS sigungu_null,
  SUM(CASE WHEN (region_sido IS NOT NULL AND region_sido<>'')
            AND (region_sigungu IS NULL OR region_sigungu='') THEN 1 ELSE 0 END) AS sido_only
FROM facilities
""")
total, sido_null, sigungu_null, sido_only = cur.fetchone()
print(f"  전체 facilities          : {total}")
print(f"  region_sido NULL/빈문자  : {sido_null}")
print(f"  region_sigungu NULL/빈문자: {sigungu_null}")
print(f"  sido만 있고 sigungu 없는 건: {sido_only}")

print()
print("=== region_sido 별 region_sigungu NULL 카운트 ===")
cur.execute("""
SELECT region_sido,
       COUNT(*) AS total,
       SUM(CASE WHEN region_sigungu IS NULL OR region_sigungu='' THEN 1 ELSE 0 END) AS sigungu_null
FROM facilities
WHERE region_sido IS NOT NULL AND region_sido <> ''
GROUP BY region_sido
ORDER BY sigungu_null DESC, region_sido
""")
print(f"  {'시도':<14} {'전체':>5} {'sigungu_null':>14}")
for sido, tot, snull in cur.fetchall():
    print(f"  {sido:<14} {tot:>5} {snull:>14}")

print()
print("=== 제주도 facilities 샘플 (신고 B 검증) ===")
cur.execute("""
SELECT facility_id, company_name, site_address, region_sido, region_sigungu
FROM facilities
WHERE region_sido LIKE '%제주%' OR site_address LIKE '%제주%'
""")
for r in cur.fetchall():
    print(f"  fid={r[0][:18]:<18} sido={r[3]!r:>10} sigungu={r[4]!r:>10}  name={r[1]}  addr={r[2]}")

con.close()
