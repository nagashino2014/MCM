#!/usr/bin/env python3
"""
Build the contract-pdf migration plan from the dry-run reports, optionally
upload every matched PDF to S3, and emit a single idempotent SQL file that:

* INSERTs `contract_documents` rows for each 계약서 / 변경계약서.
* INSERTs `contract_documents` rows for each 세금계산서 PDF.
* INSERTs `contract_invoices` rows linking the invoice to its milestone.
* UPDATEs `contract_payment_milestones` so the per-stage invoice/collection
  fields reflect the migrated invoice.
* Optionally INSERTs new `contract_payment_milestones` rows for invoice
  files whose stage label is missing from the DB (the user opted in via the
  `auto-create-stages` answer).

Idempotency
-----------
Every INSERT uses `INSERT ... SELECT ... WHERE NOT EXISTS (...)` keyed on
`(contract_id, sha256)` (or `milestone_id`/`change_id` for the milestone /
invoice rows) so the SQL can be re-applied safely.

Workflow
--------
1. Run `dump_contracts_for_pdf_match.py` (creates contracts.csv / milestones.csv).
2. Run `scan_pdfs_dry_run.py` (creates matched/unmatched CSVs).
3. Run this script in --dry-run mode to verify the plan.
4. Re-run without --dry-run to upload to S3 and write the SQL file.
5. Apply the SQL file via `apply_sql_via_ssm.py`.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:  # pragma: no cover
    boto3 = None  # type: ignore[assignment]
    ClientError = Exception  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Filename / key helpers — must match
# frontend/lib/storage/contract-document-storage.ts exactly so that the same
# (contract, file) pair always lands at the same S3 key whether the upload
# happens through the API or this migration script.

PATH_UNSAFE_RE = re.compile(r"[\\/:*?\"<>|\x00-\x1f]+")
WHITESPACE_RE = re.compile(r"\s+")


def sanitize_path_segment(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKC", value)
    normalized = PATH_UNSAFE_RE.sub("_", normalized).strip()
    return WHITESPACE_RE.sub(" ", normalized)


def sanitize_filename(value: str) -> str:
    cleaned = sanitize_path_segment(value)
    if not cleaned or cleaned in (".", ".."):
        raise ValueError("잘못된 파일명입니다.")
    return cleaned[:200]


def build_doc_filename(date: str, contract_title: str, doc_type: str) -> str:
    title = sanitize_path_segment(contract_title)
    kind = "변경계약서" if doc_type == "amendment" else "계약서"
    return sanitize_filename(f"({date}){title} {kind}.pdf")


def build_invoice_filename(issue_date: str, contract_title: str, stage_label: str) -> str:
    title = sanitize_path_segment(contract_title)
    stage = sanitize_path_segment(stage_label or "").strip()
    middle = f" {stage}" if stage else ""
    return sanitize_filename(f"({issue_date}){title}{middle} 세금계산서.pdf")


def build_doc_storage_key(contract_date: str, document_date: str, contract_title: str, doc_type: str) -> tuple[str, str]:
    parsed = datetime.strptime(contract_date, "%Y-%m-%d")
    year = str(parsed.year)
    folder = sanitize_path_segment(f"({contract_date}) {contract_title}")
    file_name = build_doc_filename(document_date, contract_title, doc_type)
    key = "/".join(["contracts", "documents", year, folder, file_name])
    return key, file_name


def build_invoice_storage_key(issue_date: str, contract_title: str, stage_label: str) -> tuple[str, str]:
    parsed = datetime.strptime(issue_date, "%Y-%m-%d")
    year = str(parsed.year)
    quarter = "Q" + str((parsed.month - 1) // 3 + 1)
    file_name = build_invoice_filename(issue_date, contract_title, stage_label)
    key = "/".join(["contracts", "invoices", year, quarter, file_name])
    return key, file_name


# ---------------------------------------------------------------------------
# Hash / id helpers


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def deterministic_id(prefix: str, *parts: str) -> str:
    """Deterministic id derived from the joined parts.

    Using a stable id (instead of a random uuid) makes the generated SQL
    fully reproducible — a re-run of the script will emit the same
    document_id values, which combines nicely with the WHERE NOT EXISTS
    idempotency.
    """
    digest = hashlib.sha256("\u241e".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:16]}"


def stage_key_for_label(label: str) -> str:
    """Compute a slug stage_key from a Korean stage_label.

    The legacy import used `advance` / `mid{N}` / `completion`. New stage
    labels added by the migration may be irregular (e.g. `중도금2,3,4`), so
    we fall back to an 8-char hash of the normalized label which keeps the
    (contract_id, stage_key) uniqueness invariant intact.
    """
    n = (label or "").strip()
    if "선급" in n:
        return "advance"
    if "준공" in n:
        return "completion"
    m = re.search(r"중도금\s*(\d+)$", n)
    if m:
        return f"mid{m.group(1)}"
    digest = hashlib.sha256(n.encode("utf-8")).hexdigest()[:8]
    return f"ext_{digest}"


# ---------------------------------------------------------------------------
# SQL string formatting helpers. We render literal SQL (no parameters) since
# the file is applied through SSM `psql -f` which does not bind parameters
# from the calling shell.


def sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def sql_literal_or_null(value: object) -> str:
    if value is None or value == "":
        return "NULL"
    return sql_literal(value)


# ---------------------------------------------------------------------------
# Plan + execution


@dataclass
class DocumentPlan:
    document_id: str
    contract_id: str
    document_type: str  # contract|amendment
    document_date: str
    contract_date: str
    contract_title: str
    storage_key: str
    file_name: str
    original_filename: str
    sha256: str
    byte_size: int
    local_path: Path


@dataclass
class InvoicePlan:
    document_id: str
    invoice_id: str
    contract_id: str
    milestone_id: str | None
    stage_label: str
    issue_date: str
    contract_title: str
    storage_key: str
    file_name: str
    original_filename: str
    sha256: str
    byte_size: int
    local_path: Path


@dataclass
class NewMilestonePlan:
    milestone_id: str
    contract_id: str
    stage_label: str
    stage_order: int


@dataclass
class MigrationStats:
    docs_planned: int = 0
    docs_skipped_duplicates: int = 0
    invoices_planned: int = 0
    invoices_skipped_duplicates: int = 0
    new_milestones: int = 0
    s3_uploaded: int = 0
    s3_skipped: int = 0


# ---------------------------------------------------------------------------
# CSV loaders


def load_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


# ---------------------------------------------------------------------------
# Plan builders


def build_document_plan(
    rows: list[dict[str, str]],
    seen_hashes: dict[str, set[str]],
    stats: MigrationStats,
) -> list[DocumentPlan]:
    plans: list[DocumentPlan] = []
    for row in rows:
        local = Path(row["path"])
        if not local.exists():
            print(f"[warn] file missing, skipping: {local}", file=sys.stderr)
            continue
        sha = file_sha256(local)
        contract_id = row["contract_id"]
        if sha in seen_hashes.setdefault(contract_id, set()):
            stats.docs_skipped_duplicates += 1
            continue
        seen_hashes[contract_id].add(sha)
        contract_date = row.get("contract_date") or row["issue_date"]
        document_date = row["issue_date"]
        contract_title = row["contract_title"]
        doc_type = row["doc_type"]
        storage_key, file_name = build_doc_storage_key(
            contract_date=contract_date,
            document_date=document_date,
            contract_title=contract_title,
            doc_type=doc_type,
        )
        plans.append(
            DocumentPlan(
                document_id=deterministic_id("doc", contract_id, sha),
                contract_id=contract_id,
                document_type=doc_type,
                document_date=document_date,
                contract_date=contract_date,
                contract_title=contract_title,
                storage_key=storage_key,
                file_name=file_name,
                original_filename=local.name,
                sha256=sha,
                byte_size=local.stat().st_size,
                local_path=local,
            )
        )
        stats.docs_planned += 1
    return plans


def build_invoice_plan(
    rows: list[dict[str, str]],
    seen_hashes: dict[str, set[str]],
    stats: MigrationStats,
) -> list[InvoicePlan]:
    plans: list[InvoicePlan] = []
    for row in rows:
        local = Path(row["path"])
        if not local.exists():
            print(f"[warn] file missing, skipping: {local}", file=sys.stderr)
            continue
        sha = file_sha256(local)
        contract_id = row["contract_id"]
        if sha in seen_hashes.setdefault(contract_id, set()):
            stats.invoices_skipped_duplicates += 1
            continue
        seen_hashes[contract_id].add(sha)
        issue_date = row["issue_date"]
        contract_title = row["contract_title"]
        stage_label = row.get("stage_label") or ""
        milestone_id = row.get("milestone_id") or None
        storage_key, file_name = build_invoice_storage_key(
            issue_date=issue_date,
            contract_title=contract_title,
            stage_label=stage_label,
        )
        plans.append(
            InvoicePlan(
                document_id=deterministic_id("doc", contract_id, sha),
                invoice_id=deterministic_id("inv", contract_id, sha),
                contract_id=contract_id,
                milestone_id=milestone_id,
                stage_label=stage_label,
                issue_date=issue_date,
                contract_title=contract_title,
                storage_key=storage_key,
                file_name=file_name,
                original_filename=local.name,
                sha256=sha,
                byte_size=local.stat().st_size,
                local_path=local,
            )
        )
        stats.invoices_planned += 1
    return plans


# ---------------------------------------------------------------------------
# Auto stage recovery


@dataclass
class StageMap:
    """Maximum stage_order observed per contract, plus current label set."""
    max_order: dict[str, int] = field(default_factory=dict)
    labels: dict[str, set[str]] = field(default_factory=dict)


def load_stage_map(milestones_csv: Path) -> StageMap:
    sm = StageMap()
    rows = load_csv(milestones_csv)
    for row in rows:
        cid = row["contract_id"]
        order = int(row.get("stage_order") or 0)
        label = (row.get("stage_label") or "").strip()
        sm.max_order[cid] = max(sm.max_order.get(cid, 0), order)
        sm.labels.setdefault(cid, set()).add(re.sub(r"\s+", "", label))
    return sm


def recover_unmatched_stages(
    unmatched_rows: list[dict[str, str]],
    contracts_lookup: dict[str, dict[str, str]],
    stage_map: StageMap,
    stats: MigrationStats,
) -> tuple[list[NewMilestonePlan], list[dict[str, str]]]:
    """Promote 'stage_label 정확 매칭 실패 (DB에 단계 없음)' rows into matched
    invoice rows by synthesizing a new milestone."""
    new_milestones: list[NewMilestonePlan] = []
    promoted: list[dict[str, str]] = []
    for row in unmatched_rows:
        if "DB에 단계 없음" not in (row.get("reason") or ""):
            continue
        contract_id = row.get("contract_id") or ""
        stage = (row.get("parsed_stage") or "").strip()
        if not contract_id or not stage:
            continue
        normalized = re.sub(r"\s+", "", stage)
        if normalized in stage_map.labels.setdefault(contract_id, set()):
            continue
        next_order = stage_map.max_order.get(contract_id, 0) + 1
        stage_map.max_order[contract_id] = next_order
        stage_map.labels[contract_id].add(normalized)
        milestone_id = deterministic_id("ms", contract_id, normalized)
        new_milestones.append(
            NewMilestonePlan(
                milestone_id=milestone_id,
                contract_id=contract_id,
                stage_label=stage,
                stage_order=next_order,
            )
        )
        stats.new_milestones += 1
        m_date = re.match(r"^\((\d{4}-\d{2}-\d{2})\)", Path(row["path"]).name)
        issue_date = m_date.group(1) if m_date else ""
        if not issue_date:
            # Cannot determine the invoice issue date from the filename; the
            # row stays in unmatched.csv for manual handling.
            continue
        contract = contracts_lookup.get(contract_id, {})
        promoted.append(
            {
                "path": row["path"],
                "issue_date": issue_date,
                "contract_id": contract_id,
                "contract_title": row.get("contract_title") or contract.get("contract_title", ""),
                "counterparty_name": contract.get("counterparty_name", ""),
                "contract_date": contract.get("contract_date") or contract.get("started_at") or "",
                "milestone_id": milestone_id,
                "stage_label": stage,
            }
        )
    return new_milestones, promoted


# ---------------------------------------------------------------------------
# SQL emission

INSERT_DOC_TEMPLATE = """\
INSERT INTO contract_documents
  (document_id, contract_id, milestone_id, document_type, display_name,
   original_filename, content_type, byte_size, sha256,
   storage_provider, storage_bucket, storage_key, public_path, source,
   created_at, updated_at)
