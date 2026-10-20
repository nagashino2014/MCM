/**
 * 하위 작업 유형·종류(302, 2026-10-20 사용자 요청).
 * - 유형: 기본 8종(type_key 고정 — 자동 매칭 기준) + 관리자 추가. 종류: 유형별 목록(사전협의·본협의·검토결과서 수령은 통합허가만).
 * - 자동 유형: 상위 할 일의 '관련'으로 정한다 — 계약(보드 계약 포함)=용역 대분류, 영업=영업, 업무추진계획 Task=SW개발 분류면 SW개발·그 외 인사회계.
 *   그 밖의 관련은 하위 작업마다 직접 선택(todo_items.work_type).
 * - 편집: 할 일 관리자(todo.admin) 또는 시스템 관리자. 삭제 대신 숨김(is_active=0) — 이미 저장된 키의 라벨을 잃지 않게.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { isSystemAdminUser } from "@/lib/auth/users";
import { isTodoAdmin } from "./visibility";
import type { TodoWorkType } from "./types";

const nowIso = () => new Date().toISOString();
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const newKey = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** 계약 대분류(contracts.service_type) → 기본 유형 키 */
const SERVICE_TYPE_TO_WORK_TYPE: Record<string, string> = {
  통합허가: "permit",
  "장외&화관법": "chem",
  화관법: "chem",
  HAPs: "haps",
  ESG탄소중립: "esg",
  ESG: "esg",
  기타: "etc",
};

export async function canEditWorkTypes(userId: string): Promise<boolean> {
  if (await isTodoAdmin(userId)) return true;
  try {
    return await isSystemAdminUser(userId);
  } catch {
    return false;
  }
}

export async function listWorkTypes(db?: PgDatabase): Promise<TodoWorkType[]> {
  const conn = db ?? (await getDb());
  const types = rowsToObjects(await conn.exec(`SELECT * FROM todo_work_types ORDER BY sort_order, created_at`));
  const kinds = rowsToObjects(await conn.exec(`SELECT * FROM todo_milestone_kinds ORDER BY type_key, sort_order, created_at`));
  return types.map((t) => ({
    typeKey: String(t.type_key),
    label: String(t.label),
    builtin: Number(t.builtin ?? 0) === 1,
    sortOrder: Number(t.sort_order ?? 100),
    isActive: Number(t.is_active ?? 1) === 1,
    kinds: kinds
      .filter((k) => String(k.type_key) === String(t.type_key))
      .map((k) => ({ kindKey: String(k.kind_key), label: String(k.label), sortOrder: Number(k.sort_order ?? 100), isActive: Number(k.is_active ?? 1) === 1 })),
  }));
}

/**
 * 전체 저장(관리자) — 받은 목록 순서가 sort_order. 'new:' 로 시작하는 키는 새로 만든다.
 * 목록에서 빠진 유형·종류는 숨김 처리(이미 저장된 하위 작업의 라벨 보존).
 */
export async function saveWorkTypes(userId: string, input: unknown): Promise<TodoWorkType[]> {
  if (!(await canEditWorkTypes(userId))) throw fail("유형·종류는 관리자만 편집할 수 있습니다.", 403);
  const list = Array.isArray((input as { types?: unknown })?.types) ? ((input as { types: unknown[] }).types as Record<string, unknown>[]) : null;
  if (!list) throw fail("types 배열이 필요합니다.");
  const now = nowIso();
  await withDbWrite(async (db) => {
    const seenTypes: string[] = [];
    for (const [ti, t] of list.entries()) {
      const label = String(t.label ?? "").trim().slice(0, 40);
      if (!label) throw fail("유형 이름을 입력하세요.");
      const rawKey = String(t.typeKey ?? "");
      const typeKey = rawKey.startsWith("new:") || !rawKey ? newKey("wt_") : rawKey;
      if (!KEY_RE.test(typeKey)) throw fail("유형 키가 올바르지 않습니다.");
      await db.run(
        `INSERT INTO todo_work_types (type_key, label, builtin, sort_order, is_active, created_at, updated_at)
         VALUES ($1, $2, 0, $3, $4, $5, $5)
         ON CONFLICT (type_key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at`,
        [typeKey, label, (ti + 1) * 10, t.isActive === false ? 0 : 1, now]
      );
      seenTypes.push(typeKey);
      const kinds = Array.isArray(t.kinds) ? (t.kinds as Record<string, unknown>[]) : [];
      const seenKinds: string[] = [];
      for (const [ki, k] of kinds.entries()) {
        const kLabel = String(k.label ?? "").trim().slice(0, 40);
        if (!kLabel) throw fail(`'${label}'의 종류 이름을 입력하세요.`);
        const rawKind = String(k.kindKey ?? "");
        const kindKey = rawKind.startsWith("new:") || !rawKind ? newKey("mk_") : rawKind;
        if (!KEY_RE.test(kindKey)) throw fail("종류 키가 올바르지 않습니다.");
        if (seenKinds.includes(kindKey)) continue;
        await db.run(
          `INSERT INTO todo_milestone_kinds (type_key, kind_key, label, sort_order, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT (type_key, kind_key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at`,
          [typeKey, kindKey, kLabel, (ki + 1) * 10, k.isActive === false ? 0 : 1, now]
        );
        seenKinds.push(kindKey);
      }
      await db.run(
        `UPDATE todo_milestone_kinds SET is_active = 0, updated_at = $3 WHERE type_key = $1 AND NOT (kind_key = ANY($2::text[])) AND is_active = 1`,
        [typeKey, seenKinds, now]
      );
    }
    await db.run(`UPDATE todo_work_types SET is_active = 0, updated_at = $2 WHERE NOT (type_key = ANY($1::text[])) AND is_active = 1`, [seenTypes, now]);
  });
  return listWorkTypes();
}

/**
 * 상위 할 일의 자동 유형 — 관련 계약(보드 계약 포함)의 대분류 → 영업 → 업무추진계획 Task 분류. 해당 없으면 null(직접 선택).
 */
export async function deriveWorkType(
  db: PgDatabase,
  item: { contractId: string | null; linkKind: string | null; linkId: string | null }
): Promise<string | null> {
  if (item.contractId) {
    const r = rowsToObjects(await db.exec(`SELECT service_type FROM contracts WHERE contract_id = $1`, [item.contractId]))[0];
    const st = r?.service_type != null ? String(r.service_type).trim() : "";
    return SERVICE_TYPE_TO_WORK_TYPE[st] ?? (st ? "etc" : null);
  }
  if (item.linkKind === "sales_project" && item.linkId) return "sales";
  if (item.linkKind === "work_task" && item.linkId) {
    const r = rowsToObjects(
      await db.exec(
        `SELECT wc.category_name FROM work_tasks t LEFT JOIN work_task_categories wc ON wc.category_id = t.category_id WHERE t.task_id = $1`,
        [item.linkId]
      )
    )[0];
    const name = r?.category_name != null ? String(r.category_name).replace(/\s/g, "").toUpperCase() : "";
    return name.includes("SW") || name.includes("소프트웨어") ? "sw" : "hr_acct";
  }
  return null;
}
