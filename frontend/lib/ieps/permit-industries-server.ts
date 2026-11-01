// 통합허가 대상 업종 — 서버 조회·캐시·편집(permit_industries, 325). 관리 화면: /admin/permit-industries.
// 형식·판정 함수는 lib/ieps/integrated-permit-industries.ts(클라이언트 공용). 이 파일은 DB 를 쓰므로 서버 전용.
//
// 캐시: 인스턴스별 60초. 편집 API 는 같은 인스턴스 캐시를 즉시 비우고, 다른 인스턴스(ECS 태스크 여러 개·야간 배치)는
// 최대 60초 뒤 반영된다. 표가 없으면(325 적용 전) DEFAULT_PERMIT_INDUSTRIES 로 동작한다.
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import {
  DEFAULT_PERMIT_INDUSTRIES,
  cleanPermitCodeList,
  cleanPermitTextList,
  setPermitIndustriesSnapshot,
  type IntegratedPermitIndustry,
} from "@/lib/ieps/integrated-permit-industries";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; list: IntegratedPermitIndustry[]; fromTable: boolean } | null = null;

function jsonList(value: unknown): string[] {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "")).filter(Boolean) : [];
}

function rowToIndustry(row: Record<string, unknown>): IntegratedPermitIndustry {
  return {
    id: String(row.industry_id ?? ""),
    label: String(row.label ?? ""),
    exactCodes: jsonList(row.exact_codes),
    prefixCodes: jsonList(row.prefix_codes),
    keywords: jsonList(row.keywords),
    aliases: jsonList(row.aliases),
    note: row.note == null ? null : String(row.note),
    sortOrder: Number(row.sort_order ?? 0),
    active: row.active === true || row.active === "t" || row.active === 1,
  };
}

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

/** 전체 업종(사용 중지 포함, 순서대로). 선택 목록·KSIC 분류에는 activePermitIndustries() 로 거른다. */
export async function loadPermitIndustries(db?: PgDatabase): Promise<IntegratedPermitIndustry[]> {
  return (await loadPermitIndustriesWithSource(db)).list;
}

/** fromTable=false 면 325 미적용(기본값 사용 중) — 관리 화면이 편집을 막고 안내한다. */
export async function loadPermitIndustriesWithSource(
  db?: PgDatabase
): Promise<{ list: IntegratedPermitIndustry[]; fromTable: boolean }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { list: cache.list, fromTable: cache.fromTable };
  try {
    const handle = db ?? (await getDb());
    const rows = rowsToObjects(
      await handle.exec(
        `SELECT industry_id, label, exact_codes, prefix_codes, keywords, aliases, note, sort_order, active
           FROM permit_industries
          ORDER BY sort_order ASC, label ASC`
      )
    );
    const list = rows.map(rowToIndustry).filter((entry) => entry.id && entry.label);
    // 표는 있는데 비어 있으면(시드 전) 기본값을 쓴다 — 분류가 통째로 사라지지 않게
    const fromTable = list.length > 0;
    cache = { at: Date.now(), list: fromTable ? list : DEFAULT_PERMIT_INDUSTRIES, fromTable };
  } catch (err) {
    if (!isMissingTable(err)) console.error("[permit-industries] load failed", err);
    // 조회 실패는 짧게만 캐시(10초) — 일시 오류가 1분간 기본값으로 굳지 않게
    cache = { at: Date.now() - CACHE_TTL_MS + 10_000, list: DEFAULT_PERMIT_INDUSTRIES, fromTable: false };
  }
  setPermitIndustriesSnapshot(cache.list);
  return { list: cache.list, fromTable: cache.fromTable };
}

export function invalidatePermitIndustriesCache(): void {
  cache = null;
}

/**
 * 업종 하나의 KSIC 판정 SQL 조건(매개변수 방식). codeExpr 는 코드 1개를 내는 SQL 식(예: "TRIM(ic)").
 * 코드가 관리 화면 입력값이므로 문자열로 붙여 넣지 않는다. 코드가 없으면 null.
 */