SELECT {document_id}, {contract_id}, {milestone_id}, {document_type}, {display_name},
       {original_filename}, 'application/pdf', {byte_size}, {sha256},
       's3', {bucket}, {storage_key}, {public_path}, 'legacy_migration',
       NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM contract_documents
  WHERE contract_id = {contract_id} AND sha256 = {sha256}
);"""

INSERT_INVOICE_TEMPLATE = """\
INSERT INTO contract_invoices
  (invoice_id, contract_id, milestone_id, document_id, issue_date,
   fiscal_year, fiscal_quarter, invoice_amount, supply_amount, vat_amount,
   payment_collected, payment_collected_at, issued_via, memo,
   created_at, updated_at)
SELECT {invoice_id}, {contract_id}, {milestone_id}, {document_id}, {issue_date},
       {fiscal_year}, {fiscal_quarter}, NULL, NULL, NULL,
       0, NULL, 'manual_pdf', 'legacy migration',
       NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM contract_invoices
  WHERE contract_id = {contract_id} AND document_id = {document_id}
);"""

UPDATE_MILESTONE_TEMPLATE = """\
UPDATE contract_payment_milestones
   SET invoice_issued = 1,
       invoice_issued_at = COALESCE(NULLIF(invoice_issued_at, ''), {issue_date}),
       updated_at = NOW()
 WHERE milestone_id = {milestone_id}
   AND contract_id = {contract_id};"""

INSERT_MILESTONE_TEMPLATE = """\
INSERT INTO contract_payment_milestones
  (milestone_id, contract_id, stage_key, stage_label, stage_order, amount,
   invoice_issued, payment_collected, created_at, updated_at)
