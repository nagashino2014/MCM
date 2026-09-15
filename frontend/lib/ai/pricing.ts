/**
 * Claude 모델 단가(USD / 1M 토큰) — 호출당 비용 산출(블루프린트 §3.2, P0).
 * - 1차 소스: DB `ai_model_prices`(216, 관리 화면에서 편집) → 5분 메모리 캐시.
 * - DB 미적용·조회 실패 시 아래 상수로 폴백한다(계측이 단가표 때문에 멈추면 안 된다).
 * - 모델 ID 는 날짜 접미사를 뗀 정규형(claude-haiku-4-5-20251001 → claude-haiku-4-5)으로 매핑한다.
 */
import { getDb, rowsToObjects } from "@/lib/db";

export interface ModelPrice {
  inputPerMtok: number;
  cacheWritePerMtok: number;
  cacheReadPerMtok: number;
  outputPerMtok: number;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** 2026-06 공시 단가. 캐시 쓰기=입력×1.25, 캐시 읽기=입력×0.1 (Fable 5.1 은 읽기 $0.25 고정). */
const FALLBACK_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerMtok: 1, cacheWritePerMtok: 1.25, cacheReadPerMtok: 0.1, outputPerMtok: 5 },
  "claude-sonnet-4-6": { inputPerMtok: 3, cacheWritePerMtok: 3.75, cacheReadPerMtok: 0.3, outputPerMtok: 15 },
  "claude-sonnet-5": { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10 },
  "claude-opus-4-6": { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25 },
  "claude-opus-4-7": { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25 },
  "claude-opus-4-8": { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25 },
  "claude-opus-5": { inputPerMtok: 5, cacheWritePerMtok: 6.25, cacheReadPerMtok: 0.5, outputPerMtok: 25 },
  "claude-fable-5-1": { inputPerMtok: 10, cacheWritePerMtok: 12.5, cacheReadPerMtok: 0.25, outputPerMtok: 50 },
};

/** `claude-haiku-4-5-20251001` → `claude-haiku-4-5`. 이미 정규형이면 그대로. */
export function normalizeModelFamily(model: string): string {
  return model.trim().replace(/-\d{8}$/, "");
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; prices: Record<string, ModelPrice> } | null = null;
let warnedOnce = false;

async function loadPricesFromDb(): Promise<Record<string, ModelPrice>> {
  const db = await getDb();
  // 모델별 최신 적용일 행만 — 적용일이 미래인 행은 제외.
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (model_family) model_family, input_per_mtok, cache_write_per_mtok, cache_read_per_mtok, output_per_mtok
         FROM ai_model_prices
        WHERE effective_from <= CURRENT_DATE
        ORDER BY model_family, effective_from DESC`
    )
  );
  const out: Record<string, ModelPrice> = {};
  for (const r of rows) {
    out[String(r.model_family)] = {
      inputPerMtok: Number(r.input_per_mtok),
      cacheWritePerMtok: Number(r.cache_write_per_mtok),
      cacheReadPerMtok: Number(r.cache_read_per_mtok),
      outputPerMtok: Number(r.output_per_mtok),
    };
  }
  return out;
}

/** 단가표(DB 우선, 폴백 병합). 실패해도 throw 하지 않는다. */
export async function getModelPrices(): Promise<Record<string, ModelPrice>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.prices;
  let fromDb: Record<string, ModelPrice> = {};
  try {
    fromDb = await loadPricesFromDb();
  } catch (e) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(`[ai-pricing] ai_model_prices 조회 실패 — 상수 단가로 폴백: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const prices = { ...FALLBACK_PRICES, ...fromDb };
  cache = { at: now, prices };
  return prices;
}

/** 캐시 무효화(단가표 편집 후 호출). */
export function invalidateModelPriceCache(): void {
  cache = null;
}

// ── 관리 화면용 CRUD(P1) ─────────────────────────────────────────────────

export interface ModelPriceRow extends ModelPrice {
  modelFamily: string;
  effectiveFrom: string;
  displayName: string;
  supportsVision: boolean;
  contextTokens: number;
  selectable: boolean;
  deprecatedAt: string | null;
  note: string | null;
  updatedAt: string;
}

