#!/usr/bin/env python3
"""성과급 산정.xlsm 제비용 → MCM DB 백필 (일회성, 블루프린트 §8).

'성과급 대상액 산정(통합/기타/화관법/HAPs)' 4개 시트에서 용역명(A열)으로
contracts.contract_title 을 매칭해 두 가지를 적재한다.

1) 외주금액 = T(외주금액) + U(도면작성) 합 → contract_outsourcing 에 1건 INSERT
   - '도면작성' 항목은 폐지 확정 — 외주금액으로 합산(사용자 2026-08-12)
   - 외주금액은 성과급 화면에서 수동 입력 불가, contract_outsourcing 집계만 반영되므로
     엑셀 값을 이 테이블로 옮긴다 (source='bonus_excel_backfill')
   - 해당 계약에 이미 외주 건이 있으면 스킵하고 기존합/엑셀합을 리포트(중복 계상 방지)
2) 영업비용 = V열 → bonus_contract_costs.sales_cost_amount upsert

연구소 시트는 데이터가 없어 제외. 매칭 실패/중복 계약명은 스킵하고 리포트만 남긴다.

사용법:
  DATABASE_URL=postgresql://... python scripts/import_bonus_costs_from_excel.py --dry-run
  DATABASE_URL=postgresql://... python scripts/import_bonus_costs_from_excel.py
"""
from __future__ import annotations

import argparse
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import openpyxl
import psycopg

DEFAULT_XLSX = Path(r"V:\업무자료\경리업무\성과급 관련\성과급 지급현황\성과급 산정.xlsm")

SHEETS = [
    "성과급 대상액 산정(통합)",
    "성과급 대상액 산정(기타)",
    "성과급 대상액 산정(화관법)",
    "성과급 대상액 산정(HAPs)",
]

C_TITLE = 1        # A 용역명
C_OUTSOURCING = 20  # T 외주금액
C_DRAWING = 21      # U 도면작성
C_SALES = 22        # V 영업비용
DATA_START = 5      # 데이터는 5행부터 (r1~r4 헤더)

OUTSOURCING_TITLE = "외주비용(성과급 엑셀 이관)"
BACKFILL_SOURCE = "bonus_excel_backfill"


def norm(s: Optional[str]) -> str:
    """매칭용 정규화: 양끝 공백 제거 + 내부 연속 공백 1칸."""
    return re.sub(r"\s+", " ", (s or "").strip())


def num(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", type=Path, default=DEFAULT_XLSX)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL 환경변수가 필요합니다.")

    wb = openpyxl.load_workbook(args.xlsx, data_only=True, read_only=True)

    # 엑셀에서 (용역명 → 외주합/영업비용) 수집. 시트 간 동일 용역명은 마지막 값이 아니라 합산하지 않고
    # 첫 등장 값 유지 + 리포트(시트가 분류별이라 원칙상 중복 없음).
    rows: dict[str, dict] = {}
    dup_in_excel: list[str] = []
    for sheet in SHEETS:
        ws = wb[sheet]
        for r in ws.iter_rows(min_row=DATA_START, max_col=C_SALES, values_only=True):
            title = norm(str(r[C_TITLE - 1]) if r[C_TITLE - 1] is not None else "")
            if not title or title == "0":
                continue
            outsourcing = num(r[C_OUTSOURCING - 1]) + num(r[C_DRAWING - 1])
            sales = num(r[C_SALES - 1])
            if outsourcing <= 0 and sales <= 0:
                continue
            if title in rows:
                dup_in_excel.append(f"{sheet}: {title}")
                continue
            rows[title] = {"outsourcing": outsourcing, "sales": sales, "sheet": sheet}
    wb.close()
    print(f"엑셀 제비용 보유 용역: {len(rows)}건 (시트 간 중복 {len(dup_in_excel)}건 스킵)")

    now = datetime.now(timezone.utc).isoformat()
    stats = {"outsourcing_insert": 0, "outsourcing_skip_existing": 0, "sales_upsert": 0,
             "no_match": 0, "multi_match": 0}
    report: list[str] = []

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT contract_id, contract_title FROM contracts WHERE deleted_at IS NULL")
            by_title: dict[str, list[str]] = {}
            for cid, title in cur.fetchall():
                by_title.setdefault(norm(title), []).append(cid)

            cur.execute(
                "SELECT contract_id, SUM(COALESCE(amount,0)) FROM contract_outsourcing GROUP BY contract_id"
            )
            existing_outsourcing = {cid: float(total or 0) for cid, total in cur.fetchall()}

            for title, data in rows.items():
                ids = by_title.get(title)
                if not ids:
                    stats["no_match"] += 1
                    report.append(f"[매칭실패] {data['sheet']}: {title}")
                    continue
                if len(ids) > 1:
                    stats["multi_match"] += 1
                    report.append(f"[중복계약명] {title} → {len(ids)}건, 스킵")
                    continue
                cid = ids[0]

                if data["outsourcing"] > 0:
                    if cid in existing_outsourcing:
                        stats["outsourcing_skip_existing"] += 1
                        report.append(
                            f"[외주 기존건 존재] {title}: 기존합 {existing_outsourcing[cid]:,.0f} / "
                            f"엑셀합 {data['outsourcing']:,.0f} — 스킵(수동 대조 필요)"
                        )
                    else:
                        stats["outsourcing_insert"] += 1
                        if not args.dry_run:
                            cur.execute(
                                """INSERT INTO contract_outsourcing
                                     (outsourcing_id, contract_id, outsourcing_title, amount,
                                      source, created_at, updated_at)
                                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                                (f"co_{secrets.token_hex(8)}", cid, OUTSOURCING_TITLE,
                                 data["outsourcing"], BACKFILL_SOURCE, now, now),
                            )

                if data["sales"] > 0:
                    stats["sales_upsert"] += 1
                    if not args.dry_run:
                        cur.execute(
                            """INSERT INTO bonus_contract_costs
                                 (contract_id, sales_cost_amount, updated_at)
                               VALUES (%s, %s, %s)
                               ON CONFLICT (contract_id) DO UPDATE SET
                                 sales_cost_amount = EXCLUDED.sales_cost_amount,
                                 updated_at = EXCLUDED.updated_at""",
                            (cid, data["sales"], now),
                        )
        if args.dry_run:
            conn.rollback()
        else:
            conn.commit()

    print("--- 리포트 ---")
    for line in report:
        print(line)
    for line in dup_in_excel:
        print(f"[엑셀 중복] {line}")
    print("--- 결과 ---")
    mode = "DRY-RUN" if args.dry_run else "적용"
    print(f"[{mode}] 외주 INSERT {stats['outsourcing_insert']} / 외주 기존건 스킵 {stats['outsourcing_skip_existing']} / "
          f"영업비용 upsert {stats['sales_upsert']} / 매칭실패 {stats['no_match']} / 중복계약명 {stats['multi_match']}")


if __name__ == "__main__":
    main()
