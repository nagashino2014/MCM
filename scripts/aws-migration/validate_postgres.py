#!/usr/bin/env python3
"""Compare local inventory row counts with PostgreSQL row counts after migration."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate PostgreSQL migration row counts.")
    parser.add_argument("--inventory", required=True)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("DATABASE_URL or --database-url is required")

    import psycopg

    inventory = json.loads(Path(args.inventory).read_text(encoding="utf-8"))
    expected = {
        name: details["row_count"]
        for name, details in inventory.get("database", {}).get("tables", {}).items()
    }

    failures = []
    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            for table, expected_count in sorted(expected.items()):
                cur.execute(f'SELECT COUNT(*) FROM "{table}"')
                actual = cur.fetchone()[0]
                status = "OK" if actual == expected_count else "MISMATCH"
                print(f"{status} {table}: expected={expected_count} actual={actual}")
                if actual != expected_count:
                    failures.append((table, expected_count, actual))

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
