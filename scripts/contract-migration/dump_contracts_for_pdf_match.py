#!/usr/bin/env python3
"""
Dump contract / milestone tables from the staging Aurora cluster through an
SSM bastion, into local CSV files used by the dry-run PDF migration scan.

The bastion does not have outbound DB access from the developer machine, so
the export goes:

    bastion  -psql COPY-> /tmp/file.csv  -aws s3 cp-> S3  -aws s3 cp-> local

A temporary inline IAM policy is attached to the bastion role for the
duration of the run granting `secretsmanager:GetSecretValue` and
`s3:PutObject` to the workspace bucket key prefix used here.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def run_aws(args: list[str], *, profile: str, region: str, capture: bool = True) -> str:
    cmd = ["aws", *args, "--profile", profile, "--region", region]
    proc = subprocess.run(cmd, text=True, capture_output=capture)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.strip() or proc.stdout.strip())
    return proc.stdout if capture else ""


# Each entry: (table label, output csv basename, SELECT SQL).
# The SELECT is embedded into a `\copy (<select>) TO '<file>' WITH CSV HEADER`
# command on the bastion, so do not wrap it in COPY/parentheses here.
DUMP_QUERIES: list[tuple[str, str, str]] = [
    (
        "contracts",
        "contracts.csv",
        """SELECT
            c.contract_id,
            COALESCE(c.contract_title, '')        AS contract_title,
            COALESCE(e.entity_name, '')           AS counterparty_name,
            COALESCE(c.service_type, '')          AS service_type,
            COALESCE(c.service_subtype, '')       AS service_subtype,
            COALESCE(c.contract_kind, 'standard') AS contract_kind,
            COALESCE(c.contract_date, '')         AS contract_date,
            COALESCE(c.started_at, '')            AS started_at,
            COALESCE(c.ended_at, '')              AS ended_at
        FROM contracts c
        LEFT JOIN legal_entities e ON e.entity_id = c.counterparty_entity_id
        ORDER BY c.contract_id""",
    ),
    (
        "milestones",
        "milestones.csv",
        """SELECT
            m.milestone_id,
            m.contract_id,
            COALESCE(m.stage_label, '')          AS stage_label,
            m.stage_order,
            COALESCE(m.amount, 0)                AS amount,
            COALESCE(m.invoice_issued_at, '')    AS invoice_issued_at,
            COALESCE(m.payment_collected_at, '') AS payment_collected_at,
            COALESCE(m.invoice_issued, 0)        AS invoice_issued,
            COALESCE(m.payment_collected, 0)     AS payment_collected
        FROM contract_payment_milestones m
        ORDER BY m.contract_id, m.stage_order""",
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Dump contracts/milestones via SSM bastion")
    parser.add_argument("--profile", default="mcm-kesi-staging")
    parser.add_argument("--region", default="ap-northeast-2")
    parser.add_argument("--instance-id", default="i-0a711910c7ba59753")
    parser.add_argument("--bastion-role", default="mcm-ieps-staging-bastion")
    parser.add_argument("--secret-id", default="mcm-ieps-staging/app")
    parser.add_argument("--s3-bucket", default="mcm-ieps-staging-data")
    parser.add_argument("--s3-prefix", default="tmp/contract-dump")
    parser.add_argument("--out-dir", default="scripts/contract-migration/_dump")
    parser.add_argument(
        "--policy-name", default="McmTemporaryReadAppSecretForContractDump"
    )
    parser.add_argument("--keep-policy", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = int(time.time())
    s3_prefix = f"{args.s3_prefix}/{timestamp}"

    policy_doc = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "secretsmanager:GetSecretValue",
                "Resource": "*",
            },
            {
                "Effect": "Allow",
                "Action": ["s3:PutObject", "s3:DeleteObject"],
                "Resource": f"arn:aws:s3:::{args.s3_bucket}/{s3_prefix}/*",
            },
        ],
    }

    print("Attaching temporary policy to bastion role...")
    run_aws(
        [
            "iam",
            "put-role-policy",
            "--role-name",
            args.bastion_role,
            "--policy-name",
            args.policy_name,
            "--policy-document",
            json.dumps(policy_doc),
        ],
        profile=args.profile,
        region=args.region,
    )
    # Allow IAM eventual consistency to settle.
    time.sleep(15)

    try:
        copy_lines = []
        for label, fname, sql in DUMP_QUERIES:
            tmp_path = f"/tmp/contract-dump-{label}.csv"
            s3_uri = f"s3://{args.s3_bucket}/{s3_prefix}/{fname}"
            sql_one_line = " ".join(sql.split())
            copy_lines.append(
                f"echo '== {label} =='\n"
                f"psql \"$DB_URL\" -v ON_ERROR_STOP=1 -c \"\\copy ({sql_one_line}) TO '{tmp_path}' WITH CSV HEADER\"\n"
                f"aws s3 cp {tmp_path} {s3_uri} --region {args.region}\n"
                f"rm -f {tmp_path}"
            )

        copy_block = "\n".join(copy_lines)
        remote_script = f"""set -euo pipefail