function toRow(r: Record<string, unknown>): ModelPriceRow {
  return {
    modelFamily: String(r.model_family),
    effectiveFrom: String(r.effective_from).slice(0, 10),
    displayName: String(r.display_name ?? r.model_family),
    inputPerMtok: Number(r.input_per_mtok),
    cacheWritePerMtok: Number(r.cache_write_per_mtok),
    cacheReadPerMtok: Number(r.cache_read_per_mtok),
    outputPerMtok: Number(r.output_per_mtok),
    supportsVision: Number(r.supports_vision ?? 1) === 1,
    contextTokens: Number(r.context_tokens ?? 200000),
    selectable: Number(r.selectable ?? 1) === 1,
    deprecatedAt: r.deprecated_at != null ? String(r.deprecated_at).slice(0, 10) : null,
    note: r.note != null ? String(r.note) : null,
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** 모델별 현재 단가 행(적용일 최신). 관리 화면 단가표·모델 셀렉트 후보. */
export async function listCurrentModelPrices(): Promise<ModelPriceRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (model_family) *
         FROM ai_model_prices
        WHERE effective_from <= CURRENT_DATE
        ORDER BY model_family, effective_from DESC`
    )
  );
  return rows.map(toRow).sort((a, b) => a.inputPerMtok - b.inputPerMtok || a.modelFamily.localeCompare(b.modelFamily));
}

/** 단가 이력(모델별 적용일 전부). */
export async function listModelPriceHistory(modelFamily: string): Promise<ModelPriceRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM ai_model_prices WHERE model_family = $1 ORDER BY effective_from DESC", [modelFamily])
  );
  return rows.map(toRow);
}

export interface ModelPriceInput {
  modelFamily: string;
  effectiveFrom: string;
  displayName: string;
  inputPerMtok: number;
  cacheWritePerMtok: number;
  cacheReadPerMtok: number;
  outputPerMtok: number;
  supportsVision: boolean;
  contextTokens: number;
  selectable: boolean;
  deprecatedAt?: string | null;
  note?: string | null;
}

/** (model_family, effective_from) 단위 upsert. 호출 후 캐시를 비운다. 감사 기록은 라우트가 남긴다. */
export async function upsertModelPrice(input: ModelPriceInput): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO ai_model_prices
       (model_family, effective_from, display_name, input_per_mtok, cache_write_per_mtok, cache_read_per_mtok, output_per_mtok,
        supports_vision, context_tokens, selectable, deprecated_at, note, updated_at)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13)
     ON CONFLICT (model_family, effective_from) DO UPDATE SET
       display_name = EXCLUDED.display_name, input_per_mtok = EXCLUDED.input_per_mtok,
       cache_write_per_mtok = EXCLUDED.cache_write_per_mtok, cache_read_per_mtok = EXCLUDED.cache_read_per_mtok,
       output_per_mtok = EXCLUDED.output_per_mtok, supports_vision = EXCLUDED.supports_vision,
       context_tokens = EXCLUDED.context_tokens, selectable = EXCLUDED.selectable,
       deprecated_at = EXCLUDED.deprecated_at, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
    [
      normalizeModelFamily(input.modelFamily),
      input.effectiveFrom,
      input.displayName,
      input.inputPerMtok,
      input.cacheWritePerMtok,
      input.cacheReadPerMtok,
      input.outputPerMtok,
      input.supportsVision ? 1 : 0,
      input.contextTokens,
      input.selectable ? 1 : 0,
      input.deprecatedAt ?? null,
      input.note ?? null,
      new Date().toISOString(),
    ]
  );
  invalidateModelPriceCache();
}

/** usage → USD. 단가를 모르는 모델이면 null(로그에는 토큰만 남고 비용은 화면에서 '단가 미등록' 표기). */
export function computeCostUsd(usage: ClaudeUsage, price: ModelPrice | undefined): number | null {
  if (!price) return null;
  const inTok = Math.max(0, usage.input_tokens ?? 0);
  const cw = Math.max(0, usage.cache_creation_input_tokens ?? 0);
  const cr = Math.max(0, usage.cache_read_input_tokens ?? 0);
  const out = Math.max(0, usage.output_tokens ?? 0);
  const usd =
    (inTok * price.inputPerMtok + cw * price.cacheWritePerMtok + cr * price.cacheReadPerMtok + out * price.outputPerMtok) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
