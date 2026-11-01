import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

/** 로컬 실증의 기존 자료를 보존하면서 메신저/공유 테이블만 멱등 추가한다. */
export async function initializeLocalIntelligenceSharing(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.port !== "55439" || !["/intel_demo", "/intel_live"].includes(url.pathname) || decodeURIComponent(url.username) !== "mcm_intel_test" || url.search || url.hash) throw new Error("공유 실증 스키마는 로컬 55439의 intel_demo/intel_live에서만 추가할 수 있습니다.");
  const db = new Client({ connectionString: url.toString(), ssl: false });
  try {
    await db.connect();
    const current = (await db.query("SELECT current_database() AS name,host(inet_server_addr()) AS address")).rows[0];
    if (current.name !== url.pathname.slice(1) || !["127.0.0.1", "::1"].includes(current.address)) throw new Error("연결된 DB가 로컬 실증 대상과 일치하지 않습니다.");
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext('local-intelligence-sharing-schema'))");
    for (const name of ["102_mail_categories_spam.sql", "145_chat_core.sql", "323_briefing_share_deliveries.sql"]) await db.query(await readFile(resolve("../infra/aws", name), "utf8"));
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
  finally { await db.end(); }
}
