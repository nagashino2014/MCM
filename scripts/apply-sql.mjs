// apply-sql.mjs — 멱등 SQL 마이그레이션을 DATABASE_URL 로 적용한다.
//   node scripts/apply-sql.mjs infra/aws/196_shop_receipts.sql
// pg 드라이버는 frontend 의 것을 그대로 쓴다(별도 설치 불필요).

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const require = createRequire(path.join(repo, "frontend", "package.json"));
const { Client } = require("pg");

const file = process.argv[2];
if (!file) {
  console.error("사용법: node scripts/apply-sql.mjs <파일.sql>");
  process.exit(1);
}

const target = path.resolve(repo, file);
if (!fs.existsSync(target)) {
  console.error(`파일이 없습니다: ${target}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL 이 없습니다. scripts/apply-sql.ps1 로 실행하면 자동으로 채워집니다.");
  process.exit(1);
}

const sql = fs.readFileSync(target, "utf-8");
// SSL 설정은 앱(frontend/lib/db.ts)과 같은 규칙을 따른다 — PGSSL=disable 이면 끈다.
const client = new Client({
  connectionString: url,
  ssl:
    process.env.PGSSL === "disable"
      ? false
      : { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" },
});

try {
  await client.connect();
  await client.query(sql);
  console.log(`적용 완료: ${path.relative(repo, target)}`);
} catch (err) {
  console.error(`적용 실패: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
