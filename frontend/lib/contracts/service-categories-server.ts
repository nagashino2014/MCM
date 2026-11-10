// 계약 용역 대분류·세분류 — 서버 조회·캐시·편집(contract_service_types·contract_service_subtypes, 348).
// 관리 화면: /admin/contract-service-categories. 형식·선택 목록 함수는 lib/contracts/service-categories.ts(클라이언트 공용).
// 이 파일은 DB 를 쓰므로 서버 전용.
//
// 캐시: 인스턴스별 60초. 편집 API 는 같은 인스턴스 캐시를 즉시 비우고, 다른 인스턴스는 최대 60초 뒤 반영된다.
// 표가 없으면(348 적용 전) DEFAULT_CONTRACT_SERVICE_TYPES 로 동작한다.
//
// 이름 변경(2026-11-10 사용자 확정): 분류는 계약·견적·계약서 행에 이름 문자열로 저장되므로, 이름을 바꾸면 같은 트랜잭션에서
// 저장된 옛 이름을 새 이름으로 바꾸고 옛 이름은 aliases 에 남긴다. 삭제는 어디에도 쓰이지 않은 항목만 가능하다.
import { randomUUID } from "node:crypto";
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import {
  DEFAULT_CONTRACT_SERVICE_TYPES,
  setContractServiceSnapshot,
  type ContractServiceSubtype,
  type ContractServiceType,
} from "@/lib/contracts/service-categories";
import { QUOTE_MULTI_SUBTYPE } from "@/lib/quote/types";

const CACHE_TTL_MS = 60_000;
let cache: { at: number; list: ContractServiceType[]; fromTable: boolean } | null = null;

/** 대분류·세분류를 함께 저장하는 표 — 세분류 이름 변경·사용 건수 대상 */
const PAIR_TABLES = ["contracts", "quotations", "quote_rate_sets", "agreement_templates", "contract_agreements"] as const;
/** 대분류만 저장하는 표 — 대분류 이름 변경·사용 건수 대상 */
const TYPE_ONLY_TABLES = ["contract_outsourcing", "process_stage_templates", "process_stage_presets", "agreement_clause_library"] as const;

const TABLE_LABELS: Record<string, string> = {
  contracts: "계약",
  quotations: "견적 대장",
  quote_rate_sets: "견적 단가 세트",
  agreement_templates: "계약서 템플릿",
  contract_agreements: "작성된 계약서",
  contract_outsourcing: "외주",
  process_stage_templates: "공정 단계",
  process_stage_presets: "공정 단계 묶음",
  agreement_clause_library: "계약서 조항",
};

function jsonList(value: unknown): string[] {
  const parsed = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  return Array.isArray(parsed) ? parsed.map((v) => String(v ?? "")).filter(Boolean) : [];
}

function isTrue(value: unknown): boolean {
  return value === true || value === "t" || value === 1;
}

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01";
}

function rowToSubtype(row: Record<string, unknown>): ContractServiceSubtype {
  return {
    id: String(row.subtype_id ?? ""),
    label: String(row.label ?? ""),
    aliases: jsonList(row.aliases),
    sortOrder: Number(row.sort_order ?? 0),
    active: isTrue(row.active),
    lockReason: row.lock_reason == null ? null : String(row.lock_reason),
  };
}

/** 전체 대분류(사용 중지 포함, 순서대로)와 그 아래 세분류. 선택 목록에는 activeServiceOptions() 로 거른다. */
export async function loadContractServiceTypes(db?: PgDatabase): Promise<ContractServiceType[]> {
  return (await loadContractServiceTypesWithSource(db)).list;
}

/** fromTable=false 면 348 미적용(기본값 사용 중) — 관리 화면이 편집을 막고 안내한다. */
export async function loadContractServiceTypesWithSource(
  db?: PgDatabase
): Promise<{ list: ContractServiceType[]; fromTable: boolean }> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { list: cache.list, fromTable: cache.fromTable };
  try {
    const handle = db ?? (await getDb());
    const typeRows = rowsToObjects(
      await handle.exec(
        `SELECT type_id, label, sort_order, active, lock_reason
           FROM contract_service_types
          ORDER BY sort_order ASC, label ASC`
      )
    );
    const subRows = rowsToObjects(
      await handle.exec(
        `SELECT subtype_id, type_id, label, aliases, sort_order, active, lock_reason
           FROM contract_service_subtypes
          ORDER BY sort_order ASC, label ASC`
      )
    );
    const list: ContractServiceType[] = typeRows
      .map((row) => ({
        id: String(row.type_id ?? ""),
        label: String(row.label ?? ""),
        sortOrder: Number(row.sort_order ?? 0),
        active: isTrue(row.active),
        lockReason: row.lock_reason == null ? null : String(row.lock_reason),
        subtypes: subRows.filter((s) => String(s.type_id) === String(row.type_id)).map(rowToSubtype),
      }))
      .filter((t) => t.id && t.label);
    // 표는 있는데 비어 있으면(시드 전) 기본값을 쓴다 — 분류 목록이 통째로 사라지지 않게
    const fromTable = list.length > 0;
    cache = { at: Date.now(), list: fromTable ? list : DEFAULT_CONTRACT_SERVICE_TYPES, fromTable };
  } catch (err) {
    if (!isMissingTable(err)) console.error("[contract-service-categories] load failed", err);
    // 조회 실패는 짧게만 캐시(10초) — 일시 오류가 1분간 기본값으로 굳지 않게
    cache = { at: Date.now() - CACHE_TTL_MS + 10_000, list: DEFAULT_CONTRACT_SERVICE_TYPES, fromTable: false };
  }
  setContractServiceSnapshot(cache.list);
  return { list: cache.list, fromTable: cache.fromTable };
}