if ! command -v psql >/dev/null 2>&1; then
  dnf -y install postgresql15 >/tmp/mcm-psql-install.log 2>&1 \\
    || dnf -y install postgresql >/tmp/mcm-psql-install.log 2>&1
fi
SECRET_JSON=$(aws secretsmanager get-secret-value --region {args.region} --secret-id {args.secret_id} --query SecretString --output text)
export SECRET_JSON
DB_URL=$(python3 - <<'PY'
import json
import os
secret = json.loads(os.environ["SECRET_JSON"])
url = secret["DATABASE_URL"].replace("sslmode=no-verify", "sslmode=require")
print(url)
PY
)
export DB_URL
{copy_block}
"""

        print("Sending COPY commands to bastion via SSM...")
        out = run_aws(
            [
                "ssm",
                "send-command",
                "--instance-ids",
                args.instance_id,
                "--document-name",
                "AWS-RunShellScript",
                "--parameters",
                json.dumps({"commands": remote_script.splitlines()}),
                "--query",
                "Command.CommandId",
                "--output",
                "text",
            ],
            profile=args.profile,
            region=args.region,
        )
        command_id = out.strip()
        print(f"CommandId: {command_id}")

        status = "Pending"
        invocation: dict[str, str] = {}
        while status in {"Pending", "InProgress", "Delayed"}:
            time.sleep(5)
            raw = run_aws(
                [
                    "ssm",
                    "get-command-invocation",
                    "--command-id",
                    command_id,
                    "--instance-id",
                    args.instance_id,
                    "--output",
                    "json",
                ],
                profile=args.profile,
                region=args.region,
            )
            invocation = json.loads(raw)
            status = invocation["Status"]
            print(f"Status: {status}")

        if status != "Success":
            print("--- stdout ---")
            print(invocation.get("StandardOutputContent", ""))
            print("--- stderr ---", file=sys.stderr)
            print(invocation.get("StandardErrorContent", ""), file=sys.stderr)
            raise SystemExit(f"SSM command failed with status: {status}")

        print(invocation.get("StandardOutputContent", ""))

        # Pull the CSVs back down to the local out-dir.
        for _, fname, _ in DUMP_QUERIES:
            s3_uri = f"s3://{args.s3_bucket}/{s3_prefix}/{fname}"
            local = out_dir / fname
            print(f"Downloading {s3_uri} -> {local}")
            run_aws(
                ["s3", "cp", s3_uri, str(local)],
                profile=args.profile,
                region=args.region,
                capture=False,
            )
            run_aws(
                ["s3", "rm", s3_uri],
                profile=args.profile,
                region=args.region,
            )

        print("Dump complete.")
    finally:
        if not args.keep_policy:
            print("Removing temporary policy...")
            run_aws(
                [
                    "iam",
                    "delete-role-policy",
                    "--role-name",
                    args.bastion_role,
                    "--policy-name",
                    args.policy_name,
                ],
                profile=args.profile,
                region=args.region,
            )


if __name__ == "__main__":
    main()
