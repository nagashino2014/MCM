#!/usr/bin/env python3
"""Upload local MCM runtime files to S3 using the migration prefix map."""

from __future__ import annotations

import argparse
import mimetypes
from pathlib import Path

import boto3


ROOT = Path(__file__).resolve().parents[2]

PREFIX_MAP = {
    ROOT / "data" / "ieps" / "raw": "ieps/raw",
    ROOT / "data" / "ieps" / "extracted": "ieps/extracted",
    ROOT / "data" / "ieps" / "logs": "ieps/logs",
    ROOT / "frontend" / "public" / "uploads" / "logos": "uploads/logos",
    ROOT / "data" / "ksic": "reference/ksic",
    ROOT / "backend" / "data" / "jobs": "jobs/backend",
    ROOT / "frontend" / "data" / "chromadb": "vector/chromadb-snapshot",
}


def upload_tree(client, bucket: str, root: Path, prefix: str, dry_run: bool) -> int:
    if not root.exists():
        print(f"skip missing {root}")
        return 0

    files = [root] if root.is_file() else [p for p in root.rglob("*") if p.is_file()]
    for file_path in files:
        rel = file_path.name if root.is_file() else file_path.relative_to(root).as_posix()
        key = f"{prefix}/{rel}".replace("\\", "/")
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        if dry_run:
            print(f"DRY {file_path} -> s3://{bucket}/{key}")
            continue
        client.upload_file(
            str(file_path),
            bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        print(f"PUT {file_path} -> s3://{bucket}/{key}")
    return len(files)


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload MCM runtime files to S3.")
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--region", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    client = boto3.client("s3", region_name=args.region)
    total = 0
    for root, prefix in PREFIX_MAP.items():
        total += upload_tree(client, args.bucket, root, prefix, args.dry_run)
    print(f"files considered: {total}")


if __name__ == "__main__":
    main()
