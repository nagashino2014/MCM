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

export interface HomeSettings {
  layout: HomeLayout;
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
  calendarRefs: [],
  calendarTags: ["self", "sales"],
};

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
      `SELECT layout, calendar_refs, calendar_tags FROM home_layouts WHERE user_id = $1`,
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
    calendarRefs: refs.filter((r) => typeof r === "string").slice(0, MAX_REFS),
    calendarTags: tags.filter((t): t is CalendarTagKey => TAG_KEYS.includes(t)),
    available,
  };
}

export async function saveHomeSettings(userId: string, input: Partial<HomeSettings>): Promise<void> {
  const current = await loadHomeSettings(userId);
  const next: HomeSettings = {
    layout: input.layout ? normalizeLayout(input.layout) : current.layout,
    calendarRefs: input.calendarRefs
      ? input.calendarRefs.filter((r) => typeof r === "string").slice(0, MAX_REFS)
      : current.calendarRefs,
    calendarTags: input.calendarTags
      ? input.calendarTags.filter((t): t is CalendarTagKey => TAG_KEYS.includes(t))
      : current.calendarTags,
  };

  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO home_layouts (user_id, layout, calendar_refs, calendar_tags, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET layout = EXCLUDED.layout,
             calendar_refs = EXCLUDED.calendar_refs,
             calendar_tags = EXCLUDED.calendar_tags,
             updated_at = EXCLUDED.updated_at`,
      [
        userId,
        JSON.stringify(next.layout),
        JSON.stringify(next.calendarRefs),
        JSON.stringify(next.calendarTags),
        new Date().toISOString(),
      ]
    );
  });
}
