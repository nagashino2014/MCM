/**
 * 범용 스크래퍼 소스/엔드포인트 저장 계층 (scraper_sources / scraper_endpoints).
 * sink 무관 — 소스 정의(api_profile)와 엔드포인트(api_config/field_mapping/sink_config) CRUD만 담당.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { TICK_CACHE_BID_COLLECTORS, invalidateTickCache } from "@/lib/tick-cache";
import { decryptSecret, encryptSecret } from "./secret-crypto";
import type {
  ApiConfig,
  ApiProfile,
  FieldMapping,
  IntelSinkConfig,
  ScraperEndpointRow,
  ScraperPurpose,
  ScraperSourceRow,
  SourceCatalog,
} from "./types";

function parseJson<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

function mapSource(r: Record<string, unknown>): ScraperSourceRow {
  return {
    sourceId: String(r.source_id),
    slug: String(r.slug),
    name: String(r.name),
    baseUrl: r.base_url != null ? String(r.base_url) : null,
    purpose: (String(r.purpose ?? "intel") as ScraperPurpose),
    apiProfile: parseJson<ApiProfile>(r.api_profile),
    catalog: parseJson<SourceCatalog>(r.catalog),
    enabled: Number(r.enabled ?? 0) === 1,
    hasSecret: !!r.auth_secret_enc, // 값은 미포함 — 존재 여부만
    batchHour: r.batch_hour == null ? null : Number(r.batch_hour),
    lastBatchDate: r.last_batch_date != null ? String(r.last_batch_date) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    updatedBy: r.updated_by != null ? String(r.updated_by) : null,
  };
}

function mapEndpoint(r: Record<string, unknown>): ScraperEndpointRow {
  return {
    endpointId: String(r.endpoint_id),
    sourceId: String(r.source_id),
    name: String(r.name),
    apiConfig: parseJson<ApiConfig>(r.api_config),
    fieldMapping: parseJson<FieldMapping>(r.field_mapping) ?? {},
    sinkConfig: parseJson<IntelSinkConfig>(r.sink_config),
    backfill: parseJson<Record<string, unknown>>(r.backfill),
    enabled: Number(r.enabled ?? 0) === 1,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

const slugify = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "src";

// ── 소스 ──────────────────────────────────────────
export async function listSources(purpose?: ScraperPurpose): Promise<ScraperSourceRow[]> {
  const db = await getDb();
  const rows = purpose
    ? rowsToObjects(
        await db.exec("SELECT * FROM scraper_sources WHERE purpose = $1 ORDER BY created_at DESC", [purpose])
      )
    : rowsToObjects(await db.exec("SELECT * FROM scraper_sources ORDER BY created_at DESC"));
  return rows.map(mapSource);
}

export async function getSource(sourceId: string): Promise<ScraperSourceRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM scraper_sources WHERE source_id = $1", [sourceId])
  );
  return rows.length ? mapSource(rows[0]) : null;
}

export async function createSource(input: {
  name: string;
  baseUrl?: string | null;
  purpose?: ScraperPurpose;
  slug?: string;
  authSecret?: string;
  updatedBy: string | null;
}): Promise<ScraperSourceRow> {
  const now = new Date().toISOString();
  const sourceId = "ssrc_" + crypto.randomBytes(7).toString("hex");
  // 한글만인 소스명은 slugify 결과가 폴백('src')이 되어 UNIQUE 충돌 → sourceId hex 접미로 유니크 보장.
  let slug = slugify(input.slug || input.name);
  if (slug === "src") slug = "src" + sourceId.slice(5, 11);
  const enc = input.authSecret?.trim() ? encryptSecret(input.authSecret.trim()) : null;
  return withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO scraper_sources (source_id, slug, name, base_url, purpose, auth_secret_enc, enabled, created_at, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, $8)`,
      [sourceId, slug, input.name.trim(), input.baseUrl || null, input.purpose || "intel", enc, now, input.updatedBy]
    );
    const rows = rowsToObjects(
      await db.exec("SELECT * FROM scraper_sources WHERE source_id = $1", [sourceId])
    );
    return mapSource(rows[0]);
  });
}

export async function updateSource(
  sourceId: string,
  patch: {
    name?: string;
    baseUrl?: string | null;
    apiProfile?: ApiProfile | null;
    /** 가이드 분석 카탈로그(073). null=삭제. */
    catalog?: SourceCatalog | null;
    enabled?: boolean;
    /** 배치 실행 시각(KST 0~23). null=기본값으로 되돌림. */
    batchHour?: number | null;
    /** 인증키: non-empty=암호화 저장, null=삭제, ""/undefined=변경 안함. */
    authSecret?: string | null;
  },
  updatedBy: string | null
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v);
  };
  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.baseUrl !== undefined) push("base_url", patch.baseUrl || null);
  if (patch.apiProfile !== undefined) {
    sets.push(`api_profile = $${vals.length + 1}::jsonb`);
    vals.push(patch.apiProfile ? JSON.stringify(patch.apiProfile) : null);
  }
  if (patch.catalog !== undefined) {
    sets.push(`catalog = $${vals.length + 1}::jsonb`);
    vals.push(patch.catalog ? JSON.stringify(patch.catalog) : null);
  }
  if (patch.enabled !== undefined) push("enabled", patch.enabled ? 1 : 0);
  if (patch.batchHour !== undefined) {
    const h = patch.batchHour;
    push("batch_hour", h == null || !Number.isFinite(h) ? null : Math.min(23, Math.max(0, Math.trunc(h))));
  }
  if (patch.authSecret !== undefined) {
    if (patch.authSecret === null) push("auth_secret_enc", null);
    else if (patch.authSecret.trim()) push("auth_secret_enc", encryptSecret(patch.authSecret.trim()));
    // 빈 문자열은 기존 키 유지(변경 없음)
  }
  if (sets.length === 0) return;
  push("updated_at", new Date().toISOString());
  push("updated_by", updatedBy);
  vals.push(sourceId);
  await withDbWrite(async (db) => {
    await db.run(`UPDATE scraper_sources SET ${sets.join(", ")} WHERE source_id = $${vals.length}`, vals);
  });
  invalidateTickCache(TICK_CACHE_BID_COLLECTORS); // enabled·batch_hour 변경이 수집 틱에 바로 반영되도록
}

