// 가맹점 계정과목 고정 규칙 (마이그 173) — 목록·미리보기·저장(소급 적용)·삭제
// 취지: 코레일처럼 용도가 하나로 고정된 매입처만 사용자가 판단해 못박는다. 자동 일원화는 하지 않는다.
// 소급 적용 제외: 이미 결의서에 실린 건(doc_id NOT NULL — 문서상 계정과목이 확정됨)과 excluded 건.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { loadCategories, isPgMerchant, normalizeCorpNum, normalizeStoreName } from "@/lib/barobill/classify";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const ruleId = (matchType: string, matchValue: string) =>
  `csr-${createHash("sha256").update(`${matchType}:${matchValue}`).digest("hex").slice(0, 12)}`;

export type StoreMatchType = "corp_num" | "store_name";

export interface StoreRuleRow {
  ruleId: string;
  matchType: StoreMatchType;
  matchValue: string;
  categoryKey: string;
  categoryLabel: string;
  storeName: string | null;
  storeBizType: string | null;
  appliedCount: number;
  txnCount: number; // 현재 원장에서 이 규칙에 걸리는 건수
  createdAt: string;
}

/** 매칭 WHERE 절 — 사업자번호는 숫자만 비교, 상호는 공백 제거·대문자 비교(마이그 173 인덱스와 동일). */
function matchClause(matchType: StoreMatchType, paramIndex: number): string {
  return matchType === "store_name"
    ? `upper(replace(COALESCE(store_name, ''), ' ', '')) = $${paramIndex}`
    : `regexp_replace(COALESCE(store_corp_num, ''), '[^0-9]', '', 'g') = $${paramIndex}`;
}

export async function listStoreRules(): Promise<StoreRuleRow[]> {
  const db = await getDb();
  const [rules, categories] = await Promise.all([
    rowsToObjects(
      await db.exec(
        `SELECT rule_id, match_type, match_value, category_key, store_name_snapshot, store_biz_type, applied_count, created_at
           FROM card_store_rules ORDER BY created_at DESC`,
      ),
    ),
    loadCategories(),
  ]);
  const labels = new Map(categories.map((c) => [c.categoryKey, c.label]));

  const out: StoreRuleRow[] = [];
  for (const r of rules) {
    const matchType = String(r.match_type) as StoreMatchType;
    const counted = rowsToObjects(
      await db.exec(`SELECT count(*) AS n FROM card_transactions WHERE ${matchClause(matchType, 1)}`, [String(r.match_value)]),
    );
    out.push({
      ruleId: String(r.rule_id),
      matchType,
      matchValue: String(r.match_value),
      categoryKey: String(r.category_key),
      categoryLabel: labels.get(String(r.category_key)) ?? String(r.category_key),
      storeName: r.store_name_snapshot ? String(r.store_name_snapshot) : null,
      storeBizType: r.store_biz_type ? String(r.store_biz_type) : null,
      appliedCount: Number(r.applied_count || 0),
      txnCount: Number(counted[0]?.n || 0),
      createdAt: String(r.created_at ?? ""),
    });
  }
  return out;
}

export interface StoreRulePreview {
  matchType: StoreMatchType;
  matchValue: string;
  storeName: string | null;
  storeBizType: string | null;
  storeCorpNum: string | null;
  total: number; // 매칭 총 건수
  applicable: number; // 소급 적용 대상(결의서 미귀속·미제외)
  lockedByDoc: number; // 결의서 귀속이라 건드리지 않는 건
  isPg: boolean; // PG 업태 — 일괄 지정 비권장 경고
  distinctStores: number; // 이 사업자번호 아래 서로 다른 상호 수(PG면 다수)
  breakdown: Array<{ categoryKey: string | null; label: string; count: number }>;
  existingCategoryKey: string | null; // 이미 등록된 규칙이 있으면 그 계정과목
}

