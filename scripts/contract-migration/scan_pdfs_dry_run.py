#!/usr/bin/env python3
"""
Dry-run scanner for the contract / invoice PDF migration.

Walks the local V: drive layout below and tries to match every PDF against
the contracts.csv / milestones.csv dump produced by
`dump_contracts_for_pdf_match.py`. Nothing is uploaded or written to the DB —
the script just emits matched.csv / unmatched.csv reports so that we can
review how clean the source folders are before committing to the real upload.

Expected source layout
======================

    V:\계약\매출계약서\{YYYY}\{계약폴더}\(YYYY-MM-DD)계약명 계약서.pdf
    V:\계약\매출계약서\{YYYY}\{계약폴더}\(YYYY-MM-DD)계약명 변경계약서.pdf
    V:\계약\매출계산서\{YYYY}\{Q}분기\(YYYY-MM-DD)계약명 {stage_label} 세금계산서.pdf

Matching rules
==============

* Contract document filenames must end with `계약서` or `변경계약서` (after
  stripping the leading `(date)` prefix and the `.pdf` extension).
* Invoice filenames must end with `세금계산서` and the body between the
  contract title and `세금계산서` is the stage label.
* Contract title matching is exact after Unicode NFKC normalization and
  whitespace collapsing. We pick the *longest* candidate title that the
  filename body starts with so that titles that share a prefix do not
  greedy-collide.
* Stage label matching is exact (whitespace stripped) per the user's
  preference; mismatches go to `unmatched.csv` rather than fuzzy.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Loading the DB dump

@dataclass
class Contract:
    contract_id: str
    contract_title: str
    counterparty_name: str
    service_type: str
    contract_date: str
    started_at: str

    @property
    def normalized_title(self) -> str:
        return normalize_title(self.contract_title)


@dataclass
class Milestone:
    milestone_id: str
    contract_id: str
    stage_label: str
    stage_order: int


def normalize_title(value: str) -> str:
    """NFKC + strip + collapse internal whitespace.

    The user said file naming uses the canonical contract title with no
    extra characters, so the only fudge factor we apply is whitespace
    collapsing — that handles cases where the file name picked up an
    accidental double space.
    """
    if value is None:
        return ""
    out = unicodedata.normalize("NFKC", str(value))
    out = re.sub(r"\s+", " ", out).strip()
    return out


def load_contracts(path: Path) -> list[Contract]:
    out: list[Contract] = []
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            out.append(
                Contract(
                    contract_id=row["contract_id"],
                    contract_title=row["contract_title"],
                    counterparty_name=row["counterparty_name"],
                    service_type=row["service_type"],
                    contract_date=row["contract_date"],
                    started_at=row["started_at"],
                )
            )
    return out


def load_milestones(path: Path) -> dict[str, list[Milestone]]:
    """Returns map<contract_id, list<Milestone>> sorted by stage_order."""
    by_contract: dict[str, list[Milestone]] = defaultdict(list)
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            by_contract[row["contract_id"]].append(
                Milestone(
                    milestone_id=row["milestone_id"],
                    contract_id=row["contract_id"],
                    stage_label=row["stage_label"],
                    stage_order=int(row["stage_order"] or 0),
                )
            )
    for ms in by_contract.values():
        ms.sort(key=lambda m: m.stage_order)
    return by_contract


# ---------------------------------------------------------------------------
# Title prefix index

@dataclass
class TitleIndex:
    """Match a normalized filename body against the longest contract title.

    We keep contracts grouped by their first character to keep the matching
    O(C/26) on average. For each candidate we try `body.startswith(title)`
    and pick the one with the longest title.
    """
    contracts: list[Contract]
    by_first: dict[str, list[Contract]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        groups: dict[str, list[Contract]] = defaultdict(list)
        for c in self.contracts:
            t = c.normalized_title
            if not t:
                continue
            groups[t[:1]].append(c)
        for lst in groups.values():
            lst.sort(key=lambda c: -len(c.normalized_title))
        self.by_first = dict(groups)

    def find_longest_prefix(self, body: str) -> Contract | None:
        body_norm = normalize_title(body)
        candidates = self.by_first.get(body_norm[:1], [])
        for c in candidates:
            if body_norm.startswith(c.normalized_title):
                return c
        return None


# ---------------------------------------------------------------------------
# Filename parsing

DATE_PREFIX_RE = re.compile(r"^\((\d{4}-\d{2}-\d{2})\)\s*(.+)$")
INVOICE_SUFFIX_RE = re.compile(r"^(.*?)\s*세금계산서\s*$")

# Trailing patterns that classify a contract document. Order matters — longer,
# more specific patterns must come first so that, for example, a
# "...용역 2차 변경 계약서" is treated as an amendment instead of a regular
# contract whose title happens to end with "2차 변경".
DOC_SUFFIX_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^(.*?)\s+\d+차\s*변경\s*계약서\s*$"), "amendment"),
    (re.compile(r"^(.*?)\s+계약\s*변경\s*합의서\s*$"), "amendment"),
    (re.compile(r"^(.*?)\s+변경\s*합의서\s*$"), "amendment"),
    (re.compile(r"^(.*?)\s*변경계약서\s*$"), "amendment"),
    (re.compile(r"^(.*?)\s+합의서\s*$"), "amendment"),
    (re.compile(r"^(.*?)\s*계약서\s*$"), "contract"),
]

# Stage labels in the file name occasionally carry a year tag right after the
# contract title (e.g. "...용역(2021년) 중도금1"). The DB stores the title
# without the year, so we strip that prefix from the leftover before doing the
# stage_label exact-match.
STAGE_LEADING_NOISE_RE = re.compile(r"^\(\d{4}년\)\s*")


def parse_basename(name: str) -> tuple[str, str]:
    """Return (date_str, body_without_date_or_extension)."""
    stem = name
    if stem.lower().endswith(".pdf"):
        stem = stem[:-4]
    stem = unicodedata.normalize("NFKC", stem).strip()
    m = DATE_PREFIX_RE.match(stem)
    if not m:
        return ("", stem)
    return (m.group(1), normalize_title(m.group(2)))


def split_document_suffix(body: str) -> tuple[str, str] | None:
    """Try the trailing patterns in order; return (title, doc_type) or None."""
    for regex, doc_type in DOC_SUFFIX_PATTERNS:
        m = regex.match(body)
        if m:
            return (m.group(1).strip(), doc_type)
    return None


# ---------------------------------------------------------------------------
# Scanning

@dataclass
class ScanResult:
    matched_documents: list[dict[str, str]] = field(default_factory=list)
    unmatched_documents: list[dict[str, str]] = field(default_factory=list)
    matched_invoices: list[dict[str, str]] = field(default_factory=list)
    unmatched_invoices: list[dict[str, str]] = field(default_factory=list)


def scan_documents(
    root: Path, idx: TitleIndex, result: ScanResult
) -> None:
    if not root.exists():
        print(f"[skip] {root} 폴더가 없습니다.")
        return
    for pdf in root.rglob("*.pdf"):
        rel = pdf.relative_to(root)
        date_str, body = parse_basename(pdf.name)
        if not date_str:
            result.unmatched_documents.append(
                {"path": str(pdf), "reason": "date prefix 없음", "parsed_body": body}
            )
            continue
        suffix = split_document_suffix(body)
        if not suffix:
            result.unmatched_documents.append(
                {
                    "path": str(pdf),
                    "reason": "끝이 '계약서/변경계약서/합의서' 아님",
                    "parsed_body": body,
                }
            )
            continue
        title_part, doc_type = suffix
        contract = idx.find_longest_prefix(title_part)
        if not contract:
            result.unmatched_documents.append(
                {
                    "path": str(pdf),
                    "reason": "DB에 일치하는 contract_title 없음",
                    "parsed_body": body,
                    "parsed_title": title_part,
                    "doc_kind": doc_type,
                }
            )
            continue
        result.matched_documents.append(
            {
                "path": str(pdf),
                "rel": str(rel),
                "issue_date": date_str,
                "contract_id": contract.contract_id,
                "contract_title": contract.contract_title,
                "counterparty_name": contract.counterparty_name,
                "contract_date": contract.contract_date or contract.started_at or date_str,
                "doc_type": doc_type,
            }
        )


def scan_invoices(
    root: Path,
    idx: TitleIndex,
    milestones_by_contract: dict[str, list[Milestone]],
    result: ScanResult,
) -> None:
    if not root.exists():
        print(f"[skip] {root} 폴더가 없습니다.")
        return
    for pdf in root.rglob("*.pdf"):
        rel = pdf.relative_to(root)
        date_str, body = parse_basename(pdf.name)
        if not date_str:
            result.unmatched_invoices.append(
                {"path": str(pdf), "reason": "date prefix 없음", "parsed_body": body}
            )
            continue
        m = INVOICE_SUFFIX_RE.match(body)
        if not m:
            result.unmatched_invoices.append(
                {
                    "path": str(pdf),
                    "reason": "끝이 '세금계산서' 아님",
                    "parsed_body": body,
                }
            )
            continue
        head = m.group(1).strip()
        contract = idx.find_longest_prefix(head)
        if not contract:
            result.unmatched_invoices.append(
                {
                    "path": str(pdf),
                    "reason": "DB에 일치하는 contract_title 없음",
                    "parsed_body": body,
                    "parsed_head": head,
                }
            )
            continue
        leftover = head[len(contract.normalized_title):].strip()
        # Some filenames carry a leading "(YYYY년)" annotation between the
        # contract title and the stage label that the DB does not preserve.
        leftover = STAGE_LEADING_NOISE_RE.sub("", leftover).strip()
        stage_label = re.sub(r"\s+", "", leftover)
        milestones = milestones_by_contract.get(contract.contract_id, [])
        match_ms = next(
            (ms for ms in milestones if re.sub(r"\s+", "", ms.stage_label) == stage_label),
            None,
        )
        if not match_ms:
            reason = (
                "stage_label 정확 매칭 실패 (DB에 단계 없음)"
                if stage_label and milestones
                else "stage_label 정확 매칭 실패"
            )
            result.unmatched_invoices.append(
                {
                    "path": str(pdf),
                    "reason": reason,
                    "parsed_body": body,
                    "parsed_head": head,
                    "parsed_stage": leftover,
                    "contract_id": contract.contract_id,
                    "contract_title": contract.contract_title,
                    "available_stages": " | ".join(ms.stage_label for ms in milestones),
                }
            )
            continue
        result.matched_invoices.append(
            {
                "path": str(pdf),
                "rel": str(rel),
                "issue_date": date_str,
                "contract_id": contract.contract_id,
                "contract_title": contract.contract_title,
                "counterparty_name": contract.counterparty_name,
                "contract_date": contract.contract_date or contract.started_at or date_str,
                "milestone_id": match_ms.milestone_id,
                "stage_label": match_ms.stage_label,
            }
        )


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    keys: list[str] = []
    seen = set()
    for row in rows:
        for k in row.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=keys)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="Dry-run scan for contract/invoice PDFs.")
    parser.add_argument(
        "--contracts-csv",
        default="scripts/contract-migration/_dump/contracts.csv",
    )
    parser.add_argument(
        "--milestones-csv",
        default="scripts/contract-migration/_dump/milestones.csv",
    )
    parser.add_argument(
        "--documents-root",
        default=r"V:\\계약\\매출계약서",
    )
    parser.add_argument(
        "--invoices-root",
        default=r"V:\\계약\\매출계산서",
    )
    parser.add_argument(
        "--out-dir",
        default="scripts/contract-migration/_dump",
    )
    args = parser.parse_args()

    contracts_csv = Path(args.contracts_csv)
    milestones_csv = Path(args.milestones_csv)
    if not contracts_csv.exists() or not milestones_csv.exists():
        print(
            "contracts.csv / milestones.csv가 없습니다. dump_contracts_for_pdf_match.py 먼저 실행하세요.",
            file=sys.stderr,
        )
        sys.exit(1)

    contracts = load_contracts(contracts_csv)
    milestones_by_contract = load_milestones(milestones_csv)
    print(f"[load] contracts={len(contracts)}, milestones={sum(len(v) for v in milestones_by_contract.values())}")

    idx = TitleIndex(contracts)
    result = ScanResult()

    documents_root = Path(args.documents_root)
    invoices_root = Path(args.invoices_root)
    print(f"[scan] documents: {documents_root}")
    scan_documents(documents_root, idx, result)
    print(
        f"  matched={len(result.matched_documents)}, "
        f"unmatched={len(result.unmatched_documents)}"
    )

    print(f"[scan] invoices:  {invoices_root}")
    scan_invoices(invoices_root, idx, milestones_by_contract, result)
    print(
        f"  matched={len(result.matched_invoices)}, "
        f"unmatched={len(result.unmatched_invoices)}"
    )

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_csv(out_dir / "matched_documents.csv", result.matched_documents)
    write_csv(out_dir / "unmatched_documents.csv", result.unmatched_documents)
    write_csv(out_dir / "matched_invoices.csv", result.matched_invoices)
    write_csv(out_dir / "unmatched_invoices.csv", result.unmatched_invoices)

    total_docs = len(result.matched_documents) + len(result.unmatched_documents)
    total_inv = len(result.matched_invoices) + len(result.unmatched_invoices)
    print()
    print("=== Dry-run summary ===")
    print(
        f"contract documents: {len(result.matched_documents)}/{total_docs}"
        f" matched ({(len(result.matched_documents) / total_docs * 100) if total_docs else 0:.1f}%)"
    )
    print(
        f"invoices:           {len(result.matched_invoices)}/{total_inv}"
        f" matched ({(len(result.matched_invoices) / total_inv * 100) if total_inv else 0:.1f}%)"
    )
    print(f"reports written to {out_dir}")


if __name__ == "__main__":
    main()
