import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { auditItem, rows, saveProposals, type Database, type Transaction, type RunOptions } from "../facility-quality/store";
import { identifier, proposals, validBrn, type Profile, type Snapshot } from "../facility-quality/rules";
import { naver, bizno, type Navigate, type Outcome } from "./browser";
import { dart, fsc, ProviderError } from "./public-api";

const RETRYABLE = new Set(["timeout", "error", "parse_error"]);
export async function processQualityRun(db: Database, tx: Transaction, runId: string, providers: Partial<Record<string,(snapshot:Snapshot)=>Promise<Outcome>>> = {}) {
  const owner = randomUUID();
  const claimed = await rows<{ mode: string; options: RunOptions }>(db, `UPDATE facility_quality_runs SET status='running',lease_owner=$2,lease_until=now()+interval '2 minutes',updated_at=now(),error=NULL
    WHERE run_id=$1 AND status IN ('queued','interrupted','failed','running') AND (lease_until IS NULL OR lease_until<now()) RETURNING mode,options`, [runId, owner]);
  if (!claimed.length) return;
  const run = claimed[0];
  let lostLease = false;
  const heartbeat = setInterval(() => {
    rows(db, "UPDATE facility_quality_runs SET lease_until=now()+interval '2 minutes',updated_at=now() WHERE run_id=$1 AND lease_owner=$2 RETURNING run_id", [runId, owner])
      .then(r => { if (!r.length) lostLease = true; }).catch(() => { lostLease = true; });
  }, 30000);
  let browser: Browser | undefined;
  const stoppedSources = new Map<string, Outcome["status"]>();
  const failures = new Map<string, number>();
  let lastNavigation = 0;
  async function budget(source: string) {
    const max = Math.max(1, Math.min(10000, Number(process.env[`FACILITY_QUALITY_${source.toUpperCase()}_DAILY_LIMIT`] || (source === "bizno" ? 100 : 600))));
    const reserved = await rows(db, `INSERT INTO facility_quality_source_requests(source,day,requests) VALUES($1,CURRENT_DATE,1)
      ON CONFLICT(source,day) DO UPDATE SET requests=facility_quality_source_requests.requests+1 WHERE facility_quality_source_requests.requests<$2 RETURNING requests`, [source, max]);
    if (!reserved.length) throw new ProviderError("quota", "일일 조회 한도 도달");
  }
  const navigate: Navigate = async (page, url, source) => {
    await budget(source);
    const delay = Math.max(1500, Number(process.env.FACILITY_QUALITY_INTERVAL_MS || 3000));
    const remaining = lastNavigation + delay - Date.now();
    if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
    lastNavigation = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    if ([401,403,429].includes(response?.status() ?? 200)) throw new ProviderError("blocked", "정보원 접근 제한");
    if (response && response.status() >= 400) throw new ProviderError("error", "정보원 응답 오류");
    // 차단 화면을 우회하거나 CAPTCHA를 풀지 않는다. 전체 업체 본문을 읽거나 로그에 남기지 않는다.
    const blocked = await page.locator('input[name*="captcha"], iframe[src*="captcha"], #captcha').count();
    const title = await page.title();
    const blockText = await page.getByText(/자동입력 방지|비정상적인 접근|접근이 제한|보안 확인을 완료/i).first().isVisible().catch(() => false);
    if (blocked || blockText || /접근.{0,5}제한|보안.?확인|access denied|captcha/i.test(title)) throw new ProviderError("blocked", "자동조회 제한으로 수동 확인 필요");
  };
  try {
    while (!lostLease) {
      const item = (await rows<{ snapshot: Snapshot; outcomes: Record<string, Outcome>; attempts: number }>(db,
        "SELECT snapshot,outcomes,attempts FROM facility_quality_items WHERE run_id=$1 AND status='pending' ORDER BY facility_id LIMIT 1", [runId]))[0];
      if (!item) break;
      const snapshot = item.snapshot;
      await tx(t => auditItem(t, runId, snapshot));
      const outcomes = item.outcomes;
      if (run.mode === "enrich" && !snapshot.is_closed) {
        for (const source of run.options.sources) {
          if (lostLease) throw new Error("작업 소유권 만료");
          if (outcomes[source] && !RETRYABLE.has(outcomes[source].status) && !["quota","blocked","not_configured"].includes(outcomes[source].status)) continue;
          let result: Outcome;
          try {
            if (stoppedSources.has(source)) result = { status: stoppedSources.get(source)!, profiles: [], note: "같은 정보원 제한으로 후속 조회 생략" };
            else {
              const ownId = validBrn(identifier(snapshot.business_registration_no || snapshot.site_business_registration_no)) ? `brn:${identifier(snapshot.business_registration_no || snapshot.site_business_registration_no)}` : identifier(snapshot.corporate_registration_no).length === 13 ? `crn:${identifier(snapshot.corporate_registration_no)}` : null;
              const cached = ownId ? (await rows<{ profile: Profile }>(db, "SELECT profile FROM facility_quality_profile_cache WHERE source=$1 AND identifier=$2 AND expires_at>now()", [source, ownId]))[0] : null;
              if (providers[source]) result = await providers[source]!(snapshot);
              else if (cached) result = { status: "success", profiles: [cached.profile], note: "동일 등록번호의 24시간 이내 조회 근거 재사용" };
              else if (source === "naver" || source === "bizno") {
                browser ??= await chromium.launch({ headless: true });
                result = await (source === "naver" ? naver : bizno)(browser, snapshot, navigate);
              } else {
                result = source === "dart" ? await dart(snapshot, () => budget(source)) : source === "fsc" ? await fsc(snapshot, () => budget(source)) : { status: "not_configured", profiles: [] };
              }
            }
          } catch (error) {
            const code = (error as { cause?: { code?: string }; code?: string }).cause?.code || (error as { code?: string }).code;
            const safeCode = code && /^[A-Z_]{3,60}$/.test(code) ? ` (${code})` : "";
            result = { status: error instanceof ProviderError ? error.status : (error as Error).name === "TimeoutError" ? "timeout" : "error", profiles: [], note: error instanceof ProviderError ? error.message : `연결·조회 실패${safeCode}. 키와 페이지 원문은 기록하지 않습니다` };
          }
          if (["blocked","quota","not_configured"].includes(result.status)) stoppedSources.set(source, result.status);
          failures.set(source, RETRYABLE.has(result.status) ? (failures.get(source) || 0) + 1 : 0);
          if ((failures.get(source) || 0) >= 3) stoppedSources.set(source, result.status);
          if (lostLease) throw new Error("작업 소유권 만료");
          await tx(async t => {
            // 대기 중 새 워커가 소유권을 가져갔다면 이전 워커 결과를 저장하지 않는다.
            const current = await rows(t, "SELECT run_id FROM facility_quality_runs WHERE run_id=$1 AND lease_owner=$2 AND lease_until>now() FOR UPDATE", [runId, owner]);
            if (!current.length) throw new Error("작업 소유권 만료");
            for (const p of result.profiles) {
              const candidates = proposals(snapshot,p);
              if (!candidates.length) continue; // 관련 없는 검색 결과를 캐시에도 축적하지 않는다.
              await saveProposals(t, runId, snapshot, candidates);
              const brn = identifier(p.values.business_registration_no);
              const crn = identifier(p.values.corporate_registration_no);
              const cacheId = validBrn(brn) ? `brn:${brn}` : crn.length === 13 ? `crn:${crn}` : null;
              if (cacheId) await t.run(`INSERT INTO facility_quality_profile_cache(source,identifier,profile,expires_at) VALUES($1,$2,$3::jsonb,now()+interval '24 hours')
                ON CONFLICT(source,identifier) DO UPDATE SET profile=EXCLUDED.profile,expires_at=EXCLUDED.expires_at`, [source, cacheId, JSON.stringify(p)]);
            }
            outcomes[source] = { ...result, profiles: [] };
            await t.run("UPDATE facility_quality_items SET outcomes=$3::jsonb,updated_at=now() WHERE run_id=$1 AND facility_id=$2", [runId, snapshot.facility_id, JSON.stringify(outcomes)]);
          });
        }
      }
      const failed = Object.values(outcomes).some(o => RETRYABLE.has(o.status) || ["blocked","quota","not_configured"].includes(o.status));
      await db.run("UPDATE facility_quality_items SET status=$3,attempts=attempts+1,updated_at=now() WHERE run_id=$1 AND facility_id=$2 AND EXISTS(SELECT 1 FROM facility_quality_runs WHERE run_id=$1 AND lease_owner=$4 AND lease_until>now())", [runId, snapshot.facility_id, snapshot.is_closed ? "historical" : failed ? "needs_attention" : "completed",owner]);
    }
    if (lostLease) throw new Error("작업 소유권 만료");
    await db.run(`UPDATE facility_quality_runs SET status=CASE WHEN EXISTS(SELECT 1 FROM facility_quality_items WHERE run_id=$1 AND status='needs_attention') THEN 'needs_attention' ELSE 'completed' END,
      lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE run_id=$1 AND lease_owner=$2`, [runId, owner]);
  } catch (error) {
    await db.run("UPDATE facility_quality_runs SET status='interrupted',error='작업이 중단되었습니다. 미완료 항목을 재개할 수 있습니다.',lease_owner=NULL,lease_until=NULL,updated_at=now() WHERE run_id=$1 AND lease_owner=$2", [runId, owner]);
    throw error;
  } finally { clearInterval(heartbeat); await browser?.close(); }
}
