/**
 * intel sink 어댑터 — 범용 스크래퍼(lib/scraper)로 수집한 원시 item 을 field_mapping 으로 표준화해
 * facilities 매칭 후 intel_signals 에 적재한다. collect-news.ts 파이프라인을 그대로 모방.
 * source = 'custom:<slug>'. 범용 소스는 자동 등급 분류가 어려우므로 기본 grade = sink_config.signal_grade(monitoring).
 * (use_llm_classify 는 2차 — 현재 미사용.)
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { buildFacilityMatcher } from "./facility-matcher";
import { EMPTY_INDUSTRY_TAG, industryTagForFacility, type IndustryTag } from "./industry-rules";
import type { IntelSignalGrade, IntelSignalType } from "./signal-extractor";
import { getNestedValue, runApiCollect } from "@/lib/scraper/execute-api";
import { getSourceSecret } from "@/lib/scraper/sources-store";
import type { FieldMapping, ScraperEndpointRow, ScraperSourceRow } from "@/lib/scraper/types";

const GRADES: IntelSignalGrade[] = ["confirmed", "candidate", "monitoring", "excluded"];
const TYPES: IntelSignalType[] = ["investment", "expansion", "new_site", "other"];

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/** 표준 필드로 사상한 1건. */
interface MappedItem {
  externalId: string;
  companyName: string | null;
  reportName: string | null;
  url: string | null;
  disclosedAt: string | null;
  summary: string | null;
  raw: Record<string, unknown>;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
};

/** field_mapping 경로로 item 을 표준 필드에 사상. external_id 없으면 url/item 해시로 결정론적 폴백. */
function mapItem(item: Record<string, unknown>, fm: FieldMapping): MappedItem {
  // "=값" 은 상수(응답에 해당 필드가 없을 때 고정값 지정 — bid-sink 와 동일 문법).
  const pick = (key: string): string | null => {
    const path = fm[key];
    if (!path) return null;
    if (path.startsWith("=")) return str(path.slice(1));
    return str(getNestedValue(item, path));
  };
  const url = pick("url");
  let externalId = pick("external_id");
  if (!externalId) {
    externalId = crypto.createHash("sha1").update(url || JSON.stringify(item)).digest("hex").slice(0, 24);
  }
  return {
    externalId,
    companyName: pick("company_name"),
    reportName: pick("report_name"),
    url,
    disclosedAt: pick("disclosed_at"),
    summary: pick("summary"),
    raw: item,
  };
}

export interface CustomCollectResult {
  scanned: number;
  inserted: number;
  matched: number;
  byGrade: Record<IntelSignalGrade, number>;
  /** preview:true 일 때 변환 미리보기(최대 20건). */
  samples?: Array<Omit<MappedItem, "raw"> & { facilityId: string | null }>;
  error?: string;
  logs?: string[];
}

export interface CustomCollectOpts {
  preview?: boolean;
}

export async function collectCustomSource(
  source: ScraperSourceRow,
  endpoint: ScraperEndpointRow,
  opts: CustomCollectOpts = {}
): Promise<CustomCollectResult> {
  const db = await getDb();
  const sourceKey = `custom:${source.slug}`;
  const result: CustomCollectResult = {
    scanned: 0,
    inserted: 0,
    matched: 0,
    byGrade: { confirmed: 0, candidate: 0, monitoring: 0, excluded: 0 },
  };

  if (!source.apiProfile || !endpoint.apiConfig) {
    return { ...result, error: "api_profile 또는 api_config 가 없습니다." };
  }

  // sink 설정 등급/유형
  const gradeRaw = (endpoint.sinkConfig?.signal_grade ?? "monitoring") as IntelSignalGrade;
  const grade: IntelSignalGrade = GRADES.includes(gradeRaw) ? gradeRaw : "monitoring";
  const typeRaw = (endpoint.sinkConfig?.signal_type ?? "other") as IntelSignalType;
  const signalType: IntelSignalType = TYPES.includes(typeRaw) ? typeRaw : "other";

  // 1) 실행 → 원시 items (저장된 인증키 복호화 주입, 없으면 ENV 폴백)
  const secret = await getSourceSecret(source.sourceId);
  const run = await runApiCollect(source.apiProfile, endpoint.apiConfig, { secret });
  if (run.error && run.items.length === 0) {
    return { ...result, error: run.error, logs: run.logs };
  }
  // XML(raw_xml) 응답은 MVP 미지원 — 사상 불가
  const items = run.items.filter((it) => !("raw_xml" in it));
  result.scanned = items.length;

  const matcher = await buildFacilityMatcher(db);
  const fm = endpoint.fieldMapping ?? {};

  // 미리보기: 사상 결과만 반환(적재 안 함)
  if (opts.preview) {
    const samples = items.slice(0, 20).map((it) => {
      const m = mapItem(it, fm);
      const facilityId = matcher.matchName(m.companyName)?.facilityId ?? null;
      return {
        externalId: m.externalId,
        companyName: m.companyName,
        reportName: m.reportName,
        url: m.url,
        disclosedAt: m.disclosedAt,
        summary: m.summary,
        facilityId,
      };
    });
    result.samples = samples;
    result.matched = samples.filter((s) => s.facilityId).length;
    result.logs = run.logs;
    return result;
  }

  // 2) 기수집 external_id skip
  const seen = new Set(
    rowsToObjects(
      await db.exec(`SELECT external_id FROM intel_signals WHERE source = $1`, [sourceKey])
    ).map((r) => String(r.external_id))
  );

  const nowIso = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    for (const it of items) {
      const m = mapItem(it, fm);
      if (seen.has(m.externalId)) continue;
      const facilityId = matcher.matchName(m.companyName)?.facilityId ?? null;
      const matched = !!facilityId;
      const tag: IndustryTag = facilityId ? await industryTagForFacility(db, facilityId) : EMPTY_INDUSTRY_TAG;
      const signalId = id("isig");
      const ins = rowsToObjects(
        await wdb.exec(
          `INSERT INTO intel_signals
             (signal_id, source, external_id, company_name, report_name, signal_type, signal_grade,
              disclosed_at, url, raw_json, summary,
              facility_id, match_status, match_type, status,
              industry, industry_relevance, relevance_note, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,'direct','new',$14,$15,$16,$17,$17)
           ON CONFLICT (source, external_id) DO NOTHING
           RETURNING signal_id`,
          [
            signalId, sourceKey, m.externalId, m.companyName, m.reportName, signalType, grade,
            m.disclosedAt, m.url, JSON.stringify(m.raw), m.summary,
            facilityId, matched ? "matched" : "unmatched",
            tag.industry, tag.relevance, tag.note, nowIso,
          ]
        )
      );
      if (!ins.length) continue;
      seen.add(m.externalId);
      result.inserted++;
      result.byGrade[grade]++;
      if (matched) result.matched++;
    }
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ($1,$2,$2,$2)
       ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [sourceKey, nowIso]
    );
  });

  result.logs = run.logs;
  return result;
}
