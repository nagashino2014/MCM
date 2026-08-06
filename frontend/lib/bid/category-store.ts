/**
 * 공공입찰 용역 분류 설정(bid_categories, 074) CRUD.
 * 분류별 조건 그룹(match_rule, 077)으로 사업명(title)을 매칭한다 — BidBoard 분류 필터·자동알림 판별 기준.
 * match_rule 이 없는 기존 분류는 keywords 를 OR 단일 그룹으로 해석(하위호환).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeGroups, type RuleGroup } from "@/lib/bid/match";

export interface BidCategory {
  categoryId: string;
  name: string;
  keywords: string[];
  /** 조건 그룹(077) — 그룹 내 AND/OR/NOR, 그룹 간 AND. null 이면 keywords OR 폴백. */
  rule: RuleGroup[] | null;
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
  let rule: RuleGroup[] | null = null;
  if (r.match_rule != null) {
    try {
      const v = typeof r.match_rule === "string" ? JSON.parse(r.match_rule) : r.match_rule;
      const groups = normalizeGroups(v);
      if (groups.length) rule = groups;
    } catch {
      // 파싱 실패 시 keywords 폴백
    }
  }
  return {
    categoryId: String(r.category_id),
    name: String(r.name),
    keywords,
    rule,
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

/** rule 에서 표시·하위호환용 keywords 파생 — NOR(제외) 그룹은 제외한 포함 키워드 평탄화. */
function keywordsFromRule(rule: RuleGroup[]): string[] {
  const out: string[] = [];
  for (const g of rule) {
    if (g.op === "nor" || g.op === "not") continue;
    for (const k of g.keywords) if (!out.includes(k)) out.push(k);
  }
  return out;
}

export async function createCategory(input: {
  name: string;
  keywords?: string[];
  rule?: RuleGroup[];
}): Promise<BidCategory> {
  const now = new Date().toISOString();
  const categoryId = "bcat_" + crypto.randomBytes(6).toString("hex");
  const rule = normalizeGroups(input.rule ?? []);
  const keywords = rule.length
    ? keywordsFromRule(rule)
    : (input.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  return withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO bid_categories (category_id, name, keywords, match_rule, enabled, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, 1, 0, $5, $5)`,
      [categoryId, input.name.trim(), JSON.stringify(keywords), rule.length ? JSON.stringify({ groups: rule }) : null, now]
    );
    const rows = rowsToObjects(await db.exec("SELECT * FROM bid_categories WHERE category_id = $1", [categoryId]));
    return mapRow(rows[0]);
  });
}

export async function updateCategory(
  categoryId: string,
  patch: { name?: string; keywords?: string[]; rule?: RuleGroup[]; enabled?: boolean }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    sets.push(`${col} = $${vals.length + 1}`);
    vals.push(v);
  };
  if (patch.name !== undefined) push("name", patch.name.trim());
  if (patch.rule !== undefined) {
    const rule = normalizeGroups(patch.rule);
    sets.push(`match_rule = $${vals.length + 1}::jsonb`);
    vals.push(rule.length ? JSON.stringify({ groups: rule }) : null);
    // keywords 도 rule 파생값으로 동기(하위호환 표시용)
    sets.push(`keywords = $${vals.length + 1}::jsonb`);
    vals.push(JSON.stringify(keywordsFromRule(rule)));
  } else if (patch.keywords !== undefined) {
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
