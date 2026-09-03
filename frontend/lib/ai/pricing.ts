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
