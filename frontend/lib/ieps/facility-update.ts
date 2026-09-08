import { FIELDS, diagnose, identifier, normalizeInput, type Field, type Snapshot } from "@scraper/lib/facility-quality/rules";
import { rows, type Database, type Transaction } from "@scraper/lib/facility-quality/store";
import { extractRegion } from "@scraper/lib/ieps/region";

type Candidate = { candidate_id: string; facility_id: string; field: Field; old_value: string | null; value: string; source: string; source_url: string | null;
  evidence: unknown; snapshot: Snapshot; status: string; match_level: string; before_state: Record<string, unknown>; after_state: Record<string, unknown> };
const ADDRESS_KEYS = ["site_address", "site_address_verbatim", "normalized_address", "region_sido", "region_sigungu", "additional_site_addresses"];
const IDENTITY_KEYS = ["company_name", "business_registration_no", "site_business_registration_no", "corporate_registration_no", "business_certificate_corporate_registration_no"];
const keysFor = (f: Field) => f === "site_address" ? ADDRESS_KEYS : [f];
const pick = (s: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map(k => [k, s[k] ?? null]));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameIdentity = (key: string, a: unknown, b: unknown) => key.endsWith("registration_no") && identifier(a) && identifier(b) ? identifier(a) === identifier(b) : same(a,b);
export async function markReviewedWrite(db: Database) { await db.run("SELECT set_config('mcm.facility_write','reviewed',true)"); }

