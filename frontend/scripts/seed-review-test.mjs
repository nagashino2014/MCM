/**
 * 라운드 2A 검증 시나리오 6 용: parsed_fields 테스트 데이터 삽입.
 * - facility / permit / attachment / parsed_fields 미니멀 lineage 를 만들고
 *   needs_review=1 인 row 1건을 insert.
 * - 실행: node scripts/seed-review-test.mjs
 */

import path from "node:path";
import fs from "node:fs";
import initSqlJs from "sql.js";

const dbPath = process.env.IEPS_DB_PATH
  ? path.resolve(process.env.IEPS_DB_PATH)
  : path.resolve(process.cwd(), "..", "data", "ieps", "db.sqlite");

const SQL = await initSqlJs({
  locateFile: (file) =>
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
});

const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

const now = new Date().toISOString();
const facilityId = "fac_seedtest_" + Date.now().toString(36);
const permitId = "pmt_seedtest_" + Date.now().toString(36);
const attachmentId = "att_seedtest_" + Date.now().toString(36);
const docId = "doc_seedtest_" + Date.now().toString(36);

// upsert minimal facility
db.run(
  `INSERT OR IGNORE INTO facilities
   (facility_id, company_name, normalized_company_name, source, created_at, updated_at)
   VALUES (?, '시드테스트사업장', 'seedtestfacility', 'ieps', ?, ?)`,
  [facilityId, now, now]
);

// minimal permit
db.run(
  `INSERT OR IGNORE INTO permits
   (permit_id, facility_id, decision_no, source_attachment_id, created_at, updated_at)
   VALUES (?, ?, '제 9999-99호', ?, ?, ?)`,
  [permitId, facilityId, attachmentId, now, now]
);

// attachment row (스키마 — 사용 컬럼만 채움)
try {
  db.run(
    `INSERT OR IGNORE INTO attachments
     (file_id, doc_id, file_name, file_type, status, created_at)
     VALUES (?, ?, '검토결과서_seed.pdf', 'pdf', 'downloaded', ?)`,
    [attachmentId, docId, now]
  );
} catch (err) {
  console.warn("[seed] attachments insert skipped: " + err.message);
}

// parsed_field — 검수 대기열용 (rule_id=site_address — sync 시 facilities 가 갱신됨)
db.run(
  `INSERT INTO parsed_fields
   (attachment_id, doc_id, rule_id, field_label, raw_value, normalized_value, source_page, source_text, confidence, needs_review, created_at)
   VALUES (?, ?, 'site_address', '소재지', '경기도 화성시 동탄대로 100', '경기도 화성시 동탄대로 100', 3, '...', 0.5, 1, ?)`,
  [attachmentId, docId, now]
);

const r = db.exec("SELECT last_insert_rowid()");
const insertedId = r.length ? Number(r[0].values[0][0]) : null;

const data = db.export();
fs.writeFileSync(dbPath, Buffer.from(data));
console.log(JSON.stringify({
  facilityId,
  permitId,
  attachmentId,
  parsedFieldId: insertedId,
}));
db.close();
