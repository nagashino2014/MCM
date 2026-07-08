// EIASS 발주 신호 수집 오케스트레이션. 협의진행현황 리스트 스캔 → 신규 건만 3단 필터
// (사업명 키워드 → 상세 사업구분 → Haiku 판별) → facilities 매칭 → 적재.
// 환경영향평가 협의 접수는 공장·산단 신설의 법정 선행 단계(착공 6개월~2년 전)라 뉴스·DART 보다 이르다.
// 2트랙: 시행자가 facilities(통합허가 대상)와 매칭되면 증설(트랙A, matched), 아니면 신규 리드(트랙B, unmatched).
// source='eiass', external_id=사업코드. 리스트가 시간 완전역순이 아니라(내부 수정일 순) 기존 코드는 스킵만 한다.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/ieps/formatters";
import {
  fetchEiassList,
  fetchEiassDetail,
  EIASS_KIND_LABELS,
  EIASS_LIST_URL,
  type EiassKind,
  type EiassListRow,
  type EiassDetail,
} from "./eiass-client";
import { classifyEiass, type EiassClassification } from "./eiass-classifier";
import { coreCompanyName, isProcurementProxy, type IntelSignalType, type IntelSignalGrade } from "./signal-extractor";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KINDS: EiassKind[] = ["eia", "sperss", "mperss"];
const LIST_THROTTLE_MS = 250;
const DETAIL_THROTTLE_MS = 300;
const HAIKU_THROTTLE_MS = 120;

// 1차 사업명 키워드 필터: 통합허가 업종 정황(산단·공장·발전·소각·폐기물)만 상세 조회.
// 도로·하천·골프장·주택 등은 포지티브 미부합으로 자연 탈락. 태양광·풍력은 발전 계열 오탐이라 네거티브.
const POSITIVE_RE = /(산업단지|농공단지|산단|공장|제조|생산시설|생산라인|발전소|발전사업|복합발전|열병합|소각|폐기물|매립장|자원순환|재활용시설)/;
const NEGATIVE_RE = /(태양광|풍력|연료전지)/;

// Haiku confidence → 신호 등급(뉴스 파이프라인과 동일 매핑)
const GRADE_BY_CONFIDENCE: Record<EiassClassification["confidence"], IntelSignalGrade> = {
  high: "confirmed",
  medium: "candidate",
  low: "monitoring",
};