SELECT {milestone_id}, {contract_id}, {stage_key}, {stage_label}, {stage_order}, 0,
       0, 0, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM contract_payment_milestones WHERE milestone_id = {milestone_id}
);"""


def render_sql(
    *,
    bucket: str,
    new_milestones: list[NewMilestonePlan],
    documents: list[DocumentPlan],
    invoices: list[InvoicePlan],
) -> str:
    lines: list[str] = [
        "-- Generated by scripts/contract-migration/migrate_pdfs.py",
        "BEGIN;",
        "",
    ]

    if new_milestones:
        lines.append("-- New milestones (auto-create-stages)")
        for m in new_milestones:
            lines.append(
                INSERT_MILESTONE_TEMPLATE.format(
                    milestone_id=sql_literal(m.milestone_id),
                    contract_id=sql_literal(m.contract_id),
                    stage_key=sql_literal(stage_key_for_label(m.stage_label)),
                    stage_label=sql_literal(m.stage_label),
                    stage_order=m.stage_order,
                )
            )
        lines.append("")

    if documents:
        lines.append("-- Contract / amendment documents")
        for d in documents:
            public_path = "/api/contracts/documents?key=" + d.storage_key
            lines.append(
                INSERT_DOC_TEMPLATE.format(
                    document_id=sql_literal(d.document_id),
                    contract_id=sql_literal(d.contract_id),
                    milestone_id="NULL",
                    document_type=sql_literal(d.document_type),
                    display_name=sql_literal(d.file_name),
                    original_filename=sql_literal(d.original_filename),
                    byte_size=d.byte_size,
                    sha256=sql_literal(d.sha256),
                    bucket=sql_literal(bucket),
                    storage_key=sql_literal(d.storage_key),
                    public_path=sql_literal(public_path),
                )
            )
        lines.append("")

    if invoices:
        lines.append("-- Tax invoices")
        for inv in invoices:
            public_path = "/api/contracts/documents?key=" + inv.storage_key
            parsed = datetime.strptime(inv.issue_date, "%Y-%m-%d")
            lines.append(
                INSERT_DOC_TEMPLATE.format(
                    document_id=sql_literal(inv.document_id),
                    contract_id=sql_literal(inv.contract_id),
                    milestone_id=sql_literal_or_null(inv.milestone_id),
                    document_type=sql_literal("tax_invoice"),
                    display_name=sql_literal(inv.file_name),
                    original_filename=sql_literal(inv.original_filename),
                    byte_size=inv.byte_size,
                    sha256=sql_literal(inv.sha256),
                    bucket=sql_literal(bucket),
                    storage_key=sql_literal(inv.storage_key),
                    public_path=sql_literal(public_path),
                )
            )
            lines.append(
                INSERT_INVOICE_TEMPLATE.format(
                    invoice_id=sql_literal(inv.invoice_id),
                    contract_id=sql_literal(inv.contract_id),
                    milestone_id=sql_literal_or_null(inv.milestone_id),
                    document_id=sql_literal(inv.document_id),
                    issue_date=sql_literal(inv.issue_date),
                    fiscal_year=parsed.year,
                    fiscal_quarter=(parsed.month - 1) // 3 + 1,
                )
            )
            if inv.milestone_id:
                lines.append(
                    UPDATE_MILESTONE_TEMPLATE.format(
                        issue_date=sql_literal(inv.issue_date),
                        milestone_id=sql_literal(inv.milestone_id),
                        contract_id=sql_literal(inv.contract_id),
                    )
                )
        lines.append("")

    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# S3 upload


def s3_object_exists(s3, bucket: str, key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:  # pragma: no cover
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise


def upload_to_s3(
    bucket: str,
    items: Iterable[tuple[str, Path]],
    stats: MigrationStats,
) -> None:
    if boto3 is None:
        raise SystemExit("boto3 가 설치되어 있지 않습니다. `pip install boto3`")
    session = boto3.Session(profile_name="mcm-kesi-staging", region_name="ap-northeast-2")
    s3 = session.client("s3")
    for key, path in items:
        if s3_object_exists(s3, bucket, key):
            stats.s3_skipped += 1
            continue
        with path.open("rb") as fh:
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=fh,
                ContentType="application/pdf",
                CacheControl="private, max-age=86400",
            )
        stats.s3_uploaded += 1
        if stats.s3_uploaded % 50 == 0:
            print(f"  uploaded {stats.s3_uploaded} files...")


# ---------------------------------------------------------------------------
# Main entry


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply the contract PDF migration plan.")
    parser.add_argument("--dump-dir", default="scripts/contract-migration/_dump")
    parser.add_argument("--bucket", default="mcm-ieps-staging-data")
    parser.add_argument(
        "--sql-out", default="scripts/contract-migration/_dump/migration.sql"
    )
    parser.add_argument("--dry-run", action="store_true", help="S3 업로드 없이 SQL 파일과 카운트만 생성합니다.")
    parser.add_argument(
        "--auto-create-stages",
        action="store_true",
        help="DB에 stage_label이 없는 unmatched 계산서에 대해 새 milestone을 자동 생성합니다.",
    )
    args = parser.parse_args()

    dump_dir = Path(args.dump_dir)
    matched_docs_csv = dump_dir / "matched_documents.csv"
    matched_inv_csv = dump_dir / "matched_invoices.csv"
    unmatched_inv_csv = dump_dir / "unmatched_invoices.csv"
    contracts_csv = dump_dir / "contracts.csv"
    milestones_csv = dump_dir / "milestones.csv"

    matched_docs = load_csv(matched_docs_csv)
    matched_inv = load_csv(matched_inv_csv)
    unmatched_inv = load_csv(unmatched_inv_csv)

    stats = MigrationStats()
    seen_hashes: dict[str, set[str]] = {}

    new_milestones: list[NewMilestonePlan] = []
    if args.auto_create_stages:
        contracts_lookup = {row["contract_id"]: row for row in load_csv(contracts_csv)}
        stage_map = load_stage_map(milestones_csv)
        new_milestones, promoted = recover_unmatched_stages(
            unmatched_inv, contracts_lookup, stage_map, stats
        )
        if promoted:
            matched_inv = matched_inv + promoted

    document_plans = build_document_plan(matched_docs, seen_hashes, stats)
    invoice_plans = build_invoice_plan(matched_inv, seen_hashes, stats)

    sql = render_sql(
        bucket=args.bucket,
        new_milestones=new_milestones,
        documents=document_plans,
        invoices=invoice_plans,
    )
    sql_out = Path(args.sql_out)
    sql_out.parent.mkdir(parents=True, exist_ok=True)
    sql_out.write_text(sql, encoding="utf-8")
    print(f"[sql] wrote {sql_out} ({sql_out.stat().st_size:,} bytes)")

    if args.dry_run:
        print("[dry-run] S3 upload skipped.")
    else:
        items: list[tuple[str, Path]] = []
        items.extend((d.storage_key, d.local_path) for d in document_plans)
        items.extend((inv.storage_key, inv.local_path) for inv in invoice_plans)
        print(f"[s3] uploading {len(items)} objects to s3://{args.bucket}/...")
        upload_to_s3(args.bucket, items, stats)

    print()
    print("=== Migration plan summary ===")
    print(f"new milestones       : {stats.new_milestones}")
    print(
        f"contract documents   : {stats.docs_planned} planned, "
        f"{stats.docs_skipped_duplicates} duplicates skipped"
    )
    print(
        f"invoices             : {stats.invoices_planned} planned, "
        f"{stats.invoices_skipped_duplicates} duplicates skipped"
    )
    if not args.dry_run:
        print(f"s3 uploaded          : {stats.s3_uploaded}")
        print(f"s3 skipped (exists)  : {stats.s3_skipped}")
    print(f"sql file             : {sql_out}")
    print()
    print("Next step:")
    print(
        "  python scripts/aws-migration/apply_sql_via_ssm.py \\\n"
        "    --instance-id i-0a711910c7ba59753 --bastion-role mcm-ieps-staging-bastion \\\n"
        "    --secret-id mcm-ieps-staging/app --s3-bucket mcm-ieps-staging-data \\\n"
        f"    --sql {sql_out}"
    )


if __name__ == "__main__":
    main()