async function writeFields(db: Database, id: string, values: Record<string, unknown>) {
  const allowed = new Set<string>([...FIELDS, ...ADDRESS_KEYS]);
  const entries = Object.entries(values).filter(([k]) => allowed.has(k));
  if (!entries.length) return;
  await db.run(`UPDATE facilities SET ${entries.map(([k], i) => `${k}=$${i + 1}`).join(",")},updated_at=$${entries.length + 1} WHERE facility_id=$${entries.length + 2}`,
    [...entries.map(([, v]) => v), new Date().toISOString(), id]);
}
async function protection(db: Database, id: string, field: Field) {
  return (await rows(db, "SELECT updated_at::text AS version FROM facility_master_field_state WHERE facility_id=$1 AND field=$2", [id, field]))[0]?.version ?? null;
}
async function auditChange(db: Database, actor: string, c: Candidate, action: string, before: unknown, after: unknown) {
  await db.run("INSERT INTO audit_log(actor_user_id,action,target_table,target_id,before_json,after_json,created_at) VALUES($1,$2,'facilities',$3,$4::jsonb,$5::jsonb,$6)",
    [actor, action, c.facility_id, JSON.stringify(before), JSON.stringify({ candidateId: c.candidate_id, source: c.source, url: c.source_url, evidence: c.evidence, values: after }), new Date().toISOString()]);
}
/** 사업장별 잠금·원본 대조·선택 반영. 클라이언트 값으로 UPDATE하지 않는다. */
export async function reviewCandidates(tx: Transaction, ids: string[], actor: string, action: "apply" | "reject" | "revert") {
  const results: { id: string; status: string; reason?: string }[] = [];
  // 항상 사업장 → 후보 순서로 잠가 서로 다른 요청의 교착을 피한다.
  const found = await tx(db => rows<Candidate>(db, "SELECT * FROM facility_enrichment_candidates WHERE candidate_id=ANY($1::text[]) ORDER BY facility_id,candidate_id", [ids]));
  for (const id of ids) if (!found.some(c => c.candidate_id === id)) results.push({ id, status: "not_found" });
  for (const facilityId of [...new Set(found.map(c => c.facility_id))]) {
    const groupIds = found.filter(c => c.facility_id === facilityId).map(c => c.candidate_id);
    results.push(...await tx(async db => {
      const row = (await rows<{ snapshot: Snapshot }>(db, "SELECT facility_quality_snapshot(f) AS snapshot FROM facilities f WHERE facility_id=$1 AND deleted_at IS NULL FOR UPDATE", [facilityId]))[0];
      const group = await rows<Candidate>(db, "SELECT * FROM facility_enrichment_candidates WHERE candidate_id=ANY($1::text[]) ORDER BY candidate_id FOR UPDATE", [groupIds]);
      const out: typeof results = [];
      await markReviewedWrite(db);
      const repeated = new Set(group.filter(c => group.filter(x => x.field === c.field && (action === "revert" ? x.status === "applied" : x.status === "pending")).length > 1).map(c => c.field));
      // 원본 비교는 이 묶음의 변경 전에 수행한다. 동일 사업장의 여러 항목을 함께 반영할 수 있다.
      const eligible: Candidate[] = [];
      for (const c of group) {
        const expected = action === "revert" ? "applied" : "pending";
        if (c.status !== expected) { out.push({ id: c.candidate_id, status: c.status }); continue; }
        if (action === "reject") {
          await db.run("UPDATE facility_enrichment_candidates SET status='rejected',reviewed_by=$2,reviewed_at=now() WHERE candidate_id=$1", [c.candidate_id, actor]);
          await auditChange(db, actor, c, "facility_enrich_reject", c.old_value, c.value);
          out.push({ id: c.candidate_id, status: "rejected" }); continue;
        }
        if (!row || repeated.has(c.field)) { out.push({ id: c.candidate_id, status: "conflict", reason: "삭제된 사업장 또는 한 항목의 복수 후보 선택" }); continue; }
        if (!FIELDS.includes(c.field) || c.match_level === "blocked" || (c.source === "bizno" && c.field === "representative_name")) {
          out.push({ id: c.candidate_id, status: "blocked", reason: "업체 식별 충돌 또는 허용되지 않은 항목" }); continue;
        }
        const compareKeys = action === "revert" ? keysFor(c.field) : [...new Set([...IDENTITY_KEYS, ...keysFor(c.field)])];
        const original = action === "revert" ? c.after_state : c.snapshot;
        const stale = !original || compareKeys.some(k => action !== "revert" && !keysFor(c.field).includes(k)
          ? !sameIdentity(k,row.snapshot[k],original[k]) : !same(row.snapshot[k], original[k])) ||
          (action === "revert" && !same(await protection(db, facilityId, c.field), original._version));
        if (stale) {
          // 복원 충돌은 applied 상태를 유지한다. 이후 검토 이력을 잃지 않는다.
          if (action !== "revert") await db.run("UPDATE facility_enrichment_candidates SET status='stale_conflict',reviewed_by=$2,reviewed_at=now() WHERE candidate_id=$1", [c.candidate_id, actor]);
          out.push({ id: c.candidate_id, status: "stale_conflict", reason: "후보 생성/반영 이후 원본이 수정되었습니다" }); continue;
        }
        if (action === "apply" && !["valid", "format"].includes(diagnose(c.field, c.value).status)) {
          out.push({ id: c.candidate_id, status: "invalid", reason: "후보 값이 현재 검증 규칙에 맞지 않습니다" }); continue;
        }
        eligible.push(c);
      }
      for (const c of eligible) {
        const before = pick(row!.snapshot, keysFor(c.field));
        let after: Record<string, unknown>;
        if (action === "revert") after = pick(c.before_state, keysFor(c.field));
        else {
          const value = normalizeInput(c.field, c.value);
          after = { [c.field]: value };
          if (c.field === "site_address") {
            const region = extractRegion(value);
            after = { ...before, site_address: value, site_address_verbatim: true, normalized_address: value, region_sido: region.sido, region_sigungu: region.sigungu };
          }
        }
        await writeFields(db, facilityId, after);
        after._version = await protection(db, facilityId, c.field);
        const status = action === "revert" ? "reverted" : "applied";
        await db.run(`UPDATE facility_enrichment_candidates SET status=$2,reviewed_by=$3,reviewed_at=now(),
          before_state=CASE WHEN $2='applied' THEN $4::jsonb ELSE before_state END,
          after_state=CASE WHEN $2='applied' THEN $5::jsonb ELSE after_state END WHERE candidate_id=$1`, [c.candidate_id, status, actor, JSON.stringify(before), JSON.stringify(after)]);
        await auditChange(db, actor, c, action === "revert" ? "facility_enrich_revert" : "facility_enrich_apply", before, after);
        out.push({ id: c.candidate_id, status });
      }
      return out;
    }));
  }
  return { results, applied: results.filter(r => r.status === "applied").length };
}
