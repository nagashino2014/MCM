#!/usr/bin/env python3
"""
Create a read-only local baseline inventory before AWS migration.

The script intentionally does not upload or mutate anything. It inspects:
- SQLite integrity, tables, indexes, columns, row counts
- local runtime file roots that must move to S3
- environment variable names that must move to Secrets Manager/SSM
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "data" / "ieps" / "db.sqlite"
DEFAULT_OUTPUT = ROOT / "docs" / "aws" / "local-inventory.json"

FILE_ROOTS = {
    "ieps_raw": ROOT / "data" / "ieps" / "raw",
    "ieps_extracted": ROOT / "data" / "ieps" / "extracted",
    "ieps_logs": ROOT / "data" / "ieps" / "logs",
    "ieps_summary": ROOT / "data" / "ieps" / "summary.json",
    "logos": ROOT / "frontend" / "public" / "uploads" / "logos",
    "ksic": ROOT / "data" / "ksic" / "ksic11.json",
    "chromadb": ROOT / "frontend" / "data" / "chromadb",
    "backend_jobs": ROOT / "backend" / "data" / "jobs",
}

ENV_KEYS = [
    "IEPS_DB_PATH",
    "SCRAPER_DB_PATH",
    "IEPS_BACKEND_URL",
    "IEPS_PLAYWRIGHT",
    "AUTH_SECRET",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "ADMIN_NAME",
    "OCR_USE_GPU",
    "DOCKER_ENV",
    "KSIC_JSON_PATH",
    "OPENAI_API_KEY",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
]


def scan_path(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "files": 0, "bytes": 0}
    if path.is_file():
        return {"exists": True, "files": 1, "bytes": path.stat().st_size}

    files = 0
    total = 0
    suffix_counts: dict[str, int] = {}
    for item in path.rglob("*"):
        if not item.is_file():
            continue
        files += 1
        total += item.stat().st_size
        suffix = item.suffix.lower() or "<none>"
        suffix_counts[suffix] = suffix_counts.get(suffix, 0) + 1
    return {
        "exists": True,
        "files": files,
        "bytes": total,
        "suffix_counts": dict(sorted(suffix_counts.items())),
    }


def sqlite_inventory(db_path: Path) -> dict[str, Any]:
    if not db_path.exists():
        return {"exists": False, "path": str(db_path)}

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
        tables = conn.execute(
            """
            SELECT name, sql
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
        indexes = conn.execute(
            """
            SELECT name, tbl_name, sql
            FROM sqlite_master
            WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
            ORDER BY tbl_name, name
            """
        ).fetchall()

        table_details: dict[str, Any] = {}
        for table in tables:
            name = table["name"]
            count = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            columns = conn.execute(f'PRAGMA table_info("{name}")').fetchall()
            table_details[name] = {
                "row_count": count,
                "columns": [
                    {
                        "name": col["name"],
                        "type": col["type"],
                        "notnull": bool(col["notnull"]),
                        "default": col["dflt_value"],
                        "primary_key": bool(col["pk"]),
                    }
                    for col in columns
                ],
            }

        return {
            "exists": True,
            "path": str(db_path),
            "bytes": db_path.stat().st_size,
            "integrity_check": integrity,
            "foreign_key_check": [dict(row) for row in foreign_keys],
            "tables": table_details,
            "indexes": [dict(row) for row in indexes],
        }
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create MCM local AWS migration inventory.")
    parser.add_argument("--db", default=os.environ.get("IEPS_DB_PATH") or str(DEFAULT_DB))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    inventory = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workspace": str(ROOT),
        "database": sqlite_inventory(Path(args.db)),
        "files": {name: scan_path(path) for name, path in FILE_ROOTS.items()},
        "environment": {
            key: {
                "present": key in os.environ,
                "secret": key.endswith("SECRET")
                or "PASSWORD" in key
                or "KEY" in key
                or key == "AUTH_SECRET",
            }
            for key in ENV_KEYS
        },
    }

    output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