export function invalidateContractServiceCache(): void {
  cache = null;
}

// ── 사용 건수 ────────────────────────────────────────────────────

async function existingTables(db: PgDatabase, names: readonly string[]): Promise<string[]> {
  const rows = rowsToObjects(
    await db.exec(`SELECT t AS name FROM unnest($1::text[]) AS t WHERE to_regclass('public.' || t) IS NOT NULL`, [[...names]])
  );
  return rows.map((r) => String(r.name));
}

export interface ServiceUsage {
  /** 계약(contracts) 행 수 */
  contracts: number;
  /** 모든 저장 표 합계 — 0 이면 삭제 가능 */
  total: number;
}

export interface ServiceUsageMap {
  /** 대분류 이름 → 사용 건수 */
  types: Record<string, ServiceUsage>;
  /** `${대분류}\u0000${세분류}` → 사용 건수 */
  subtypes: Record<string, ServiceUsage>;
}

export function subtypeUsageKey(type: string, subtype: string): string {
  return `${type}\u0000${subtype}`;
}

/** 분류별 사용 건수 — 계약·견적·단가 세트·계약서 템플릿·작성 계약서·외주·공정 단계·조항. */
export async function countContractServiceUsage(db: PgDatabase): Promise<ServiceUsageMap> {
  const pair = await existingTables(db, PAIR_TABLES);
  const typeOnly = await existingTables(db, TYPE_ONLY_TABLES);
  const parts = [
    ...pair.map((t) => `SELECT '${t}' AS src, service_type AS t, service_subtype AS s, COUNT(*)::int AS n FROM ${t} GROUP BY 2, 3`),
    ...typeOnly.map((t) => `SELECT '${t}' AS src, service_type AS t, NULL::text AS s, COUNT(*)::int AS n FROM ${t} GROUP BY 2`),
  ];
  const result: ServiceUsageMap = { types: {}, subtypes: {} };
  if (!parts.length) return result;
  const rows = rowsToObjects(await db.exec(parts.join(" UNION ALL ")));
  const bump = (bucket: Record<string, ServiceUsage>, key: string, src: string, n: number) => {
    const cur = bucket[key] ?? { contracts: 0, total: 0 };
    cur.total += n;
    if (src === "contracts") cur.contracts += n;
    bucket[key] = cur;
  };
  for (const row of rows) {
    const t = String(row.t ?? "").trim();
    if (!t) continue;
    const n = Number(row.n ?? 0);
    const src = String(row.src);
    bump(result.types, t, src, n);
    const s = String(row.s ?? "").trim();
    if (s) bump(result.subtypes, subtypeUsageKey(t, s), src, n);
  }
  return result;
}

// ── 편집(관리 API 전용) ──────────────────────────────────────────

export class ContractServiceInputError extends Error {}

function normalizeLabel(value: unknown, what: string): string {
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!label) throw new ContractServiceInputError(`${what} 이름을 입력하세요.`);
  if (label.length > 30) throw new ContractServiceInputError(`${what} 이름은 30자 이내로 입력하세요.`);
  if (label === QUOTE_MULTI_SUBTYPE) throw new ContractServiceInputError(`'${QUOTE_MULTI_SUBTYPE}'는 견적서 전용 선택지라 쓸 수 없습니다.`);
  return label;
}

async function getType(db: PgDatabase, typeId: string) {
  const rows = rowsToObjects(await db.exec(`SELECT * FROM contract_service_types WHERE type_id = $1`, [typeId]));
  if (!rows.length) throw new ContractServiceInputError("대분류를 찾을 수 없습니다.");
  return rows[0];
}

