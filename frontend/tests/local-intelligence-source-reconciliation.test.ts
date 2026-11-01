import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { invalidateImportedSignals, readImportedSignalStates } from "../scripts/local-intelligence-source-reconciliation";
import { localIntelligenceMode, localIntelligenceSourceUrl } from "../scripts/local-intelligence-environment.mjs";

test("실제 모드 오타와 직접 원격 DB 주소를 거부한다", () => {
  assert.equal(localIntelligenceMode("real"), "real"); assert.equal(localIntelligenceMode("demo"), "demo");
  assert.throws(() => localIntelligenceMode("rael"));
  for (const value of ["postgresql://u:p@db.example.com:15432/mcm", "postgresql://u:p@127.0.0.1:5432/mcm", "postgresql://u:p@127.0.0.1:15432/intel_live", "postgresql://u:p@127.0.0.1:15432/mcm?options=-canything"]) assert.throws(() => localIntelligenceSourceUrl(value));
  assert.equal(localIntelligenceSourceUrl("postgresql://fixture:fixture@127.0.0.1:15432/mcm").port, "15432");
});

test("격리된 로컬 PG: 제외·중복·삭제를 반영하며 기간/limit 밖 정상 자료와 수동 자료는 유지한다", { skip: !process.env.OFFICIAL_SOURCES_TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.OFFICIAL_SOURCES_TEST_DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55439"); assert.equal(url.pathname, "/intel_sources_test");
  const schema = `source_reconcile_${Date.now()}`, sourceSchema = `${schema}_origin`;
  const admin = new Client({ connectionString: url.toString(), ssl: false }); await admin.connect();
  const source = new Client({ connectionString: url.toString(), ssl: false }), destination = new Client({ connectionString: url.toString(), ssl: false });
  try {
    await admin.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${sourceSchema}`);
    await source.connect(); await source.query(`SET search_path TO ${sourceSchema}`);
    await destination.connect(); await destination.query(`SET search_path TO ${schema}`);
    await source.query("CREATE TABLE intel_signals(signal_id text PRIMARY KEY,source text,signal_grade text,status text,duplicate_of text,deleted_at text,disclosed_at text)");
    await source.query("INSERT INTO intel_signals VALUES ('current','news','candidate','new',NULL,NULL,'2026-10-30'),('outside_limit','news','confirmed','new',NULL,NULL,'1990-01-01'),('excluded','news','excluded','new',NULL,NULL,'2026-10-30'),('dismissed','news','candidate','dismissed',NULL,NULL,'2026-10-30'),('duplicate','news','candidate','new','current',NULL,'2026-10-30'),('deleted','news','candidate','new',NULL,'2026-10-30','2026-10-30'),('changed_source','unapproved','candidate','new',NULL,NULL,'2026-10-30')");
    const ids = ["current", "outside_limit", "excluded", "dismissed", "duplicate", "deleted", "changed_source", "missing"];
    const origins = ids.map(sourceSignalId => ({ sourceSignalId, targetSignalId: `local_${sourceSignalId}` }));
    await destination.query("CREATE TABLE intel_signals(signal_id text PRIMARY KEY,signal_grade text,status text,raw_json jsonb,updated_at text); CREATE TABLE local_intelligence_signal_origins(source_signal_id text PRIMARY KEY,target_signal_id text,content_hash text)");
    for (const origin of origins) {
      await destination.query("INSERT INTO intel_signals VALUES($1,'candidate','new',$2::jsonb,'old')", [origin.targetSignalId, JSON.stringify({ channel: "test", localImport: { sourceSignalId: origin.sourceSignalId } })]);
      await destination.query("INSERT INTO local_intelligence_signal_origins VALUES($1,$2,'original-hash')", [origin.sourceSignalId, origin.targetSignalId]);
    }
    await destination.query("INSERT INTO intel_signals VALUES('manual','candidate','new','{}','old')");
    await source.query("BEGIN READ ONLY");
    const states = await readImportedSignalStates(source, origins, ["news"]);
    await source.query("COMMIT");
    assert.equal(states.find(s=>s.sourceSignalId==="outside_limit")?.availability, "available");
    assert.equal(states.find(s=>s.sourceSignalId==="missing")?.availability, "missing");
    assert.equal(states.find(s=>s.sourceSignalId==="duplicate")?.duplicateOf, "current");
    assert.equal(await invalidateImportedSignals(destination, states, "2026-10-30T00:00:00Z"), 6);
    assert.equal(await invalidateImportedSignals(destination, states, "2026-10-30T00:01:00Z"), 0);
    const records = (await destination.query("SELECT * FROM intel_signals ORDER BY signal_id")).rows as Array<{ signal_id: string; status: string; signal_grade: string; raw_json: { channel: string; localImport: { sourceSignalId: string } } }>;
    for (const id of ["local_current", "local_outside_limit", "manual"]) assert.equal(records.find(r=>r.signal_id===id)?.status, "new");
    for (const id of ["excluded", "dismissed", "duplicate", "deleted", "changed_source", "missing"]) {
      const row = records.find(r=>r.signal_id===`local_${id}`)!;
      assert.equal(row.status, "dismissed"); assert.equal(row.signal_grade, "excluded"); assert.equal(row.raw_json.localImport.sourceSignalId, id); assert.equal(row.raw_json.channel, "test");
    }
    const restoredHash = (await destination.query("SELECT content_hash FROM local_intelligence_signal_origins WHERE source_signal_id='missing'")).rows[0].content_hash;
    assert.equal(restoredHash, "source-invalid:missing");
  } finally {
    await source.end(); await destination.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${sourceSchema} CASCADE`); await admin.end();
  }
});
