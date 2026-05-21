"""신고 C 진단 — 애경특수도료(주) 허가일자, (주)포스코엠텍제2공장 수질 종 규모 누락 원인.
검수 대기열엔 안 잡혔지만 사업장 리스트엔 누락된 케이스.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
DB = Path(__file__).resolve().parents[1] / "data" / "ieps" / "db.sqlite"
con = sqlite3.connect(DB)
cur = con.cursor()

print("=== 1. 애경특수도료 / 포스코엠텍제2공장 facilities ===")
cur.execute("""
SELECT facility_id, company_name, region_sido, region_sigungu, site_address
FROM facilities
WHERE company_name LIKE '%애경%' OR company_name LIKE '%포스코엠텍%'
""")
for r in cur.fetchall():
    print(f"  {r[0]}  {r[1]}  sido={r[2]}  sigungu={r[3]}  addr={r[4]}")

print()
print("=== 2. parsed_fields 테이블 컬럼 ===")
cur.execute("PRAGMA table_info(parsed_fields)")
for r in cur.fetchall():
    print(f"  {r[1]:25s}  {r[2]}")

print()
print("=== 3. permits / permit_scales / facility_air_review 테이블 컬럼 ===")
for tbl in ("permits", "permit_scales", "facility_air_review", "latest_scales", "scales"):
    try:
        cur.execute(f"PRAGMA table_info({tbl})")
        rows = cur.fetchall()
        if rows:
            print(f"\n  [{tbl}]")
            for r in rows:
                print(f"    {r[1]:25s}  {r[2]}")
        else:
            print(f"\n  [{tbl}]  (no columns)")
    except sqlite3.OperationalError as e:
        print(f"\n  [{tbl}]  ERR: {e}")

def dump_facility(fid: str, label: str) -> None:
    print(f"\n=== [{label}]  fid={fid} ===")

    cur.execute("SELECT * FROM permits WHERE facility_id = ? ORDER BY is_first_permit DESC, permit_date DESC", (fid,))
    pcols = [d[0] for d in cur.description]
    permits = cur.fetchall()
    print(f"  permits 개수: {len(permits)}")
    for prow in permits:
        d = dict(zip(pcols, prow))
        print(f"    permit_id={d['permit_id']}  decision_no={d['decision_no']!r}  date={d['permit_date']!r}  type={d['permit_type']!r}  is_first={d['is_first_permit']}  att={d['source_attachment_id']}")
        cur.execute("SELECT * FROM permit_scales WHERE permit_id = ?", (d['permit_id'],))
        scols = [x[0] for x in cur.description]
        for srow in cur.fetchall():
            sd = dict(zip(scols, srow))
            print(f"      scale: air_class={sd['air_class']!r}  air_amt={sd['air_amount_ton_per_year']!r}  water_class={sd['water_class']!r}  water_amt={sd['wastewater_amount_m3_per_day']!r}  page={sd['source_page']}")

    print("  parsed_fields (모든 attachment) --")
    cur.execute("""
    SELECT pf.attachment_id, pf.rule_id, pf.normalized_value, pf.raw_value, pf.reviewed_value,
           pf.needs_review, pf.source_page, pf.confidence, pf.error
    FROM parsed_fields pf
    WHERE pf.attachment_id IN (
        SELECT source_attachment_id FROM permits WHERE facility_id = ?
    )
    ORDER BY pf.attachment_id, pf.rule_id
    """, (fid,))
    rows = cur.fetchall()
    if not rows:
        print("    (parsed_fields 없음)")
    last_att = None
    for prow in rows:
        att = prow[0]
        if att != last_att:
            print(f"    [{att}]")
            last_att = att
        norm = prow[2]
        raw = prow[3]
        rev = prow[4]
        nr = prow[5]
        page = prow[6]
        conf = prow[7]
        err = prow[8]
        print(f"      {prow[1]:<20}  norm={norm!r}  raw={raw!r}  rev={rev!r}  nr={nr}  p={page}  conf={conf}  err={err!r}")


cur.execute("SELECT facility_id, company_name FROM facilities WHERE company_name = '애경특수도료㈜'")
for fid, name in cur.fetchall():
    dump_facility(fid, name)

cur.execute("SELECT facility_id, company_name FROM facilities WHERE company_name LIKE '%포스코엠텍%2공장%'")
for fid, name in cur.fetchall():
    dump_facility(fid, name)

con.close()