async function getSubtype(db: PgDatabase, subtypeId: string) {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.*, t.label AS type_label
         FROM contract_service_subtypes s JOIN contract_service_types t ON t.type_id = s.type_id
        WHERE s.subtype_id = $1`,
      [subtypeId]
    )
  );
  if (!rows.length) throw new ContractServiceInputError("세분류를 찾을 수 없습니다.");
  return rows[0];
}

async function countUpdate(db: PgDatabase, sql: string, params: unknown[]): Promise<number> {
  const rows = rowsToObjects(await db.exec(`WITH u AS (${sql} RETURNING 1) SELECT COUNT(*)::int AS n FROM u`, params));
  return Number(rows[0]?.n ?? 0);
}

/** 저장된 이름을 새 이름으로 — 표별 바뀐 행 수. 고유 인덱스 충돌은 입력 오류로 돌려준다. */
async function cascadeRename(
  db: PgDatabase,
  kind: "type" | "subtype",
  typeLabel: string,
  oldLabel: string,
  newLabel: string
): Promise<Record<string, number>> {
  const changed: Record<string, number> = {};
  try {
    if (kind === "subtype") {
      for (const t of await existingTables(db, PAIR_TABLES)) {
        const n = await countUpdate(db, `UPDATE ${t} SET service_subtype = $3 WHERE service_type = $1 AND service_subtype = $2`, [
          typeLabel,
          oldLabel,
          newLabel,
        ]);
        if (n) changed[t] = n;
      }
    } else {
      for (const t of await existingTables(db, [...PAIR_TABLES, ...TYPE_ONLY_TABLES])) {
        const n = await countUpdate(db, `UPDATE ${t} SET service_type = $2 WHERE service_type = $1`, [oldLabel, newLabel]);
        if (n) changed[t] = n;
      }
    }
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "23505") {
      throw new ContractServiceInputError("새 이름으로 이미 저장된 견적 단가 세트·계약서 템플릿이 있어 이름을 바꿀 수 없습니다.");
    }
    throw err;
  }
  return changed;
}

export function describeChanged(changed: Record<string, number>): string {
  const parts = Object.entries(changed).map(([t, n]) => `${TABLE_LABELS[t] ?? t} ${n.toLocaleString()}건`);
  return parts.join(", ");
}

export async function createServiceType(db: PgDatabase, labelInput: unknown, actor: string): Promise<string> {
  const label = normalizeLabel(labelInput, "대분류");
  const dup = rowsToObjects(await db.exec(`SELECT type_id FROM contract_service_types WHERE label = $1`, [label]));
  if (dup.length) throw new ContractServiceInputError("같은 이름의 대분류가 이미 있습니다(사용 중지된 대분류면 다시 사용으로 바꾸세요).");
  const id = `type-${randomUUID().slice(0, 8)}`;
  await db.run(
    `INSERT INTO contract_service_types (type_id, label, sort_order, active, updated_by)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 10 FROM contract_service_types), 10), true, $3)`,
    [id, label, actor]
  );
  invalidateContractServiceCache();
  return id;
}

export async function renameServiceType(
  db: PgDatabase,
  typeId: string,
  labelInput: unknown,
  actor: string
): Promise<Record<string, number>> {
  const row = await getType(db, typeId);
  if (row.lock_reason) throw new ContractServiceInputError(`이 대분류는 이름을 바꿀 수 없습니다 — ${row.lock_reason}`);
  const label = normalizeLabel(labelInput, "대분류");
  const prev = String(row.label);
  if (label === prev) return {};
  const dup = rowsToObjects(await db.exec(`SELECT type_id FROM contract_service_types WHERE label = $1 AND type_id <> $2`, [label, typeId]));
  if (dup.length) throw new ContractServiceInputError("같은 이름의 대분류가 이미 있습니다.");
  await db.run(`UPDATE contract_service_types SET label = $2, updated_at = now(), updated_by = $3 WHERE type_id = $1`, [typeId, label, actor]);
  const changed = await cascadeRename(db, "type", prev, prev, label);
  invalidateContractServiceCache();
  return changed;
}

export async function createServiceSubtype(db: PgDatabase, typeId: string, labelInput: unknown, actor: string): Promise<string> {
  await getType(db, typeId);
  const label = normalizeLabel(labelInput, "세분류");
  const dup = rowsToObjects(
    await db.exec(`SELECT subtype_id FROM contract_service_subtypes WHERE type_id = $1 AND label = $2`, [typeId, label])
  );
  if (dup.length) throw new ContractServiceInputError("이 대분류에 같은 이름의 세분류가 이미 있습니다(사용 중지된 세분류면 다시 사용으로 바꾸세요).");
  const id = `${typeId}-${randomUUID().slice(0, 8)}`;
  await db.run(
    `INSERT INTO contract_service_subtypes (subtype_id, type_id, label, sort_order, active, updated_by)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 10 FROM contract_service_subtypes WHERE type_id = $2), 10), true, $4)`,
    [id, typeId, label, actor]
  );
  invalidateContractServiceCache();
  return id;
}

export async function renameServiceSubtype(
  db: PgDatabase,
  subtypeId: string,
  labelInput: unknown,
  actor: string
): Promise<Record<string, number>> {
  const row = await getSubtype(db, subtypeId);
  if (row.lock_reason) throw new ContractServiceInputError(`이 세분류는 이름을 바꿀 수 없습니다 — ${row.lock_reason}`);
  const label = normalizeLabel(labelInput, "세분류");
  const prev = String(row.label);
  if (label === prev) return {};
  const dup = rowsToObjects(
    await db.exec(`SELECT subtype_id FROM contract_service_subtypes WHERE type_id = $1 AND label = $2 AND subtype_id <> $3`, [
      row.type_id,
      label,
      subtypeId,
    ])
  );
  if (dup.length) throw new ContractServiceInputError("이 대분류에 같은 이름의 세분류가 이미 있습니다.");
  const aliases = Array.from(new Set([...jsonList(row.aliases), prev])).filter((a) => a !== label);
  await db.run(
    `UPDATE contract_service_subtypes SET label = $2, aliases = $3::jsonb, updated_at = now(), updated_by = $4 WHERE subtype_id = $1`,
    [subtypeId, label, JSON.stringify(aliases), actor]
  );
  const changed = await cascadeRename(db, "subtype", String(row.type_label), prev, label);
  invalidateContractServiceCache();
  return changed;
}

/** 사용 중지·다시 사용(soft) — 선택 목록에서만 빠진다. */
export async function setServiceActive(
  db: PgDatabase,
  kind: "type" | "subtype",
  id: string,
  active: boolean,
  actor: string
): Promise<void> {
  const table = kind === "type" ? "contract_service_types" : "contract_service_subtypes";
  const key = kind === "type" ? "type_id" : "subtype_id";
  await db.run(`UPDATE ${table} SET active = $2, updated_at = now(), updated_by = $3 WHERE ${key} = $1`, [id, active, actor]);
  invalidateContractServiceCache();
}

/** 순서 저장 — ids 순서대로 10, 20, 30 … (세분류는 같은 대분류 안에서) */
export async function reorderServiceItems(
  db: PgDatabase,
  kind: "type" | "subtype",
  ids: string[],
  actor: string
): Promise<void> {
  const table = kind === "type" ? "contract_service_types" : "contract_service_subtypes";
  const key = kind === "type" ? "type_id" : "subtype_id";
  const unique = Array.from(new Set(ids.map((v) => String(v ?? "").trim()).filter(Boolean)));
  for (let i = 0; i < unique.length; i++) {
    await db.run(`UPDATE ${table} SET sort_order = $2, updated_at = now(), updated_by = $3 WHERE ${key} = $1`, [
      unique[i],
      (i + 1) * 10,
      actor,
    ]);
  }
  invalidateContractServiceCache();
}

/**
 * 삭제 — 어디에도 쓰이지 않은 항목만. 쓰인 항목은 사용 중지로 안내한다(사용자 확정 2026-11-10).
 * 이름이 고정된 기본 대분류는 지우지 않는다. 대분류를 지우면 그 아래 세분류도 함께 지워진다(모두 미사용일 때만 가능).
 */
export async function deleteServiceItem(db: PgDatabase, kind: "type" | "subtype", id: string): Promise<void> {
  const usage = await countContractServiceUsage(db);
  if (kind === "type") {
    const row = await getType(db, id);
    if (row.lock_reason) throw new ContractServiceInputError("기본 대분류는 지울 수 없습니다. 사용 중지를 쓰세요.");
    if ((usage.types[String(row.label)]?.total ?? 0) > 0) {
      throw new ContractServiceInputError("이미 계약·견적 등에 쓰인 대분류라 지울 수 없습니다. 사용 중지를 쓰세요.");
    }
    await db.run(`DELETE FROM contract_service_types WHERE type_id = $1`, [id]);
  } else {
    const row = await getSubtype(db, id);
    if (row.lock_reason) throw new ContractServiceInputError("이름이 고정된 세분류는 지울 수 없습니다. 사용 중지를 쓰세요.");
    if ((usage.subtypes[subtypeUsageKey(String(row.type_label), String(row.label))]?.total ?? 0) > 0) {
      throw new ContractServiceInputError("이미 계약·견적 등에 쓰인 세분류라 지울 수 없습니다. 사용 중지를 쓰세요.");
    }
    await db.run(`DELETE FROM contract_service_subtypes WHERE subtype_id = $1`, [id]);
  }
  invalidateContractServiceCache();
}
