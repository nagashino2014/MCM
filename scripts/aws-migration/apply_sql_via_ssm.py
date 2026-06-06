#!/usr/bin/env python3
"""
Apply a PostgreSQL SQL file from a private VPC bastion via AWS SSM send-command.

The local machine does not need direct network access to Aurora. The script:
1. Temporarily grants the bastion role read access to the app secret.
2. Sends a shell script to the bastion through SSM.
3. Installs psql if needed, reads DATABASE_URL from Secrets Manager, applies SQL.
4. Removes the temporary inline IAM policy unless --keep-policy is specified.
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import time
from pathlib import Path


def run_aws(args: list[str], *, profile: str, region: str) -> str:
    cmd = ["aws", *args, "--profile", profile, "--region", region]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.strip() or proc.stdout.strip())
    return proc.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply SQL to private Aurora through SSM bastion.")
    parser.add_argument("--profile", default="mcm-kesi-staging")
    parser.add_argument("--region", default="ap-northeast-2")
    parser.add_argument("--instance-id", required=True)
    parser.add_argument("--bastion-role", required=True)
    parser.add_argument("--secret-id", required=True)
    parser.add_argument("--db-secret-id", help="Optional RDS managed secret containing username/password")
    parser.add_argument("--db-host", help="Database host used with --db-secret-id")
    parser.add_argument("--db-name", default="mcm", help="Database name used with --db-secret-id")
    parser.add_argument("--db-port", default="5432", help="Database port used with --db-secret-id")
    parser.add_argument("--sql", required=True)
    parser.add_argument("--s3-bucket", help="Optional temporary S3 bucket for large SQL files")
    parser.add_argument("--s3-key", help="Temporary S3 key. Defaults to tmp/sql-migrations/<filename>")
    parser.add_argument("--policy-name", default="McmTemporaryReadAppSecretForSqlMigration")
    parser.add_argument("--keep-policy", action="store_true")
    args = parser.parse_args()

    sql_path = Path(args.sql)
    sql_text = sql_path.read_text(encoding="utf-8")
    sql_b64 = base64.b64encode(sql_text.encode("utf-8")).decode("ascii")
    s3_key = args.s3_key or f"tmp/sql-migrations/{int(time.time())}-{sql_path.name}"
    use_s3 = bool(args.s3_bucket) or len(sql_b64) > 20000
    if use_s3 and not args.s3_bucket:
        raise SystemExit("--s3-bucket is required for large SQL files")

    policy_doc = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "secretsmanager:GetSecretValue",
                "Resource": "*",
            },
            *(
                [
                    {
                        "Effect": "Allow",
                        "Action": "s3:GetObject",
                        "Resource": f"arn:aws:s3:::{args.s3_bucket}/{s3_key}",
                    }
                ]
                if use_s3
                else []
            ),
        ],
    }

    if use_s3:
        print(f"Uploading SQL to s3://{args.s3_bucket}/{s3_key}...")
        run_aws(
            ["s3", "cp", str(sql_path), f"s3://{args.s3_bucket}/{s3_key}"],
            profile=args.profile,
            region=args.region,
        )

    print("Attaching temporary secret-read policy to bastion role...")
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
    # IAM inline policy propagation is eventually consistent. Without a short
    # wait the SSM command can start before the bastion role can read the secret.
    time.sleep(15)

    if use_s3:
        sql_fetch_commands = f"""aws s3 cp s3://{args.s3_bucket}/{s3_key} /tmp/mcm-contract-management.sql --region {args.region}"""
    else:
        sql_fetch_commands = f"""cat >/tmp/mcm-contract-management.sql.b64 <<'B64'
{sql_b64}
B64
base64 -d /tmp/mcm-contract-management.sql.b64 >/tmp/mcm-contract-management.sql"""

    remote_script = f"""set -euo pipefail
if ! command -v psql >/dev/null 2>&1; then
  dnf -y install postgresql15 >/tmp/mcm-psql-install.log 2>&1 || dnf -y install postgresql >/tmp/mcm-psql-install.log 2>&1
fi
{sql_fetch_commands}
SECRET_JSON=$(aws secretsmanager get-secret-value --region {args.region} --secret-id {args.secret_id} --query SecretString --output text)
export SECRET_JSON
DB_SECRET_ID={json.dumps(args.db_secret_id or "")}
DB_HOST={json.dumps(args.db_host or "")}
DB_NAME={json.dumps(args.db_name)}
DB_PORT={json.dumps(args.db_port)}
export DB_SECRET_ID DB_HOST DB_NAME DB_PORT
DB_URL=$(python3 - <<'PY'
import json
import os
from urllib.parse import quote

secret = json.loads(os.environ["SECRET_JSON"])
db_secret_id = os.environ.get("DB_SECRET_ID", "")
if db_secret_id:
    import subprocess

    raw = subprocess.check_output([
        "aws",
        "secretsmanager",
        "get-secret-value",
        "--region",
        "{args.region}",
        "--secret-id",
        db_secret_id,
        "--query",
        "SecretString",
        "--output",
        "text",
    ], text=True)
    db_secret = json.loads(raw)
    host = os.environ["DB_HOST"]
    database = os.environ["DB_NAME"]
    port = os.environ["DB_PORT"]
    url = "postgresql://{{}}:{{}}@{{}}:{{}}/{{}}?sslmode=require".format(
        quote(db_secret["username"], safe=""),
        quote(db_secret["password"], safe=""),
        host,
        port,
        database,
    )
else:
    url = secret["DATABASE_URL"].replace("sslmode=no-verify", "sslmode=require")
print(url)
PY
)
psql "$DB_URL" -v ON_ERROR_STOP=1 -f /tmp/mcm-contract-management.sql
rm -f /tmp/mcm-contract-management.sql /tmp/mcm-contract-management.sql.b64
"""

    print("Sending SQL apply command through SSM...")
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

    stdout = invocation.get("StandardOutputContent", "")
    stderr = invocation.get("StandardErrorContent", "")
    if stdout:
        print("--- stdout ---")
        print(stdout)
    if stderr:
        print("--- stderr ---", file=sys.stderr)
        print(stderr, file=sys.stderr)

    if not args.keep_policy:
        print("Removing temporary secret-read policy...")
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
    if use_s3:
        print(f"Removing temporary SQL object s3://{args.s3_bucket}/{s3_key}...")
        run_aws(
            ["s3", "rm", f"s3://{args.s3_bucket}/{s3_key}"],
            profile=args.profile,
            region=args.region,
        )

    if status != "Success":
        raise SystemExit(f"SSM command failed with status: {status}")


if __name__ == "__main__":
    main()
