// DART 정형 신호 증분 수집 오케스트레이션. API & RAG 1차.
// 흐름: 공시목록(규칙 필터) → 후보 BRN 조회 → facilities 매칭 → intel_signals upsert → 매칭건 alerts 고지.
// 외부 API 호출은 트랜잭션 밖에서 모으고, DB 쓰기만 withDbWrite로 배치.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { listDisclosures, getCompanyBrn, disclosureUrl, type DartDisclosure } from "./dart-client";
import { classifySignal, INTEL_SIGNAL_TYPE_LABELS, type IntelSignalType } from "./signal-extractor";

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}
const yyyymmdd = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, "");
const toIso = (ymd: string): string => (/^\d{8}$/.test(ymd) ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : ymd);

export interface CollectResult {
  scanned: number; // 조회한 공시 수
  candidates: number; // 규칙 매칭 후보
  inserted: number; // 신규 저장
  matched: number; // 사업장 매칭(신규분)
  alerted: number; // 고지 생성
  range: { bgnDe: string; endDe: string };
}

const MAX_PAGES = 10;

export async function collectDartSignals(opts: { days?: number } = {}): Promise<CollectResult> {
  const db = await getDb();
  const now = new Date();

  // 증분: 마지막 수집 커서(YYYYMMDD) 이후. 없으면 최근 days일(기본 7).
  const stateRows = rowsToObjects(await db.exec("SELECT last_cursor FROM intel_collect_state WHERE source = 'dart' LIMIT 1"));
  const lastCursor = stateRows[0]?.last_cursor ? String(stateRows[0].last_cursor) : "";
  const days = opts.days ?? 7;
  const bgnDe = /^\d{8}$/.test(lastCursor) ? lastCursor : yyyymmdd(new Date(now.getTime() - days * 86400000));
  const endDe = yyyymmdd(now);

  const result: CollectResult = { scanned: 0, candidates: 0, inserted: 0, matched: 0, alerted: 0, range: { bgnDe, endDe } };

  // 1) 외부: 공시 목록 수집 + report_nm 규칙 필터
  const cands: { d: DartDisclosure; type: IntelSignalType }[] = [];
  let pageNo = 1;
  while (pageNo <= MAX_PAGES) {
    const { disclosures, totalPage } = await listDisclosures({ bgnDe, endDe, pageNo, pageCount: 100 });
    result.scanned += disclosures.length;
    for (const d of disclosures) {
      const type = classifySignal(d.reportName);
      if (type) cands.push({ d, type });
    }
    if (totalPage === 0 || pageNo >= totalPage) break;
    pageNo++;
  }
  result.candidates = cands.length;

  // 2) 외부: 후보 BRN 조회(후보만이라 호출 수 적음)
  const enriched: { d: DartDisclosure; type: IntelSignalType; brn: string | null }[] = [];
  for (const c of cands) {
    let brn: string | null = null;
    try {
      brn = await getCompanyBrn(c.d.corpCode);
    } catch {
      brn = null;
    }
    enriched.push({ ...c, brn });
  }

  // 3) DB: 매칭 + upsert + 고지 + 커서 갱신
  const nowIso = now.toISOString();
  await withDbWrite(async (wdb) => {
    for (const { d, type, brn } of enriched) {
      const matchRows = rowsToObjects(
        await wdb.exec(
          `SELECT facility_id FROM facilities
            WHERE ($1 <> '' AND business_registration_no = $1)
               OR ($2 <> '' AND company_name = $2)
            LIMIT 1`,
          [brn ?? "", d.corpName]
        )
      );
      const facilityId = matchRows[0]?.facility_id ? String(matchRows[0].facility_id) : null;
      const signalId = id("isig");
      const raw = JSON.stringify({
        corpCode: d.corpCode,
        receiptNo: d.receiptNo,
        filerName: d.filerName,
        remark: d.remark,
        stockCode: d.stockCode,
      });
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, corp_code, company_name, brn, report_name, signal_type,
              disclosed_at, url, raw_json, facility_id, match_status, status, created_at, updated_at)
           VALUES ($1,'dart',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'new',$13,$13)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, d.receiptNo, d.corpCode, d.corpName, brn, d.reportName, type,
            toIso(d.receiptDate), disclosureUrl(d.receiptNo), raw, facilityId,
            facilityId ? "matched" : "unmatched", nowIso,
          ]
        )
      );
      if (!ins.length) continue; // 이미 수집된 공시 → 스킵
      result.inserted++;
      if (facilityId) {
        result.matched++;
        // 매칭된 신규 신호만 alerts 고지(기존 alerts 재사용)
        await wdb.run(
          `INSERT INTO alerts (severity, source, code, title, body, payload_json, created_at)
           VALUES ('info','intel','dart-signal',$1,$2,$3::jsonb,$4)`,
          [
            `${d.corpName} · ${INTEL_SIGNAL_TYPE_LABELS[type]} 신호`,
            d.reportName,
            JSON.stringify({ signalId, facilityId, signalType: type }),
            nowIso,
          ]
        );
        result.alerted++;
      }
    }
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