export function permitIndustryKsicCondition(
  category: IntegratedPermitIndustry,
  params: unknown[],
  codeExpr = "TRIM(ic)"
): string | null {
  const conds: string[] = [];
  for (const code of category.exactCodes) {
    params.push(code);
    conds.push(`${codeExpr} = $${params.length}`);
  }
  for (const prefix of category.prefixCodes) {
    params.push(prefix + "%");
    conds.push(`${codeExpr} LIKE $${params.length}`);
  }
  return conds.length ? conds.join(" OR ") : null;
}

// ── 편집(관리 API 전용) ──────────────────────────────────────────

export interface PermitIndustryInput {
  id?: string;
  label: string;
  exactCodes?: unknown;
  prefixCodes?: unknown;
  keywords?: unknown;
  aliases?: unknown;
  note?: string | null;
  active?: boolean;
}

export class PermitIndustryInputError extends Error {}

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

function normalizeInput(input: PermitIndustryInput) {
  const label = String(input.label ?? "").trim();
  if (!label) throw new PermitIndustryInputError("업종 이름을 입력하세요.");
  if (label.length > 40) throw new PermitIndustryInputError("업종 이름은 40자 이내로 입력하세요.");
  if (label.endsWith("(통합허가)")) throw new PermitIndustryInputError("'(통합허가)' 표시는 계약 업종에서 자동으로 붙습니다. 이름만 입력하세요.");
  return {
    label,
    exactCodes: cleanPermitCodeList(input.exactCodes).filter((c) => c.length === 5),
    prefixCodes: cleanPermitCodeList(input.prefixCodes),
    keywords: cleanPermitTextList(input.keywords),
    aliases: cleanPermitTextList(input.aliases).filter((a) => a !== label),
    note: String(input.note ?? "").trim() || null,
  };
}

/** 새 업종. id 는 영문 소문자·숫자·하이픈(저장 데이터 키, 이후 변경 불가). */
export async function createPermitIndustry(db: PgDatabase, input: PermitIndustryInput, actor: string): Promise<IntegratedPermitIndustry> {
  const id = String(input.id ?? "").trim().toLowerCase();
  if (!ID_RE.test(id)) throw new PermitIndustryInputError("업종 ID 는 영문 소문자로 시작하는 영문·숫자·하이픈 2~41자로 입력하세요(예: data-center).");
  const v = normalizeInput(input);
  const dup = rowsToObjects(
    await db.exec(`SELECT industry_id FROM permit_industries WHERE industry_id = $1 OR label = $2`, [id, v.label])
  );
  if (dup.length) throw new PermitIndustryInputError("같은 ID 또는 이름의 업종이 이미 있습니다(사용 중지된 업종이면 다시 사용으로 바꾸세요).");
  const rows = rowsToObjects(
    await db.exec(
      `INSERT INTO permit_industries (industry_id, label, exact_codes, prefix_codes, keywords, aliases, note, sort_order, active, updated_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7,
               COALESCE((SELECT MAX(sort_order) + 10 FROM permit_industries), 10), true, $8)
       RETURNING industry_id, label, exact_codes, prefix_codes, keywords, aliases, note, sort_order, active`,
      [id, v.label, JSON.stringify(v.exactCodes), JSON.stringify(v.prefixCodes), JSON.stringify(v.keywords),
        JSON.stringify(v.aliases), v.note, actor]
    )
  );
  invalidatePermitIndustriesCache();
  return rowToIndustry(rows[0]);
}

/**
 * 업종 수정. 이름을 바꾸면 옛 이름을 aliases 에 자동으로 남긴다 — 이름으로 저장된 계약 업종('옛이름(통합허가)')·
 * 입찰 실적 필터·회사소개서 수동 실적이 계속 같은 업종으로 읽힌다.
 */
