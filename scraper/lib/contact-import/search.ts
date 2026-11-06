import { chromium, type Browser } from "playwright";
import { rows, type Database, type Transaction } from "../facility-quality/store";
import type { Profile, Snapshot } from "../facility-quality/rules";
import { bizno, naver, type Outcome } from "../facility-enrichment/browser";
import { dart, fsc, ProviderError } from "../facility-enrichment/public-api";
import { createSourceGuard } from "../facility-enrichment/source-guard";
import { judgeProfiles, type MatchCandidate } from "./rules";

// 공개 API 를 먼저 쓴다. 비즈노는 하루 한도가 작아 앞선 정보원에서 못 찾은 회사만 간다.
export const SEARCH_SOURCES = ["dart", "fsc", "naver", "bizno"] as const;
type Source = typeof SEARCH_SOURCES[number];
const STOP = new Set<Outcome["status"]>(["blocked", "quota", "not_configured"]);
const RETRYABLE = new Set<Outcome["status"]>(["timeout", "error", "parse_error"]);

interface CompanyRow {
  company_id: string; display_name: string; address: string | null; homepage_url: string | null;
  email_domain: string | null; match_candidates: MatchCandidate[]; search_outcomes: Record<string, { status: string; note?: string }>;
}
export type SearchProviders = Partial<Record<Source, (snapshot: Snapshot) => Promise<Outcome>>>;

/** 외부에는 회사명만 보낸다. 담당자 이름·번호는 조회에 쓰지 않는다. */
function snapshotOf(c: CompanyRow): Snapshot {
  return {
    facility_id: c.company_id, company_name: c.display_name, business_registration_no: null, site_business_registration_no: null,
    phone_number: null, representative_name: null, corporate_registration_no: null, business_certificate_corporate_registration_no: null,
    site_address: c.address,
  };
}

/**
 * 대기 중인 회사의 사업자번호를 찾는다. 회사마다 정보원을 차례로 돌리다 추천 판정이 나오면 멈춘다.
 * 한도·차단으로 멈춘 회사는 paused 로 남겨 다음 실행에서 이어 간다.
 */
export async function processContactSearch(db: Database, tx: Transaction, providers: SearchProviders = {}): Promise<{ processed: number; stopped: string[] }> {
  const guard = createSourceGuard(db);
  const stopped = new Map<Source, Outcome["status"]>();
  const failures = new Map<Source, number>();
  let browser: Browser | undefined;
  let processed = 0;
  try {
    while (stopped.size < SEARCH_SOURCES.length) {
      const company = (await rows<CompanyRow>(db, `UPDATE contact_import_companies SET search_status='running',search_lease_until=now()+interval '5 minutes'
        WHERE company_id=(SELECT company_id FROM contact_import_companies
          WHERE decision IS NULL AND (search_status='pending' OR (search_status='running' AND search_lease_until<now()))
          ORDER BY CASE suggested_category WHEN '민간기업' THEN 0 ELSE 1 END, created_at, company_id LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING company_id,display_name,address,homepage_url,email_domain,match_candidates,search_outcomes`))[0];
      if (!company) break;
      const evidence = { name: company.display_name, address: company.address, homepage: company.homepage_url, emailDomain: company.email_domain };
      const snapshot = snapshotOf(company);
      const outcomes = { ...company.search_outcomes };
      const profiles: Profile[] = [];
      let verdict = judgeProfiles(evidence, profiles);
      let unfinished = false;
      let flaky = false;
      for (const source of SEARCH_SOURCES) {
        if (verdict.verdict === "recommend") break;
        if (stopped.has(source)) { unfinished = true; continue; }
        let result: Outcome;
        try {
          const provider = providers[source];
          if (provider) result = await provider(snapshot);
          else if (source === "dart") result = await dart(snapshot, () => guard.budget(source));
          else if (source === "fsc") result = await fsc(snapshot, () => guard.budget(source));
          else {
            browser ??= await chromium.launch({ headless: true });
            result = await (source === "naver" ? naver : bizno)(browser, snapshot, guard.navigate);
          }
        } catch (error) {
          result = { status: error instanceof ProviderError ? error.status : (error as Error).name === "TimeoutError" ? "timeout" : "error", profiles: [], note: error instanceof ProviderError ? error.message : "연결·조회 실패" };
        }
        if (STOP.has(result.status)) { stopped.set(source, result.status); unfinished = true; }
        failures.set(source, RETRYABLE.has(result.status) ? (failures.get(source) ?? 0) + 1 : 0);
        if ((failures.get(source) ?? 0) >= 3) stopped.set(source, result.status);
        if (RETRYABLE.has(result.status)) flaky = true;
        outcomes[source] = { status: result.status, ...(result.note ? { note: result.note } : {}) };
        profiles.push(...result.profiles);
        verdict = judgeProfiles(evidence, profiles);
      }
      const brnMatches = verdict.brn ? await rows<{ facility_id: string; company_name: string; site_address: string | null; business_registration_no: string | null }>(db,
        `SELECT facility_id,company_name,site_address,business_registration_no FROM facilities
          WHERE deleted_at IS NULL AND regexp_replace(COALESCE(business_registration_no,''),'[^0-9]','','g')=$1 LIMIT 15`, [verdict.brn]) : [];
      // 사명이 바뀐 회사는 이름으로 못 찾는다. 번호가 같은 사업장을 앞세운다.
      const known = new Set(brnMatches.map((f) => f.facility_id));
      const matches: MatchCandidate[] = [
        ...brnMatches.map((f) => ({ facilityId: f.facility_id, companyName: f.company_name, address: f.site_address, brn: f.business_registration_no, kind: "brn" as const })),
        ...(company.match_candidates ?? []).filter((m) => !known.has(m.facilityId)),
      ];
      const status = verdict.verdict === "recommend" ? "done" : unfinished ? "paused" : flaky ? "attention" : "done";
      await tx(async (t) => {
        await t.run(`UPDATE contact_import_companies SET search_status=$2,search_lease_until=NULL,search_outcomes=$3::jsonb,search_candidates=$4::jsonb,
          search_verdict=$5,found_brn=$6,found_crn=$7,search_note=$8,match_candidates=$9::jsonb,updated_at=$10 WHERE company_id=$1`,
          [company.company_id, status, JSON.stringify(outcomes), JSON.stringify(verdict.candidates), verdict.verdict, verdict.brn, verdict.crn, verdict.note, JSON.stringify(matches), new Date().toISOString()]);
      });
      processed++;
    }
  } finally {
    await browser?.close();
  }
  return { processed, stopped: [...stopped.keys()] };
}