/** 실행(수집/미리보기) 시점 전용 — 저장된 인증키를 복호화해 반환. 응답에는 절대 노출 금지. */
export async function getSourceSecret(sourceId: string): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT auth_secret_enc FROM scraper_sources WHERE source_id = $1", [sourceId])
  );
  return decryptSecret(rows[0]?.auth_secret_enc as string | undefined);
}

export async function deleteSource(sourceId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM scraper_sources WHERE source_id = $1", [sourceId]); // endpoints CASCADE
  });
  invalidateTickCache(TICK_CACHE_BID_COLLECTORS);
}

// ── 엔드포인트 ────────────────────────────────────
export async function listEndpoints(sourceId: string): Promise<ScraperEndpointRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM scraper_endpoints WHERE source_id = $1 ORDER BY created_at ASC", [sourceId])
  );
  return rows.map(mapEndpoint);
}

export async function getEndpoint(endpointId: string): Promise<ScraperEndpointRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM scraper_endpoints WHERE endpoint_id = $1", [endpointId])
  );
  return rows.length ? mapEndpoint(rows[0]) : null;
}

export async function createEndpoint(input: {
  sourceId: string;
  name: string;
  apiConfig?: ApiConfig | null;
  fieldMapping?: FieldMapping;
  sinkConfig?: IntelSinkConfig | null;
}): Promise<ScraperEndpointRow> {
  const now = new Date().toISOString();
  const endpointId = "sep_" + crypto.randomBytes(7).toString("hex");
  return withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO scraper_endpoints (endpoint_id, source_id, name, api_config, field_mapping, sink_config, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, 0, $7, $7)`,
      [
        endpointId,
        input.sourceId,
        input.name.trim(),
        input.apiConfig ? JSON.stringify(input.apiConfig) : null,
        JSON.stringify(input.fieldMapping ?? {}),
        input.sinkConfig ? JSON.stringify(input.sinkConfig) : null,
        now,
      ]
    );
    const rows = rowsToObjects(
      await db.exec("SELECT * FROM scraper_endpoints WHERE endpoint_id = $1", [endpointId])
    );
    return mapEndpoint(rows[0]);
  });
}

export async function updateEndpoint(
  endpointId: string,
  patch: {
    name?: string;
    apiConfig?: ApiConfig | null;
    fieldMapping?: FieldMapping;
    sinkConfig?: IntelSinkConfig | null;
    /** 백필 상태(075). null=초기화. */
    backfill?: Record<string, unknown> | null;
    enabled?: boolean;
  }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const pushJson = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}::jsonb`);
    vals.push(v == null ? null : JSON.stringify(v));
  };
  if (patch.name !== undefined) {
    sets.push(`name = $${vals.length + 1}`);
    vals.push(patch.name.trim());
  }
  if (patch.apiConfig !== undefined) pushJson("api_config", patch.apiConfig);
  if (patch.fieldMapping !== undefined) pushJson("field_mapping", patch.fieldMapping ?? {});
  if (patch.sinkConfig !== undefined) pushJson("sink_config", patch.sinkConfig);
  if (patch.backfill !== undefined) pushJson("backfill", patch.backfill);
  if (patch.enabled !== undefined) {
    sets.push(`enabled = $${vals.length + 1}`);
    vals.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = $${vals.length + 1}`);
  vals.push(new Date().toISOString());
  vals.push(endpointId);
  await withDbWrite(async (db) => {
    await db.run(`UPDATE scraper_endpoints SET ${sets.join(", ")} WHERE endpoint_id = $${vals.length}`, vals);
  });
  invalidateTickCache(TICK_CACHE_BID_COLLECTORS);
}

export async function deleteEndpoint(endpointId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM scraper_endpoints WHERE endpoint_id = $1", [endpointId]);
  });
  invalidateTickCache(TICK_CACHE_BID_COLLECTORS);
}

/** 야간 배치·수동 실행용 — 활성 소스×활성 엔드포인트 조합. purpose로 sink 필터. */
export async function listEnabledCustomCollectors(
  db: PgDatabase,
  purpose: ScraperPurpose
): Promise<{ source: ScraperSourceRow; endpoint: ScraperEndpointRow }[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.* , s.source_id AS s_source_id, s.slug AS s_slug, s.name AS s_name,
              s.base_url AS s_base_url, s.purpose AS s_purpose, s.api_profile AS s_api_profile,
              s.enabled AS s_enabled, s.batch_hour AS s_batch_hour, s.last_batch_date AS s_last_batch_date,
              s.created_at AS s_created_at, s.updated_at AS s_updated_at, s.updated_by AS s_updated_by
         FROM scraper_endpoints e
         JOIN scraper_sources s ON s.source_id = e.source_id
        WHERE s.enabled = 1 AND e.enabled = 1 AND s.purpose = $1`,
      [purpose]
    )
  );
  return rows.map((r) => ({
    source: mapSource({
      source_id: r.s_source_id,
      slug: r.s_slug,
      name: r.s_name,
      base_url: r.s_base_url,
      purpose: r.s_purpose,
      api_profile: r.s_api_profile,
      enabled: r.s_enabled,
      batch_hour: r.s_batch_hour,
      last_batch_date: r.s_last_batch_date,
      created_at: r.s_created_at,
      updated_at: r.s_updated_at,
      updated_by: r.s_updated_by,
    }),
    endpoint: mapEndpoint(r),
  }));
}

/** 배치 실행 시각 기본값(KST) — 나라장터 등 공공 API가 새벽 점검으로 무응답인 사례 대응. */
export const DEFAULT_BATCH_HOUR = 7;

/** 소스의 마지막 배치 수집일(KST) 기록 — 하루 1회 멱등 판정용. */
export async function markSourceBatchRun(sourceId: string, kstDate: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE scraper_sources SET last_batch_date = $1 WHERE source_id = $2`, [kstDate, sourceId]);
  });
  // 오늘 수집 완료를 캐시에도 반영 — 남은 배치 시각 동안 틱이 DB 를 다시 열지 않는다.
  invalidateTickCache(TICK_CACHE_BID_COLLECTORS);
}
