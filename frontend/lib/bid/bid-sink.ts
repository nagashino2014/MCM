/**
 * bid sink 어댑터 — 범용 스크래퍼(lib/scraper)로 수집한 원시 item 을 field_mapping 으로 표준화해
 * 공공입찰 종류별 테이블(public_order_plans/prior_specs/bid_notices)에 적재한다.
 * custom-sink.ts(intel)와 달리 facilities 매칭·등급 분류 없음 — 발주기관 중심 데이터라 그대로 적재.
 * sink_config.bid_type 으로 대상 테이블을 고른다. source_slug+external_id 로 재수집 멱등.
 * (사업분야 관심 판별·알림은 2차 — 여기 적재 지점 다음에 훅을 건다.)
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getNestedValue, runApiCollect } from "@/lib/scraper/execute-api";
import { getSourceSecret } from "@/lib/scraper/sources-store";
import type {
  BidType,
  FieldMapping,
  ScraperEndpointRow,
  ScraperSourceRow,
} from "@/lib/scraper/types";

const TABLE_BY_TYPE: Record<BidType, string> = {
  order_plan: "public_order_plans",
  prior_spec: "public_prior_specs",
  bid_notice: "public_bid_notices",
};

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
};

/** 금액 문자열/숫자 → bigint 호환 정수(원). 콤마·통화기호 제거. 실패 시 null. */
function toBudget(v: unknown): number | null {
  if (v == null) return null;
  const digits = String(v).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

interface MappedBid {
  externalId: string;
  orgName: string | null;
  title: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  method: string | null;
  workType: string | null;
  category: string | null;
  url: string | null;
  raw: Record<string, unknown>;
}

function mapItem(item: Record<string, unknown>, fm: FieldMapping): MappedBid {
  // "=값" 은 상수 — 응답에 해당 필드가 없는 오퍼레이션(예: 용역 전용 조회의 업무구분)에 사용.
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
    orgName: pick("org_name"),
    title: pick("title"),
    budget: fm.budget ? toBudget(getNestedValue(item, fm.budget)) : null,
    postedAt: pick("posted_at"),
    deadline: pick("deadline"),
    method: pick("method"),
    workType: pick("work_type"),
    category: pick("category"),
    url,
    raw: item,
  };
}

export interface InsertedBid extends Omit<MappedBid, "raw"> {
  bidId: string;
}

export interface BidCollectResult {
  scanned: number;
  inserted: number;
  /** 기존 건 갱신 수(재수집 시 field_mapping 수정분 반영). */
  updated: number;
  bidType: BidType;
  samples?: Array<Omit<MappedBid, "raw">>;
  /** 이번 실행에서 신규 적재된 건 상세(raw 제외) — 사업분야 매칭 알림 훅용. */
  insertedItems?: InsertedBid[];
  error?: string;
  logs?: string[];
}

export interface BidCollectOpts {
  preview?: boolean;
}

export async function collectBidSource(
  source: ScraperSourceRow,
  endpoint: ScraperEndpointRow,
  opts: BidCollectOpts = {}
): Promise<BidCollectResult> {
  const bidType = ((endpoint.sinkConfig as { bid_type?: BidType } | null)?.bid_type ?? "bid_notice") as BidType;
  const table = TABLE_BY_TYPE[bidType] ?? TABLE_BY_TYPE.bid_notice;
  const result: BidCollectResult = { scanned: 0, inserted: 0, updated: 0, bidType };

  if (!source.apiProfile || !endpoint.apiConfig) {
    return { ...result, error: "api_profile 또는 api_config 가 없습니다." };
  }

  const secret = await getSourceSecret(source.sourceId);
  // bid 는 raw_json 원문 보존이 핵심(첨부 DocUrl/FileNm·연계키·커스텀 열·재매핑) —
  // response_fields 슬림화를 적용하지 않는다(과거 설정이 남아 있어도 무시).
  const cfg = { ...endpoint.apiConfig, response_fields: undefined };
  const run = await runApiCollect(source.apiProfile, cfg, { secret });
  if (run.error && run.items.length === 0) {
    return { ...result, error: run.error, logs: run.logs };
  }
  const items = run.items.filter((it) => !("raw_xml" in it)); // XML 미지원(MVP)
  result.scanned = items.length;
  const fm = endpoint.fieldMapping ?? {};

  if (opts.preview) {
    result.samples = items.slice(0, 20).map((it) => {
      const m = mapItem(it, fm);
      return {
        externalId: m.externalId,
        orgName: m.orgName,
        title: m.title,
        budget: m.budget,
        postedAt: m.postedAt,
        deadline: m.deadline,
        method: m.method,
        workType: m.workType,
        category: m.category,
        url: m.url,
      };
    });
    result.logs = run.logs;
    return result;
  }

  const db = await getDb();
  const seen = new Set(
    rowsToObjects(
      await db.exec(`SELECT external_id FROM ${table} WHERE source_slug = $1`, [source.slug])
    ).map((r) => String(r.external_id))
  );

  const nowIso = new Date().toISOString();
  const insertedItems: InsertedBid[] = [];
  await withDbWrite(async (wdb) => {
    const processed = new Set<string>(); // 이번 실행 내 중복 item 방어
    for (const it of items) {
      const m = mapItem(it, fm);
      if (processed.has(m.externalId)) continue;
      processed.add(m.externalId);
      const isNew = !seen.has(m.externalId);
      const bidId = id("pbid");
      // 재수집 시 field_mapping 수정·원문 변경이 반영되도록 upsert.
      await wdb.run(
        `INSERT INTO ${table}
           (bid_id, source_slug, external_id, org_name, title, budget, posted_at, deadline,
            method, work_type, category, url, raw_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14)
         ON CONFLICT (source_slug, external_id) DO UPDATE SET
           org_name = EXCLUDED.org_name, title = EXCLUDED.title, budget = EXCLUDED.budget,
           posted_at = EXCLUDED.posted_at, deadline = EXCLUDED.deadline, method = EXCLUDED.method,
           work_type = EXCLUDED.work_type, category = EXCLUDED.category, url = EXCLUDED.url,
           raw_json = EXCLUDED.raw_json, updated_at = EXCLUDED.updated_at`,
        [
          bidId, source.slug, m.externalId, m.orgName, m.title, m.budget, m.postedAt, m.deadline,
          m.method, m.workType, m.category, m.url, JSON.stringify(m.raw), nowIso,
        ]
      );
      if (isNew) {
        seen.add(m.externalId);
        result.inserted++;
        const { raw: _raw, ...rest } = m;
        insertedItems.push({ ...rest, bidId });
      } else {
        result.updated++;
      }
    }
    await wdb.run(
      `INSERT INTO intel_collect_state (source, last_run_at, last_cursor, updated_at)
       VALUES ($1,$2,$2,$2)
       ON CONFLICT (source) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [`bid:${source.slug}`, nowIso]
    );
  });

  result.insertedItems = insertedItems;
  result.logs = run.logs;
  return result;
}
