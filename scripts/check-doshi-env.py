"""도시환경(주) 의 DB 적재 상태와 시군구 매핑에 필요한 모든 필드 확인."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

DB = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"
con = sqlite3.connect(DB)
cur = con.cursor()

print("=== facilities 컬럼 전체 ===")
cur.execute("PRAGMA table_info(facilities)")
for r in cur.fetchall():
    print(f"  {r[1]:25s}  {r[2]}")

print()
print("=== facilities 테이블에서 '도시환경' 검색 ===")
cur.execute("SELECT * FROM facilities WHERE company_name LIKE '%도시환경%'")
fac_rows = cur.fetchall()
cols = [d[0] for d in cur.description]
for row in fac_rows:
    print()
    for c, v in zip(cols, row):
        print(f"  {c:25s}: {v!r}")
if not fac_rows:
    print("  (없음)")

print()
print("=== permits 컬럼 전체 ===")
cur.execute("PRAGMA table_info(permits)")
for r in cur.fetchall():
    print(f"  {r[1]:25s}  {r[2]}")

print()
print("=== 도시환경 permits 데이터 ===")
if fac_rows:
    fid = fac_rows[0][0]
    cur.execute("SELECT * FROM permits WHERE facility_id = ?", (fid,))
    cols = [d[0] for d in cur.description]
    for row in cur.fetchall():
        print()
        for c, v in zip(cols, row):
            print(f"  {c:25s}: {v!r}")

con.close()
