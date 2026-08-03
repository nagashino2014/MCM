// 홈 화면 사용자 설정(HC-B) 서버 로직 — 레이아웃 로드/저장 + 권한 기반 가용 위젯 판정.
// 권한이 없는 위젯은 편집 목록에도 노출되지 않아야 하므로(요구사항), 서버에서 걸러 내려준다.
// 저장 테이블: home_layouts (infra/aws/112_home_layout.sql)

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import {
  CALENDAR_TAGS,
  HOME_WIDGETS,
  normalizeLayout,
  type CalendarTagKey,
  type HomeLayout,
} from "@/lib/home/widgets";

const TAG_KEYS = CALENDAR_TAGS.map((t) => t.key) as readonly string[];
const MAX_REFS = 10;

/** 배치 프리셋 슬롯(1~3). 빈 슬롯은 키 없음. */
export type HomePresets = Partial<Record<"1" | "2" | "3", HomeLayout>>;

export interface HomeSettings {
  layout: HomeLayout;
  /** 배치 프리셋 3슬롯(126) — 표시 카드+위치·크기를 통째로 저장해 두고 바로 전환. */
  presets: HomePresets;
  /** 캘린더 '선택' 태그로 표시할 인원(참조 지정). */
  calendarRefs: string[];
  /** 켜둔 캘린더 태그. */
  calendarTags: CalendarTagKey[];
}

export interface HomeSettingsWithCatalog extends HomeSettings {
  /** 이 사용자가 열람 가능한 위젯만(권한 필터링 후). */
  available: Array<{ key: string; label: string }>;
}

const DEFAULTS: HomeSettings = {
  layout: { hidden: [], items: {} },
  presets: {},
  calendarRefs: [],
  calendarTags: ["self", "sales"],
};

const PRESET_SLOTS = ["1", "2", "3"] as const;

/** 프리셋 정규화 — 슬롯 1~3만, 각 슬롯은 normalizeLayout 을 통과시킨다. */
function normalizePresets(raw: unknown): HomePresets {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: HomePresets = {};
  for (const slot of PRESET_SLOTS) {
    if (src[slot] && typeof src[slot] === "object") out[slot] = normalizeLayout(src[slot]);
  }
  return out;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

/** 권한 템플릿으로 이 사용자가 볼 수 있는 위젯만 추린다. */
export async function availableWidgets(userId: string): Promise<Array<{ key: string; label: string }>> {
  const checks = await Promise.all(
    HOME_WIDGETS.map(async (w) => (w.permission ? hasPermission(userId, w.permission) : true))
  );
  return HOME_WIDGETS.filter((_, i) => checks[i]).map((w) => ({ key: w.key, label: w.label }));
}

export async function loadHomeSettings(userId: string): Promise<HomeSettingsWithCatalog> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT layout, presets, calendar_refs, calendar_tags FROM home_layouts WHERE user_id = $1`,
      [userId]
    )
  );
  const available = await availableWidgets(userId);
  if (rows.length === 0) return { ...DEFAULTS, available };

  const row = rows[0];
  const tags = parseJson<string[]>(row.calendar_tags, DEFAULTS.calendarTags);
  const refs = parseJson<string[]>(row.calendar_refs, []);
  return {
    layout: normalizeLayout(parseJson(row.layout, {})),
    presets: normalizePresets(parseJson(row.presets, {})),
    calendarRefs: refs.filter((r) => typeof r === "string").slice(0, MAX_REFS),
    calendarTags: tags.filter((t): t is CalendarTagKey => TAG_KEYS.includes(t)),
    available,
  };
}

export async function saveHomeSettings(userId: string, input: Partial<HomeSettings>): Promise<void> {
  const current = await loadHomeSettings(userId);
  const next: HomeSettings = {
    layout: input.layout ? normalizeLayout(input.layout) : current.layout,
    presets: input.presets ? normalizePresets(input.presets) : current.presets,
    calendarRefs: input.calendarRefs
      ? input.calendarRefs.filter((r) => typeof r === "string").slice(0, MAX_REFS)
      : current.calendarRefs,
    calendarTags: input.calendarTags
      ? input.calendarTags.filter((t): t is CalendarTagKey => TAG_KEYS.includes(t))
      : current.calendarTags,
  };

  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO home_layouts (user_id, layout, presets, calendar_refs, calendar_tags, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET layout = EXCLUDED.layout,
             presets = EXCLUDED.presets,
             calendar_refs = EXCLUDED.calendar_refs,
             calendar_tags = EXCLUDED.calendar_tags,
             updated_at = EXCLUDED.updated_at`,
      [
        userId,
        JSON.stringify(next.layout),
        JSON.stringify(next.presets),
        JSON.stringify(next.calendarRefs),
        JSON.stringify(next.calendarTags),
        new Date().toISOString(),
      ]
    );
  });
}
