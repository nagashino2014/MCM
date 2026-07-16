/**
 * 공공입찰 용역 분류 설정(bid_categories, 074) CRUD.
 * 분류별 검색 키워드로 사업명(title)을 OR 매칭한다 — BidBoard 분류 필터·향후 자동알림 판별 기준.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export interface BidCategory {
  categoryId: string;
  name: string;
  keywords: string[];
  enabled: boolean;
  sortOrder: number;
}

function mapRow(r: Record<string, unknown>): BidCategory {
  let keywords: string[] = [];
  const raw = r.keywords;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(v)) keywords = v.map(String).filter(Boolean);
  } catch {
    // 파싱 실패 시 빈 배열
  }
  return {
    categoryId: String(r.category_id),
    name: String(r.name),
    keywords,
    enabled: Number(r.enabled ?? 0) === 1,
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export async function listCategories(): Promise<BidCategory[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM bid_categories ORDER BY sort_order ASC, created_at ASC")
  );
  return rows.map(mapRow);
}

export async function getCategory(categoryId: string): Promise<BidCategory | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM bid_categories WHERE category_id = $1", [categoryId])
  );
  return rows.length ? mapRow(rows[0]) : null;
}

export async function createCategory(input: { name: string; keywords: string[] }): Promise<BidCategory> {
  const now = new Date().toISOString();
  const categoryId = "bcat_" + crypto.randomBytes(6).toString("hex");
  return withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO bid_categories (category_id, name, keywords, enabled, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 1, 0, $4, $4)`,
      [categoryId, input.name.trim(), JSON.stringify(input.keywords.map((k) => k.trim()).filter(Boolean)), now]
    );
    const rows = rowsToObjects(await db.exec("SELECT * FROM bid_categories WHERE category_id = $1", [categoryId]));
    return mapRow(rows[0]);
  });
}

export async function updateCategory(
  categoryId: string,
  patch: { name?: string; keywords?: string[]; enabled?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v);
  };
  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.keywords !== undefined) {
    sets.push(`keywords = $${vals.length + 1}::jsonb`);
    vals.push(JSON.stringify(patch.keywords.map((k) => k.trim()).filter(Boolean)));
  }
  if (patch.enabled !== undefined) push("enabled", patch.enabled ? 1 : 0);
  if (sets.length === 0) return;
  push("updated_at", new Date().toISOString());
  vals.push(categoryId);
  await withDbWrite(async (db) => {
    await db.run(`UPDATE bid_categories SET ${sets.join(", ")} WHERE category_id = $${vals.length}`, vals);
  });
}

export async function deleteCategory(categoryId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM bid_categories WHERE category_id = $1", [categoryId]);
  });
}
