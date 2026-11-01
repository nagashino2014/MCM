// 공개 수집 자료의 원본→로컬 대응만 읽는다. 원본 DB는 세션 전체 읽기 전용이다.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "pg";
import { loadLocalIntelligenceEnvironment } from "./local-intelligence-environment.mjs";

const env = await loadLocalIntelligenceEnvironment();
const local = new Client({ connectionString: "postgresql://mcm_intel_test@127.0.0.1:55439/intel_live", ssl: false, options: "-c default_transaction_read_only=on" });
const source = new Client({ connectionString: env.sourceDatabaseUrl, ssl: env.sourceSsl === "disable" ? false : { rejectUnauthorized: false }, options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 15000, statement_timeout: 30000 });
try {
  await Promise.all([local.connect(), source.connect()]);
  for (const db of [local, source]) assert.equal((await db.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only, "on");
  const rows = (await local.query("SELECT s.signal_id,s.report_name,s.summary,s.url,s.disclosed_at,s.source,s.company_name,s.signal_grade,s.signal_type,o.source_signal_id FROM intel_signals s JOIN local_intelligence_signal_origins o ON o.target_signal_id=s.signal_id WHERE s.company_name='SK하이닉스' AND s.source='news' ORDER BY s.disclosed_at DESC,s.signal_id")).rows;
  const originals = (await source.query("SELECT signal_id,report_name,summary,url,disclosed_at,source,company_name,raw_json,created_at,updated_at FROM intel_signals WHERE signal_id=ANY($1::text[])", [rows.map(row => row.source_signal_id)])).rows;
  const byId = new Map(originals.map(row => [row.signal_id, row]));
  const records = rows.map(row => {
    const original = byId.get(row.source_signal_id);
    let raw = original?.raw_json; if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
    const rawPublic = Object.fromEntries(Object.entries(raw ?? {}).filter(([key]) => /^(title|description|content|body|summary|link|originallink|pubDate|query|channel|analysis|classification|llm|article|sourceId|index)$/i.test(key)));
    return { local: row, original: original ? { ...original, raw_json: undefined, rawKeys: Object.keys(raw ?? {}), rawPublic } : null, matchesOriginal: !!original && row.report_name === original.report_name && row.summary === original.summary && row.url === original.url };
  });
  const directory = ".next/local-intelligence-demo/source-quality";
  await mkdir(directory, { recursive: true });
  const report = { capturedAt: new Date().toISOString(), readOnly: true, count: records.length, importMismatches: records.filter(row => !row.matchesOriginal).length, records };
  await writeFile(`${directory}/audit-before.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ count: report.count, importMismatches: report.importMismatches, records: records.filter(row => /인텔|미국 생산|양산공장|100조/.test(row.local.report_name)).slice(0, 7).map(row => ({ ...row.local, rawKeys: row.original?.rawKeys, raw: row.original?.rawPublic })) }, null, 2));
} finally { await Promise.allSettled([source.end(), local.end()]); }
