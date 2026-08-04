// DART 신호 수집 오케스트레이션. API & RAG — 모집단 역전(1단계).
// 흐름: 선택 기간 전 공시 조회 → 공시 회사를 facilities(통합허가 대상 마스터)와 매칭
//       (정규화 회사명 1차, BRN 숫자정규화 보강) → 매칭+관심유형만 후보 → 분류·등급 → upsert.
// facilities 자체가 통합허가 대상 목록이므로 "매칭=대상". 외부호출은 스로틀, DB 쓰기는 배치.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  listDisclosures,
  getCompanyBrn,
  getTangibleAssetAcquisitions,
  getDocumentText,
  disclosureUrl,
  type DartDisclosure,
  type TangibleAssetAcq,
} from "./dart-client";
import {
  routeDisclosure,
  classifyDisclosure,
  classifyCounterparty,
  extractCounterpartyText,
  COUNTERPARTY_CATEGORIES,
  type IntelSignalGrade,
  type ClassifyResult,
  type DisclosureCategory,
} from "./signal-extractor";
import { buildFacilityMatcher, facilityCoreKey } from "./facility-matcher";
import { feedbackKey, loadFeedbackBlocklist } from "./intel-feedback";
import { industryTagForFacility } from "./industry-rules";
import { classifySupplyContract, supplyDocExcerpt } from "./dart-supply-classifier";
import type { IntelIndustryItem } from "./intel-settings";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const yyyymmdd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, "");
const toIso = (ymd: string): string => (/^\d{8}$/.test(ymd) ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : ymd);
const brnDigits = (v: unknown): string => String(v ?? "").replace(/[^0-9]/g, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parseYmd = (ymd: string): Date => new Date(`${toIso(ymd)}T00:00:00Z`);
const shiftDays = (ymd: string, n: number): string => yyyymmdd(new Date(parseYmd(ymd).getTime() + n * 86400000));
const spanDays = (bgn: string, end: string): number => Math.round((parseYmd(end).getTime() - parseYmd(bgn).getTime()) / 86400000);

export interface CollectOptions {
  days?: number; // 프리셋 기간(엔드일 기준 소급). bgnDe 없을 때 사용
  bgnDe?: string; // YYYYMMDD 직접 지정(과거 이력)
  endDe?: string; // YYYYMMDD 직접 지정
  maxPages?: number; // 미지정=완주(배치), 소량=테스트 버튼(헬스체크)
  maxDocs?: number; // 2차 원문 파싱 대상 상한(미지정=완주, 0=2차 skip, 소량=테스트)
  /** 3차 공급계약 발주처 리드: 2차 매칭 실패한 공급계약 원문을 LLM 분류해 미매칭 리드로 수집. 기본 off */
  supplyLeadScan?: boolean;
  /** 3차 LLM 분류 일일 상한(기본 30) */
  supplyLeadMaxClassify?: number;
  /** 업종 태깅 목록(리드 분류용) — intel_settings.industries */
  industries?: IntelIndustryItem[];
}

export interface CollectResult {
  scanned: number; // 조회한 전 공시 수
  corpQueried: number; // company.json(BRN) 조회한 회사 수
  matched: number; // 1차 facilities 매칭+관심유형(direct 후보) 공시 수
  docScanned: number; // 2차 원문(document.xml) 조회한 공시 수
  counterpartyMatched: number; // 2차 거래상대방=대상(counterparty 후보) 공시 수
  supplyClassified: number; // 3차 공급계약 리드 LLM 분류 수
  supplyLeads: number; // 3차 통합허가 대상 판정(신규 리드 후보) 수
  inserted: number; // 신규 저장(1차+2차+3차)
  byGrade: Record<IntelSignalGrade, number>; // 신규분 등급 분포
  range: { bgnDe: string; endDe: string };
  truncated: boolean; // maxPages 상한으로 잘렸는지(테스트 모드)
}

const DART_MAX_RANGE_DAYS = 30; // DART list.json 최대 검색기간
const PAGE_THROTTLE_MS = 250;
const CORP_THROTTLE_MS = 150;
const DOC_THROTTLE_MS = 300; // 원문(document.xml)은 ZIP이라 더 여유롭게

function resolveRange(opts: CollectOptions, now: Date): { bgnDe: string; endDe: string } {
  const endDe = opts.endDe && /^\d{8}$/.test(opts.endDe) ? opts.endDe : yyyymmdd(now);
  let bgnDe: string;
  if (opts.bgnDe && /^\d{8}$/.test(opts.bgnDe)) bgnDe = opts.bgnDe;
  else bgnDe = shiftDays(endDe, -(opts.days ?? 7));
  // DART 30일 상한 준수(초과 시 endDe 기준 30일로 clamp — 과거 대량은 호출측이 청크 분할)
  if (spanDays(bgnDe, endDe) > DART_MAX_RANGE_DAYS) bgnDe = shiftDays(endDe, -DART_MAX_RANGE_DAYS);
  return { bgnDe, endDe };
}

export async function collectDartSignals(opts: CollectOptions = {}): Promise<CollectResult> {
  const db = await getDb();
  const now = new Date();
  const { bgnDe, endDe } = resolveRange(opts, now);
  const maxPages = opts.maxPages && opts.maxPages > 0 ? opts.maxPages : Infinity;
  const maxDocs = opts.maxDocs != null && opts.maxDocs >= 0 ? opts.maxDocs : Infinity;

  const result: CollectResult = {
    scanned: 0, corpQueried: 0, matched: 0, docScanned: 0, counterpartyMatched: 0,
    supplyClassified: 0, supplyLeads: 0, inserted: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
    range: { bgnDe, endDe }, truncated: false,
  };

  // 1) facilities(통합허가 대상 마스터) 매칭 — 공용 매처(BRN + 법인격·사이트 접미사·음차·별칭 대응)
  const matcher = await buildFacilityMatcher(db);

  // 2) 선택 기간 전 공시 조회(테스트는 maxPages 소량). 라우팅 필터 없이 전부 수집(모집단 역전).
  const all: DartDisclosure[] = [];
  let pageNo = 1;
  while (pageNo <= maxPages) {
    const { disclosures, totalPage } = await listDisclosures({ bgnDe, endDe, pageNo, pageCount: 100 });
    result.scanned += disclosures.length;
    all.push(...disclosures);
    if (totalPage === 0 || pageNo >= totalPage) break;
    if (pageNo >= maxPages) { result.truncated = true; break; }
    pageNo++;
    await sleep(PAGE_THROTTLE_MS);
  }

  // 3) 회사(corp) 단위 facilities 매칭: 정규화 회사명 1차 → 실패+관심유형이면 BRN 보강
  const corpName = new Map<string, string>();
  for (const d of all) if (d.corpCode && !corpName.has(d.corpCode)) corpName.set(d.corpCode, d.corpName);
  const interestCorps = new Set<string>(); // 관심유형 공시를 가진 회사(BRN 조회 대상 축소용)
  for (const d of all) if (d.corpCode && routeDisclosure(d.reportName)) interestCorps.add(d.corpCode);

  const corpToFac = new Map<string, string | null>();
  const corpToBrn = new Map<string, string | null>();
  for (const [corp, name] of corpName) {
    let fid = matcher.matchName(name)?.facilityId ?? null;
    let brn: string | null = null;
    if (!fid && interestCorps.has(corp)) {
      try { brn = await getCompanyBrn(corp); } catch { brn = null; }
      result.corpQueried++;
      fid = matcher.matchBrn(brnDigits(brn))?.facilityId ?? null;
      await sleep(CORP_THROTTLE_MS);
    }
    corpToFac.set(corp, fid);
    corpToBrn.set(corp, brn);
  }

  // 후보 = 매칭 회사 + 관심유형 공시
  const cands = all.filter((d) => d.corpCode && corpToFac.get(d.corpCode) && routeDisclosure(d.reportName));
  result.matched = cands.length;

  // 4) tangible 후보만 DS005 유형자산 양수 정형 상세 조회(회사별 1회)
  const tangibleCorps = [...new Set(cands.filter((d) => routeDisclosure(d.reportName) === "tangible").map((d) => d.corpCode))];
  const tangibleByCorp = new Map<string, Map<string, TangibleAssetAcq>>();
  for (const corp of tangibleCorps) {
    tangibleByCorp.set(corp, await getTangibleAssetAcquisitions(corp, bgnDe, endDe));
    await sleep(CORP_THROTTLE_MS);
  }

  // 5) 2차 counterparty: 1차 미매칭 + 공급/계열거래 공시의 원문(document.xml)에서 발주처가 대상인지 대조.
  //    (예: LS엠앤엠 EVBM 공장공사를 LS eNM이 수주 → 공시자 LS eNM은 미매칭이나 원문의 발주처 LS엠앤엠이 대상)
  interface SecondCand { d: DartDisclosure; facilityId: string; counterpartyName: string }
  const secondCands: SecondCand[] = [];
  // 3차 후보: 2차 매칭 실패한 공급계약 공시(원문은 2차에서 이미 확보 — 추가 조회 없음)
  interface SupplyLeadCand { d: DartDisclosure; fullText: string }
  const supplyLeadCands: SupplyLeadCand[] = [];
  if (maxDocs > 0) {
    const seen2 = new Set<string>();
    const secondTargets = all.filter((d) => {
      if (!d.corpCode || corpToFac.get(d.corpCode)) return false; // 1차 direct 매칭된 회사 제외
      if (!d.receiptNo || seen2.has(d.receiptNo)) return false;
      const cat = routeDisclosure(d.reportName);
      if (!cat || !COUNTERPARTY_CATEGORIES.has(cat)) return false;
      seen2.add(d.receiptNo);
      return true;
    });
    for (const d of secondTargets) {
      if (result.docScanned >= maxDocs) { result.truncated = true; break; }
      const fullText = await getDocumentText(d.receiptNo);
      result.docScanned++;
      await sleep(DOC_THROTTLE_MS);
      if (!fullText) continue;
      const ctxt = extractCounterpartyText(fullText);
      const excludeCore = facilityCoreKey(d.corpName);
      const hit = matcher.findInText(ctxt, excludeCore);
      if (hit) secondCands.push({ d, facilityId: hit.facilityId, counterpartyName: hit.facilityName });
      else if (opts.supplyLeadScan && routeDisclosure(d.reportName) === "supply_contract") {
        supplyLeadCands.push({ d, fullText });
      }
    }
    result.counterpartyMatched = secondCands.length;
  }

  // 5.5) 3차 공급계약 발주처 리드: 매칭 실패한 공급계약 원문을 LLM 이 읽어 '통합허가 대상급 시설의
  //      건설·증설·설비' 계약만 골라 발주처를 미매칭 리드로 뽑는다(공시자=수주사는 리드가 아님).
  interface SupplyLead { d: DartDisclosure; cls: NonNullable<Awaited<ReturnType<typeof classifySupplyContract>>> }
  const supplyLeads: SupplyLead[] = [];
  if (opts.supplyLeadScan && supplyLeadCands.length) {
    const maxClassify = opts.supplyLeadMaxClassify != null && opts.supplyLeadMaxClassify >= 0 ? opts.supplyLeadMaxClassify : 30;
    for (const cand of supplyLeadCands.slice(0, maxClassify)) {
      const cls = await classifySupplyContract(
        cand.d.corpName,
        cand.d.reportName,
        supplyDocExcerpt(cand.fullText),
        opts.industries
      );
      if (!cls) continue; // 키 없음/오류 — skip
      result.supplyClassified++;
      // 대상 판정 + 업종 무관(none) 제외 + 발주처 식별 필수(리드 주체)
      if (cls.isTarget && cls.ordererName && cls.industryRelevance !== "none") {
        supplyLeads.push({ d: cand.d, cls });
      }
    }
    result.supplyLeads = supplyLeads.length;
  }

  // 6) DB: 분류·등급 + upsert(1차 direct + 2차 counterparty)
  const nowIso = now.toISOString();
  await withDbWrite(async (wdb) => {
    // 사용자가 사유와 함께 삭제한 신호는 재수집하지 않는다(intel_signal_feedback)
    const blocklist = await loadFeedbackBlocklist(wdb);
    const insertSignal = async (
      d: DartDisclosure,
      cls: ClassifyResult,
      facilityId: string,
      brn: string | null,
      matchType: "direct" | "counterparty",
      category: DisclosureCategory | null,
      detail: unknown
    ): Promise<boolean> => {
      if (blocklist.has(feedbackKey("dart", d.receiptNo))) return false;
      const signalId = id("isig");
      const raw = JSON.stringify({
        corpCode: d.corpCode, receiptNo: d.receiptNo, filerName: d.filerName,
        remark: d.remark, stockCode: d.stockCode, category, detail, matchType,
      });
      // DART 는 facilities 매칭 전제 소스 — 마스터 KSIC 로 업종 확정(relevance=direct)
      const tag = await industryTagForFacility(wdb, facilityId);
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, corp_code, company_name, brn, report_name, signal_type, signal_grade,
              disclosed_at, amount, url, raw_json, asset_class, acquire_purpose, counterparty,
              facility_id, match_status, match_type, status,
              industry, industry_relevance, created_at, updated_at)
           VALUES ($1,'dart',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,'matched',$17,'new',$18,$19,$20,$20)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, d.receiptNo, d.corpCode, d.corpName, brn, d.reportName, cls.signalType, cls.grade,
            toIso(d.receiptDate), cls.amount, disclosureUrl(d.receiptNo), raw, cls.assetClass, cls.purpose, cls.counterparty,
            facilityId, matchType, tag.industry, tag.relevance, nowIso,
          ]
        )
      );
      if (!ins.length) return false;
      result.inserted++;
      result.byGrade[cls.grade]++;
      return true;
    };

    // 1차 direct
    for (const d of cands) {
      const category = routeDisclosure(d.reportName)!;
      const facilityId = corpToFac.get(d.corpCode)!;
      const brn = corpToBrn.get(d.corpCode) ?? null;
      const detail = category === "tangible" ? tangibleByCorp.get(d.corpCode)?.get(d.receiptNo) ?? null : null;
      const cls = classifyDisclosure(d.reportName, category, detail);
      const inserted = await insertSignal(d, cls, facilityId, brn, "direct", category, detail);
      // confirmed(설비 증설/신설 확정) 신규만 alerts 고지(노이즈 억제)
      if (inserted && cls.grade === "confirmed") {
        await wdb.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info','intel','dart-signal',$1,$2,$3::jsonb,$4)`,
          [
            `${d.corpName} · ${cls.signalType === "new_site" ? "신설" : "증설"} 신호`,
            d.reportName,
            JSON.stringify({ facilityId, signalType: cls.signalType, grade: cls.grade }),
            nowIso,
          ]
        );
      }
    }

    // 2차 counterparty(발주처=대상). monitoring 이라 alert 없음(사람 검토용).
    for (const sc of secondCands) {
      const cls = classifyCounterparty(sc.counterpartyName);
      const category = routeDisclosure(sc.d.reportName);
      await insertSignal(sc.d, cls, sc.facilityId, null, "counterparty", category, { counterparty: sc.counterpartyName });
    }

    // 3차 공급계약 발주처 리드 — 미매칭(unmatched) 신규 리드로 저장.
    // company_name=발주처(발굴 주체), 공시자(수주사)는 raw/counterparty 에 보존. alert 없음(검토용).
    const GRADE_BY_CONF: Record<string, IntelSignalGrade> = { high: "confirmed", medium: "candidate", low: "monitoring" };
    for (const { d, cls } of supplyLeads) {
      if (blocklist.has(feedbackKey("dart", d.receiptNo))) continue;
      const grade = GRADE_BY_CONF[cls.confidence] ?? "monitoring";
      const raw = JSON.stringify({
        corpCode: d.corpCode, receiptNo: d.receiptNo, filerName: d.filerName ?? d.corpName,
        remark: d.remark, stockCode: d.stockCode, category: "supply_contract", matchType: "supply_lead",
        supplyLead: cls,
      });
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, corp_code, company_name, report_name, signal_type, signal_grade,
              disclosed_at, url, raw_json, summary, counterparty,
              match_status, status, industry, industry_relevance, relevance_note, created_at, updated_at)
           VALUES ($1,'dart',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'unmatched','new',$13,$14,$15,$16,$16)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            id("isig"), d.receiptNo, d.corpCode, cls.ordererName, d.reportName, cls.signalType, grade,
            toIso(d.receiptDate), disclosureUrl(d.receiptNo), raw,
            cls.summary ?? [cls.facilityKind, cls.location, cls.scale].filter(Boolean).join(" · "),
            cls.ordererName,
            cls.industry, cls.industryRelevance, cls.relevanceNote, nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      result.inserted++;
      result.byGrade[grade]++;
    }

    // 최근 실행 기록(증분 커서는 배치가 days로 관리하므로 기록용)
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ('dart',$1,$2,$1)
       ON CONFLICT (source) DO UPDATE SET
         last_run_at = EXCLUDED.last_run_at, last_cursor = EXCLUDED.last_cursor, updated_at = EXCLUDED.updated_at`,
      [nowIso, endDe]
    );
  });

  return result;
}