export async function updatePermitIndustry(db: PgDatabase, input: PermitIndustryInput, actor: string): Promise<IntegratedPermitIndustry> {
  const id = String(input.id ?? "").trim();
  const before = rowsToObjects(await db.exec(`SELECT * FROM permit_industries WHERE industry_id = $1`, [id]));
  if (!before.length) throw new PermitIndustryInputError("업종을 찾을 수 없습니다.");
  const prev = rowToIndustry(before[0]);
  const v = normalizeInput(input);
  const dup = rowsToObjects(
    await db.exec(`SELECT industry_id FROM permit_industries WHERE label = $1 AND industry_id <> $2`, [v.label, id])
  );
  if (dup.length) throw new PermitIndustryInputError("같은 이름의 업종이 이미 있습니다.");
  const aliases = prev.label !== v.label ? cleanPermitTextList([...v.aliases, prev.label]).filter((a) => a !== v.label) : v.aliases;
  const rows = rowsToObjects(
    await db.exec(
      `UPDATE permit_industries
          SET label = $2, exact_codes = $3::jsonb, prefix_codes = $4::jsonb, keywords = $5::jsonb, aliases = $6::jsonb,
              note = $7, active = COALESCE($8, active), updated_at = now(), updated_by = $9
        WHERE industry_id = $1
       RETURNING industry_id, label, exact_codes, prefix_codes, keywords, aliases, note, sort_order, active`,
      [id, v.label, JSON.stringify(v.exactCodes), JSON.stringify(v.prefixCodes), JSON.stringify(v.keywords),
        JSON.stringify(aliases), v.note, typeof input.active === "boolean" ? input.active : null, actor]
    )
  );
  invalidatePermitIndustriesCache();
  return rowToIndustry(rows[0]);
}

/** 사용 중지·다시 사용(soft). 지우지 않는다 — 저장 데이터의 id·이름표 보존. */
export async function setPermitIndustryActive(db: PgDatabase, id: string, active: boolean, actor: string): Promise<void> {
  await db.run(
    `UPDATE permit_industries SET active = $2, updated_at = now(), updated_by = $3 WHERE industry_id = $1`,
    [id, active, actor]
  );
  invalidatePermitIndustriesCache();
}

/** 순서 저장 — ids 순서대로 10, 20, 30 … */
export async function reorderPermitIndustries(db: PgDatabase, ids: string[], actor: string): Promise<void> {
  const unique = Array.from(new Set(ids.map((v) => String(v ?? "").trim()).filter(Boolean)));
  for (let i = 0; i < unique.length; i++) {
    await db.run(
      `UPDATE permit_industries SET sort_order = $2, updated_at = now(), updated_by = $3 WHERE industry_id = $1`,
      [unique[i], (i + 1) * 10, actor]
    );
  }
  invalidatePermitIndustriesCache();
}

/** 관리 화면용 — 업종별 KSIC 매칭 사업장 수(사용 중지 포함, 코드 확인용). */
export async function countFacilitiesByPermitIndustry(
  db: PgDatabase,
  list: IntegratedPermitIndustry[]
): Promise<Record<string, number>> {
  const params: unknown[] = [];
  const cols = list.map((cat, i) => {
    const cond = permitIndustryKsicCondition(cat, params);
    if (!cond) return `0::int AS cat_${i}`;
    return `COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM regexp_split_to_table(COALESCE(f.industry_code, ''), '[\\n,/]+') AS ic WHERE ${cond}))::int AS cat_${i}`;
  });
  if (!cols.length) return {};
  const rows = rowsToObjects(
    await db.exec(`SELECT ${cols.join(", ")} FROM facilities f WHERE f.deleted_at IS NULL`, params)
  );
  const row = rows[0] ?? {};
  return Object.fromEntries(list.map((cat, i) => [cat.id, Number(row[`cat_${i}`] ?? 0)]));
}