// "2026.07.03" → ISO. 실패 시 null.
function dotDateToIso(s: string): string | null {
  const m = (s ?? "").match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export interface CollectEiassOptions {
  maxPages?: number; // kind당 리스트 페이지 수(10행/페이지). 기본 5(일일 증분 충분)
  maxDetails?: number; // 상세 조회 상한(키워드 통과 건 대상, 테스트 제어). 미지정=전량
  maxClassify?: number; // Haiku 분류 상한(비용·테스트 제어). 미지정=전량
}

export interface CollectEiassResult {
  scanned: number; // 리스트에서 훑은 행 수
  newFound: number; // DB에 없던 신규 사업코드 수
  kwPassed: number; // 사업명 키워드 필터 통과 수
  detailFetched: number; // 상세 조회 수
  classified: number; // Haiku 분류 수
  signals: number; // isTarget=true (통합허가 관련) 수
  inserted: number; // 신규 저장
  matched: number; // facilities 매칭(증설=트랙A) 수
  newLead: number; // 미매칭(신규 리드=트랙B) 수
  byGrade: Record<IntelSignalGrade, number>;
  parseEmpty: boolean; // 전 kind 리스트 파싱 0행(사이트 개편 의심 → 알람)
}

export async function collectEiassSignals(opts: CollectEiassOptions = {}): Promise<CollectEiassResult> {
  const db = await getDb();
  const maxPages = opts.maxPages && opts.maxPages > 0 ? opts.maxPages : 5;
  const maxDetails = opts.maxDetails != null && opts.maxDetails >= 0 ? opts.maxDetails : Infinity;
  const maxClassify = opts.maxClassify != null && opts.maxClassify >= 0 ? opts.maxClassify : Infinity;

  const result: CollectEiassResult = {
    scanned: 0, newFound: 0, kwPassed: 0, detailFetched: 0, classified: 0, signals: 0,
    inserted: 0, matched: 0, newLead: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
    parseEmpty: false,
  };

  // 1) facilities 코어명 매칭 집합(시행자명 매칭. EIASS 는 BRN 없음) — 뉴스 파이프라인과 동일 패턴.
  const facRows = rowsToObjects(
    await db.exec(`SELECT facility_id, company_name, normalized_company_name FROM facilities`)
  );
  const coreToFac = new Map<string, string>();
  for (const r of facRows) {
    const cname = String(r.company_name ?? "");
    const nm = r.normalized_company_name ? String(r.normalized_company_name).trim() : "";
    if (isProcurementProxy(cname) || isProcurementProxy(nm)) continue;
    const core = coreCompanyName(nm || cname);
    if (core.length >= 3 && !coreToFac.has(core)) coreToFac.set(core, String(r.facility_id));
  }

  // 2) 기존 수집 코드(스킵용). external_id=사업코드.
  const seen = new Set(
    rowsToObjects(await db.exec(`SELECT external_id FROM intel_signals WHERE source = 'eiass'`)).map((r) =>
      String(r.external_id)
    )
  );

  // 3) kind별 리스트 스캔 → 신규 + 키워드 통과 건만 후보로
  interface Candidate { kind: EiassKind; row: EiassListRow }
  const candidates: Candidate[] = [];
  let anyRows = false;
  for (const kind of KINDS) {
    for (let page = 1; page <= maxPages; page++) {
      let rows: EiassListRow[];
      try {
        ({ rows } = await fetchEiassList(kind, page));
      } catch (err) {
        // 침묵 금지: ECS 인증서 이슈처럼 전건 실패 원인을 로그로 남긴다(개별 kind 실패는 다음 kind 로)
        console.error(`[collect-eiass] list fetch 실패 kind=${kind} page=${page}`, err);
        break;
      }
      await sleep(LIST_THROTTLE_MS);
      if (!rows.length) break;
      anyRows = true;
      result.scanned += rows.length;
      for (const row of rows) {
        if (seen.has(row.code)) continue;
        seen.add(row.code); // 리스트 중복 노출 방어
        result.newFound++;
        if (!POSITIVE_RE.test(row.title) || NEGATIVE_RE.test(row.title)) continue;
        result.kwPassed++;
        candidates.push({ kind, row });
      }
    }
  }
  result.parseEmpty = !anyRows;

  // 4) 상세 조회 → Haiku 판별(폴백: 규칙 기반 monitoring) → 매칭
  interface Prepared {
    kind: EiassKind; row: EiassListRow; detail: EiassDetail;
    signalType: IntelSignalType; grade: IntelSignalGrade;
    companyName: string | null; summary: string | null; facilityId: string | null;
  }
  const prepared: Prepared[] = [];
  for (const c of candidates) {
    if (result.detailFetched >= maxDetails) break;
    let detail: EiassDetail;
    try {
      detail = await fetchEiassDetail(c.kind, c.row.code, c.row.seq);
    } catch (err) {
      console.error(`[collect-eiass] detail fetch 실패 code=${c.row.code}`, err);
      continue; // 개별 상세 실패는 다음 배치에서 재시도(seen 은 DB 기준이라 재노출됨)
    }
    result.detailFetched++;
    await sleep(DETAIL_THROTTLE_MS);

    let cls: EiassClassification | null = null;
    if (result.classified < maxClassify) {
      cls = await classifyEiass({
        title: c.row.title,
        kindLabel: EIASS_KIND_LABELS[c.kind],
        bizCategory: detail.bizCategory,
        operator: detail.operator,
        region: detail.region,
        scaleText: detail.scaleText,
        costEokwon: detail.costEokwon,
      });
      if (cls) {
        result.classified++;
        await sleep(HAIKU_THROTTLE_MS);
      }
    }
    if (cls && !cls.isTarget) continue; // Haiku 가 비대상 판정(도로·태양광 등 오탐 제거)
    result.signals++;

    // Haiku 없으면 규칙 폴백: 키워드는 통과했으니 사람 검토용 monitoring 신설 추정.
    const signalType = cls ? cls.signalType : "new_site";
    const grade = cls ? GRADE_BY_CONFIDENCE[cls.confidence] : "monitoring";
    const companyName = cls?.companyName ?? detail.operator;

    // 시행자명 → facilities 매칭(조달대행 기관 제외). 지자체·공사 시행 산단은 unmatched 리드로 남는다.
    let facilityId: string | null = null;
    if (companyName && !isProcurementProxy(companyName)) {
      const core = coreCompanyName(normalizeCompanyName(companyName) ?? companyName);
      if (core.length >= 3) facilityId = coreToFac.get(core) ?? null;
    }
    prepared.push({
      kind: c.kind, row: c.row, detail,
      signalType, grade, companyName,
      summary: cls?.summary ?? null, facilityId,
    });
  }

  // 5) upsert (source='eiass'). 상세 원본·규모·대행업체 등은 raw_json.
  const nowIso = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    for (const p of prepared) {
      const raw = JSON.stringify({
        kind: p.kind, code: p.row.code, seq: p.row.seq, status: p.row.status,
        detail: p.detail,
      });
      // 사업비(억원) → 원 단위(DART amount 와 단위 통일)
      const amount = p.detail.costEokwon != null ? Math.round(p.detail.costEokwon * 1e8) : null;
      const signalId = id("isig");
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, company_name, report_name, signal_type, signal_grade,
              disclosed_at, amount, url, raw_json, summary,
              region, agency, progress_step,
              facility_id, match_status, match_type, status, created_at, updated_at)
           VALUES ($1,'eiass',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,'direct','new',$17,$17)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, p.row.code, p.companyName, p.row.title, p.signalType, p.grade,
            dotDateToIso(p.row.dateText), amount, EIASS_LIST_URL[p.kind], raw, p.summary,
            p.detail.region, p.detail.agency ?? p.row.agency, p.row.status || null,
            p.facilityId, p.facilityId ? "matched" : "unmatched", nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      result.inserted++;
      result.byGrade[p.grade]++;
      if (p.facilityId) result.matched++;
      else result.newLead++;
      // 확정(high) 신호만 alerts 고지(노이즈 억제 — 뉴스와 동일 정책)
      if (p.grade === "confirmed") {
        await wdb.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info','intel','eiass-signal',$1,$2,$3::jsonb,$4)`,
          [
            `${p.companyName ?? "미상"} · ${EIASS_KIND_LABELS[p.kind]} 협의 신호`,
            p.summary ?? p.row.title,
            JSON.stringify({
              signalId, facilityId: p.facilityId, signalType: p.signalType, grade: p.grade,
              track: p.facilityId ? "A" : "B", code: p.row.code,
            }),
            nowIso,
          ]
        );
      }
    }
    // 사이트 개편 의심(전 kind 파싱 0행) 알람 — 조용한 수집 중단 방지
    if (result.parseEmpty) {
      await wdb.run(
        `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
         VALUES ('warn','intel','eiass-parse-empty',$1,$2,$3::jsonb,$4)`,
        [
          "EIASS 리스트 파싱 0건",
          "협의진행현황 리스트에서 행을 하나도 파싱하지 못했습니다. 사이트 개편(리뉴얼) 여부를 확인하세요.",
          JSON.stringify({ maxPages }),
          nowIso,
        ]
      );
    }
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ('eiass',$1,$1,$1)
       ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [nowIso]
    );
  });

  return result;
}
