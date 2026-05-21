#!/usr/bin/env python3
"""
Load the local SQLite snapshot into PostgreSQL/Aurora.

Expected flow:
1. Apply infra/aws/001_initial_schema.sql to an empty PostgreSQL database.
2. Stop local writers and copy data/ieps/db.sqlite.
3. Run this script against the copied SQLite file and staging DATABASE_URL.

This is intentionally conservative: it preserves existing string IDs and inserts
tables in dependency order so validation failures are visible early.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from pathlib import Path
from typing import Any


TABLE_ORDER = [
    "documents",
    "attachments",
    "scrape_logs",
    "facilities",
    "permits",
    "permit_scales",
    "product_outputs",
    "facility_annual_reports",
    "parsed_fields",
    "collection_configs",
    "users",
    "audit_log",
    "facility_merge_aliases",
    "facility_permit_successions",
    "facility_history_events",
    "facility_merge_exclusions",
    "facility_groups",
    "facility_group_divisions",
    "facility_group_companies",
    "facility_group_memberships",
    "legal_entities",
    "facility_operating_entities",
    "contract_import_batches",
    "contract_import_staging",
    "contracts",
    "contract_payment_milestones",
    "contract_change_events",
    "contract_documents",
    "contract_invoices",
    "contract_duplicate_candidates",
    "facility_aliases",
    "facility_service_categories",
    "facility_manual_products",
    "facility_contact_main_numbers",
    "facility_contact_departments",
    "facility_contact_people",
    "facility_contact_logs",
    "download_events",
    "alerts",
]

JSON_COLUMNS = {
    "documents": {"metadata"},
    "facility_annual_reports": {"product_outputs_json"},
    "collection_configs": {"config_json"},
    "audit_log": {"before_json", "after_json"},
    "facility_merge_exclusions": {"facility_ids_json"},
    "alerts": {"payload_json"},
    "contract_import_batches": {"summary_json"},
    "contract_import_staging": {"raw_json", "issue_json"},
    "contract_duplicate_candidates": {"payload_json"},
}

SERIAL_ID_TABLES = [
    "permit_scales",
    "product_outputs",
    "parsed_fields",
    "collection_configs",
    "audit_log",
    "facility_merge_aliases",
    "facility_permit_successions",
    "facility_history_events",
    "facility_merge_exclusions",
    "facility_group_memberships",
    "facility_operating_entities",
    "contract_import_staging",
    "facility_aliases",
    "facility_manual_products",
    "facility_contact_departments",
    "facility_contact_people",
    "facility_contact_logs",
    "download_events",
    "alerts",
]


def parse_json(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    if value == "":
        return None
    return json.loads(value)


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    return [row["name"] for row in rows]


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def load_table(pg_conn: Any, sqlite_conn: sqlite3.Connection, table: str, dry_run: bool) -> int:
    if not table_exists(sqlite_conn, table):
        return 0

    columns = table_columns(sqlite_conn, table)
    rows = sqlite_conn.execute(f'SELECT * FROM "{table}"').fetchall()
    if dry_run:
        return len(rows)
    if not rows:
        return 0

    placeholders = ", ".join(["%s"] * len(columns))
    col_list = ", ".join(f'"{col}"' for col in columns)
    sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
    json_cols = JSON_COLUMNS.get(table, set())

    with pg_conn.cursor() as cur:
        for row in rows:
            values = []
            for col in columns:
                value = row[col]
                if col in json_cols:
                    from psycopg.types.json import Jsonb

                    value = Jsonb(parse_json(value))
                values.append(value)
            cur.execute(sql, values)
    return len(rows)


def reset_serial_sequences(pg_conn: Any) -> None:
    """Keep PostgreSQL bigserial sequences ahead of explicitly imported SQLite ids."""
    with pg_conn.cursor() as cur:
        for table in SERIAL_ID_TABLES:
            cur.execute(
                """
                SELECT setval(
                    pg_get_serial_sequence(%s, 'id'),
                    COALESCE((SELECT MAX(id) FROM public.""" + f'"{table}"' + """), 1),
                    (SELECT COUNT(*) > 0 FROM public.""" + f'"{table}"' + """)
                )
                """,
                (f"public.{table}",),
            )
            print(f"{table}: sequence reset")


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate MCM SQLite data to PostgreSQL.")
    parser.add_argument("--sqlite", required=True)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite file not found: {sqlite_path}")

    sqlite_conn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    sqlite_conn.row_factory = sqlite3.Row
    try:
        integrity = sqlite_conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"SQLite integrity_check failed: {integrity}")

        if args.dry_run:
            for table in TABLE_ORDER:
                print(f"{table}: {load_table(None, sqlite_conn, table, True)} rows")
            return

        if not args.database_url:
            raise SystemExit("DATABASE_URL or --database-url is required")

        import psycopg

        with psycopg.connect(args.database_url) as pg_conn:
            with pg_conn.cursor() as cur:
                cur.execute("SET session_replication_role = 'replica'")
            try:
                for table in TABLE_ORDER:
                    count = load_table(pg_conn, sqlite_conn, table, False)
                    print(f"{table}: inserted up to {count} rows")
                reset_serial_sequences(pg_conn)
                pg_conn.commit()
            finally:
                with pg_conn.cursor() as cur:
                    cur.execute("SET session_replication_role = 'origin'")
                pg_conn.commit()

            print("--- foreign key integrity check ---")
            orphan_total = 0
            with pg_conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        tc.table_name,
                        kcu.column_name,
                        ccu.table_name  AS ref_table,
                        ccu.column_name AS ref_column,
                        tc.constraint_name
                    FROM information_schema.table_constraints AS tc
                    JOIN information_schema.key_column_usage AS kcu
                      ON tc.constraint_name = kcu.constraint_name
                     AND tc.table_schema    = kcu.table_schema
                    JOIN information_schema.constraint_column_usage AS ccu
                      ON ccu.constraint_name = tc.constraint_name
                     AND ccu.table_schema    = tc.table_schema
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_schema    = 'public'
                    ORDER BY tc.table_name, tc.constraint_name
                    """
                )
                fks = cur.fetchall()
            with pg_conn.cursor() as cur:
                for tbl, col, rtbl, rcol, cname in fks:
                    cur.execute(
                        f'SELECT COUNT(*) FROM "{tbl}" t '
                        f'WHERE t."{col}" IS NOT NULL '
                        f'AND NOT EXISTS (SELECT 1 FROM "{rtbl}" r WHERE r."{rcol}" = t."{col}")'
                    )
                    n = cur.fetchone()[0]
                    if n:
                        orphan_total += n
                        print(f"ORPHAN  {tbl}.{col} -> {rtbl}.{rcol}: {n} rows  ({cname})")
            if orphan_total == 0:
                print("foreign key integrity: OK (no orphan rows)")
            else:
                print(f"foreign key integrity: {orphan_total} orphan rows total (review and clean up)")
    finally:
        sqlite_conn.close()


if __name__ == "__main__":
    main()
