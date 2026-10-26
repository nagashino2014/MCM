import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { areaIndex } from "./areas";
import {
  CUSTOM_AREA_ID_RE,
  newCustomAreaId,
  sanitizeAreaName,
  sanitizeCustomAreaContent,
  type CustomAreaContent,
  type CustomAreaDef,
} from "./custom-area-types";

/*
 * 회사소개서 새 사업 분야 저장(311 catalog_business_areas.content) — 서버.
 * 기존 6개 분야(content NULL)는 코드 기본 문안(master-content)을 쓰고, 새 분야만 이 행의 content 로 쪽을 그린다.
 * 분야 색: 쓰지 않는 area-n 슬롯(1~6) — 6색을 모두 쓰고 있으면 첫 관련 계약 분류의 색을 같이 쓴다(분야 색은 분야 이름과 함께만 쓰는 규칙).
 */

export * from "./custom-area-types";

const s = (v: unknown): string => (v == null ? "" : String(v));
const parse = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
const slotOf = (v: unknown): number => {
  const m = s(v).match(/^area-([1-6])$/);
  return m ? Number(m[1]) : 0;
};

/** 쓰는 중인 새 분야(쪽 계획 순서) */
export async function listCustomAreas(): Promise<CustomAreaDef[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT area_id, COALESCE(display_name, name) AS name, color_slot, order_no, content
         FROM catalog_business_areas WHERE content IS NOT NULL AND is_active = 1 ORDER BY order_no, area_id`
    )
  );
  return rows
    .filter((r) => CUSTOM_AREA_ID_RE.test(s(r.area_id)))
    .map((r) => ({ areaId: s(r.area_id), name: s(r.name), slot: slotOf(r.color_slot) || 5, orderNo: Number(r.order_no ?? 0), content: sanitizeCustomAreaContent(parse(r.content)) }));
}

/** 새 분야에 줄 분야 색 — 빈 슬롯 우선, 없으면 첫 관련 분류의 색 */
export async function pickAreaSlot(relatedCategories: string[]): Promise<{ slot: number; shared: boolean }> {
  const db = await getDb();
  const used = new Set(rowsToObjects(await db.exec("SELECT color_slot FROM catalog_business_areas WHERE is_active = 1")).map((r) => slotOf(r.color_slot)));
  for (let i = 1; i <= 6; i++) if (!used.has(i)) return { slot: i, shared: false };
  const first = relatedCategories.map(areaIndex).find((i) => i > 0);
  return { slot: first ?? 5, shared: true };
}

/** 새 분야 만들기 — 돌려주는 값 = area_id */
export async function createCustomArea(name: string, content: CustomAreaContent, actorUserId: string | null): Promise<CustomAreaDef> {
  const clean = sanitizeCustomAreaContent(content);
  const nm = sanitizeAreaName(name);
  if (!nm) throw Object.assign(new Error("분야 이름을 입력해야 합니다."), { status: 400 });
  if (!clean.lead || clean.services.length === 0 || clean.process.length < 3) throw Object.assign(new Error("리드 문장·주요 서비스·절차(3단계 이상)가 있어야 합니다."), { status: 400 });
  const { slot } = await pickAreaSlot(clean.relatedCategories);
  const now = new Date().toISOString();
  return withDbWrite(async (txn) => {
    const dup = rowsToObjects(await txn.exec("SELECT 1 FROM catalog_business_areas WHERE is_active = 1 AND COALESCE(display_name, name) = $1", [nm]));
    if (dup.length) throw Object.assign(new Error(`'${nm}' 분야가 이미 있습니다.`), { status: 409 });
    const order = Number(rowsToObjects(await txn.exec("SELECT COALESCE(MAX(order_no), 6) AS m FROM catalog_business_areas"))[0]?.m ?? 6) + 1;
    const areaId = newCustomAreaId();
    await txn.run(
      `INSERT INTO catalog_business_areas (area_id, name, display_name, order_no, color_slot, content, is_active, updated_at, created_by, updated_by)
       VALUES ($1, $2, NULL, $3, $4, $5::jsonb, 1, $6, $7, $7)`,
      [areaId, nm, order, `area-${slot}`, JSON.stringify(clean), now, actorUserId]
    );
    return { areaId, name: nm, slot, orderNo: order, content: clean };
  });
}

/** 새 분야 빼기(비활성) — 기존 6개 분야는 막는다 */
export async function deactivateCustomArea(areaId: string, actorUserId: string | null): Promise<boolean> {
  if (!CUSTOM_AREA_ID_RE.test(areaId)) return false;
  return withDbWrite(async (txn) => {
    const r = await txn.exec(
      "UPDATE catalog_business_areas SET is_active = 0, updated_at = $2, updated_by = $3 WHERE area_id = $1 AND content IS NOT NULL RETURNING area_id",
      [areaId, new Date().toISOString(), actorUserId]
    );
    return rowsToObjects(r).length > 0;
  });
}