/** 규칙 저장 전 영향 범위 미리보기 — 기준 매입건(cardTxnId)에서 매칭 값을 뽑는다. */
export async function previewStoreRule(cardTxnId: string, matchType: StoreMatchType): Promise<StoreRulePreview> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT store_corp_num, store_name, store_biz_type FROM card_transactions WHERE card_txn_id = $1`, [cardTxnId]),
  );
  if (!rows.length) throw Object.assign(new Error("매입 건을 찾을 수 없습니다."), { status: 404 });
  const row = rows[0];
  const storeName = row.store_name ? String(row.store_name) : null;
  const storeCorpNum = row.store_corp_num ? String(row.store_corp_num) : null;
  const storeBizType = row.store_biz_type ? String(row.store_biz_type) : null;

  const matchValue = matchType === "store_name" ? normalizeStoreName(storeName) : normalizeCorpNum(storeCorpNum);
  if (!matchValue) {
    throw Object.assign(
      new Error(matchType === "store_name" ? "이 건은 상호가 비어 있어 상호 기준 규칙을 만들 수 없습니다." : "이 건은 가맹점 사업자번호가 없어 사업자번호 기준 규칙을 만들 수 없습니다."),
      { status: 400 },
    );
  }

  const clause = matchClause(matchType, 1);
  const [stat, byCategory, existing] = await Promise.all([
    rowsToObjects(
      await db.exec(
        `SELECT count(*) AS total,
                COUNT(*) FILTER (WHERE doc_id IS NULL AND excluded = 0) AS applicable,
                COUNT(*) FILTER (WHERE doc_id IS NOT NULL) AS locked,
                COUNT(DISTINCT upper(replace(COALESCE(store_name, ''), ' ', ''))) AS stores
           FROM card_transactions WHERE ${clause}`,
        [matchValue],
      ),
    ),
    rowsToObjects(
      await db.exec(
        `SELECT category_key, count(*) AS n FROM card_transactions WHERE ${clause} GROUP BY category_key ORDER BY count(*) DESC`,
        [matchValue],
      ),
    ),
    rowsToObjects(await db.exec(`SELECT category_key FROM card_store_rules WHERE rule_id = $1`, [ruleId(matchType, matchValue)])),
  ]);
  const categories = await loadCategories();
  const labels = new Map(categories.map((c) => [c.categoryKey, c.label]));

  return {
    matchType,
    matchValue,
    storeName,
    storeBizType,
    storeCorpNum,
    total: Number(stat[0]?.total || 0),
    applicable: Number(stat[0]?.applicable || 0),
    lockedByDoc: Number(stat[0]?.locked || 0),
    isPg: isPgMerchant(storeBizType),
    distinctStores: Number(stat[0]?.stores || 0),
    breakdown: byCategory.map((r) => ({
      categoryKey: r.category_key ? String(r.category_key) : null,
      label: r.category_key ? labels.get(String(r.category_key)) ?? String(r.category_key) : "미분류",
      count: Number(r.n || 0),
    })),
    existingCategoryKey: existing.length ? String(existing[0].category_key) : null,
  };
}

/** 규칙 저장(upsert) + 소급 적용. 반환값은 실제로 갱신된 건수. */
export async function saveStoreRule(params: {
  matchType: StoreMatchType;
  matchValue: string;
  categoryKey: string;
  storeName?: string | null;
  storeBizType?: string | null;
  actorUserId?: string | null;
}): Promise<{ ruleId: string; applied: number }> {
  const categories = await loadCategories();
  const cat = categories.find((c) => c.categoryKey === params.categoryKey);
  if (!cat) throw Object.assign(new Error("존재하지 않는 계정과목입니다."), { status: 400 });
  const id = ruleId(params.matchType, params.matchValue);
  const now = KST_NOW();
  let applied = 0;

  await withDbWrite(async (db) => {
    // 소급 적용 — 결의서 귀속/제외 건은 건드리지 않는다. 공제 여부는 과세유형·계정과목 기본값으로 재판정.
    const res = rowsToObjects(
      await db.exec(
        `UPDATE card_transactions
            SET category_key = $2,
                category_source = 'store_rule',
                vat_deductible = CASE WHEN store_tax_type IN (2, 4, 6, 8) THEN 0 WHEN $3 THEN 0 ELSE 1 END,
                updated_at = $4
          WHERE ${matchClause(params.matchType, 1)} AND doc_id IS NULL AND excluded = 0
          RETURNING card_txn_id`,
        [params.matchValue, params.categoryKey, cat.vatDeductibleDefault === 0, now],
      ),
    );
    applied = res.length;

    await db.run(
      `INSERT INTO card_store_rules
         (rule_id, match_type, match_value, category_key, store_name_snapshot, store_biz_type, applied_count, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       ON CONFLICT (rule_id) DO UPDATE SET
         category_key = EXCLUDED.category_key,
         store_name_snapshot = COALESCE(EXCLUDED.store_name_snapshot, card_store_rules.store_name_snapshot),
         store_biz_type = COALESCE(EXCLUDED.store_biz_type, card_store_rules.store_biz_type),
         applied_count = EXCLUDED.applied_count,
         updated_at = EXCLUDED.updated_at`,
      [id, params.matchType, params.matchValue, params.categoryKey, params.storeName ?? null, params.storeBizType ?? null, applied, params.actorUserId ?? null, now],
    );
  });

  return { ruleId: id, applied };
}

/** 규칙 삭제 — 이미 적용된 분류는 되돌리지 않는다(수동 확정과 동일 취급, 이후 자동분류에서만 빠진다). */
export async function deleteStoreRule(id: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM card_store_rules WHERE rule_id = $1`, [id]);
  });
}
