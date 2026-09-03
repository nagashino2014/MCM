/**
 * AI API 관리 설정(ai_settings, 217) — intel-settings 관례의 kv(jsonb).
 * 기본값은 여기 DEFAULTS, DB 에는 오버라이드만 저장한다. 게이트웨이가 호출마다 읽으므로 30초 메모리 캐시.
 * - featureModelOverrides: 기능별 적용 모델(블루프린트 §3.6). 해석 우선순위 = 오버라이드 → 호출부 지정(env) → 코드 기본.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import type { AiFeatureKey } from "./features";

export interface AiSettings {
  featureModelOverrides: Record<string, string>;
  usdKrwRate: number | null;
  forecastWindowDays: number;
  /** 단건 고비용 경고 임계(USD). null/0 이면 끔. */
  singleCallAlertUsd: number | null;
}

export const AI_SETTINGS_DEFAULTS: AiSettings = {
  featureModelOverrides: {},
  usdKrwRate: null,
  forecastWindowDays: 7,
  singleCallAlertUsd: 1,
};

const KEY_MAP: Record<keyof AiSettings, string> = {
  featureModelOverrides: "feature_model_overrides",
  usdKrwRate: "usd_krw_rate",
  forecastWindowDays: "forecast_window_days",
  singleCallAlertUsd: "single_call_alert_usd",
};

const CACHE_TTL_MS = 30 * 1000;
let cache: { at: number; value: AiSettings } | null = null;
let warnedOnce = false;

function coerce(settings: AiSettings, key: string, json: unknown): void {
  switch (key) {
    case "feature_model_overrides": {
      const out: Record<string, string> = {};
      if (json && typeof json === "object") {
        for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
          if (typeof v === "string" && v.trim()) out[k] = v.trim();
        }
      }
      settings.featureModelOverrides = out;
      break;
    }
    case "usd_krw_rate": {
      const n = Number(json);
      settings.usdKrwRate = Number.isFinite(n) && n > 0 ? n : null;
      break;
    }
    case "forecast_window_days": {
      const n = Number(json);
      settings.forecastWindowDays = Number.isInteger(n) && n >= 1 && n <= 31 ? n : AI_SETTINGS_DEFAULTS.forecastWindowDays;
      break;
    }
    case "single_call_alert_usd": {
      const n = json == null ? null : Number(json);
      settings.singleCallAlertUsd = n != null && Number.isFinite(n) && n > 0 ? n : null;
      break;
    }
    default:
      break;
  }
}

/** 설정 로드(DB 오버라이드 + 기본값). 실패해도 기본값을 돌려준다. */
export async function loadAiSettings(opts?: { fresh?: boolean }): Promise<AiSettings> {
  const now = Date.now();
  if (!opts?.fresh && cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value: AiSettings = { ...AI_SETTINGS_DEFAULTS, featureModelOverrides: {} };
  try {
    const db = await getDb();
    const rows = rowsToObjects(await db.exec("SELECT setting_key, setting_json FROM ai_settings"));
    for (const r of rows) coerce(value, String(r.setting_key), r.setting_json);
  } catch (e) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(`[ai-settings] 조회 실패 — 기본값 사용: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  cache = { at: now, value };
  return value;
}

export function invalidateAiSettingsCache(): void {
  cache = null;
}

/** 기능의 관리 화면 오버라이드 모델(없으면 null). 게이트웨이 호출 경로 — 절대 throw 하지 않는다. */
export async function getFeatureModelOverride(feature: AiFeatureKey): Promise<string | null> {
  try {
    const s = await loadAiSettings();
    return s.featureModelOverrides[feature] ?? null;
  } catch {
    return null;
  }
}

/**
 * 설정 1건 저장 + audit_log(target_table=ai_settings) 기록. 값 null 이면 삭제(기본값 복귀).
 * 되돌리기용으로 before/after 를 남긴다.
 */
export async function saveAiSetting(
  key: keyof AiSettings,
  json: unknown | null,
  actorUserId: string | null
): Promise<void> {
  const settingKey = KEY_MAP[key];
  await withDbWrite(async (db) => {
    const prev = rowsToObjects(await db.exec("SELECT setting_json FROM ai_settings WHERE setting_key = $1", [settingKey]));
    const before = prev.length ? prev[0].setting_json : null;
    if (json == null) {
      await db.run("DELETE FROM ai_settings WHERE setting_key = $1", [settingKey]);
    } else {
      await db.run(
        `INSERT INTO ai_settings (setting_key, setting_json, updated_at, updated_by)
         VALUES ($1, $2::jsonb, $3, $4)
         ON CONFLICT (setting_key) DO UPDATE SET setting_json = EXCLUDED.setting_json, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
        [settingKey, JSON.stringify(json), new Date().toISOString(), actorUserId]
      );
    }
    await recordAuditLogInline(db, {
      actorUserId,
      action: "ai_settings_change",
      targetTable: "ai_settings",
      targetId: settingKey,
      before,
      after: json,
    });
  });
  invalidateAiSettingsCache();
}

/** 기능별 모델 오버라이드 1건 갱신(model=null 이면 해제). */
export async function setFeatureModelOverride(
  feature: AiFeatureKey,
  model: string | null,
  actorUserId: string | null
): Promise<Record<string, string>> {
  const current = await loadAiSettings({ fresh: true });
  const next = { ...current.featureModelOverrides };
  if (model && model.trim()) next[feature] = model.trim();
  else delete next[feature];
  await saveAiSetting("featureModelOverrides", Object.keys(next).length ? next : null, actorUserId);
  return next;
}
