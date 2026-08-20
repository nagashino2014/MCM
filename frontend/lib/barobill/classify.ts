// 법인카드 매입건 계정과목 자동 분류 + 결재문서 연동 (블루프린트 P1 §F1~F3)
// 분류 4단(실측 기반 우선순위):
//   ⓪ store_rule — card_store_rules(사용자가 "이 가맹점은 항상 이 계정과목"이라 못박은 고정 규칙, 마이그 173)
//   ① learned — card_merchant_links(가맹점 사업자번호 학습 사전, 사용자가 확정한 것)
//   ② keyword — expense_categories.store_keyword_rules(상호 부분일치. 브랜드명 사전이라 특이도 높고,
//                온라인 결제(가맹점=PG사, 실측)의 주 분류 경로)
//   ③ rule    — expense_categories.biz_type_rules(업태 부분일치. 실측: BC 업태 공백 혼입 → 공백 제거 후 매칭)
// 학습 제외: PG 가맹점 사업자번호(이니시스 등)는 실사용처가 아니므로 learned 사전에 넣지 않는다.

import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

export interface ExpenseCategory {
  categoryKey: string;
  label: string;
  formOptionMap: Record<string, string>; // formId → 해당 양식 select 옵션 문자열
  bizTypeRules: string[];
  storeKeywordRules: string[];
  vatDeductibleDefault: number | null;
}

export interface ClassifyInput {
  storeCorpNum: string | null;
  storeBizType: string | null;
  storeName: string | null;
}

export interface ClassifyResult {
  categoryKey: string;
  source: "store_rule" | "learned" | "keyword" | "rule";
}

/** 가맹점 고정 규칙(card_store_rules) — 사업자번호 기준 / 상호 기준 두 갈래로 나눠 담는다. */
export interface StoreRuleSet {
  byCorpNum: Map<string, string>;
  byName: Map<string, string>;
}

export const EMPTY_STORE_RULES: StoreRuleSet = { byCorpNum: new Map(), byName: new Map() };

const stripSpaces = (s: string) => s.replace(/\s+/g, "");

/** 상호 매칭 키 — 공백 제거 + 대문자(마이그 173 표현식 인덱스와 동일 규칙). */
export const normalizeStoreName = (s: string | null | undefined) => stripSpaces(s ?? "").toUpperCase();
/** 사업자번호 매칭 키 — 숫자만. */
export const normalizeCorpNum = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

export async function loadStoreRules(): Promise<StoreRuleSet> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT match_type, match_value, category_key FROM card_store_rules`));
  const set: StoreRuleSet = { byCorpNum: new Map(), byName: new Map() };
  for (const r of rows) {
    const target = String(r.match_type) === "store_name" ? set.byName : set.byCorpNum;
    target.set(String(r.match_value), String(r.category_key));
  }
  return set;
}

export async function loadCategories(): Promise<ExpenseCategory[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT category_key, label, form_option_map, biz_type_rules, store_keyword_rules, vat_deductible_default
         FROM expense_categories WHERE is_active = 1 ORDER BY sort_order`,
    ),
  );
  return rows.map((r) => ({
    categoryKey: String(r.category_key),
    label: String(r.label),
    formOptionMap: (r.form_option_map as Record<string, string> | null) ?? {},
    bizTypeRules: (r.biz_type_rules as string[] | null) ?? [],
    storeKeywordRules: (r.store_keyword_rules as string[] | null) ?? [],
    vatDeductibleDefault: r.vat_deductible_default == null ? null : Number(r.vat_deductible_default),
  }));
}

async function loadMerchantLinks(corpNums: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(corpNums.filter(Boolean))];
  if (!unique.length) return map;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT store_corp_num, category_key FROM card_merchant_links WHERE store_corp_num = ANY($1::text[])`,
      [unique],
    ),
  );
  for (const r of rows) map.set(String(r.store_corp_num), String(r.category_key));
  return map;
}

export function isPgMerchant(storeBizType: string | null | undefined): boolean {
  return stripSpaces(storeBizType ?? "").toUpperCase().includes("PG");
}

/**
 * 전자상거래·결제대행 매입처 — 같은 가맹점에서도 건마다 계정과목이 갈린다(사용자 확정 2026-08-20).
 * 예: 쿠팡에서 사무용품을 사기도 하고 탕비실 비품을 사기도 한다. 과거 선택을 그대로 물려주면
 * 틀린 분류가 조용히 굳으므로 **자동 지정도, 학습 저장도 하지 않고 사용자가 매번 직접 고른다.**
 * 단 사용자가 명시한 고정 규칙(card_store_rules)은 본인 판단이므로 그대로 존중한다.
 * 음식점·주유소·숙박처럼 용도가 하나인 매입처는 여기 해당하지 않는다.
 */
export const ECOMMERCE_KEYWORDS = [
  "쿠팡", "네이버", "네이버페이", "NAVER", "스마트스토어", "NHN", "KCP", "이니시스", "INICIS",
  "11번가", "지마켓", "G마켓", "GMARKET", "옥션", "AUCTION", "인터파크", "티몬", "위메프",
  "SSG", "신세계몰", "롯데온", "홈앤쇼핑", "GS샵", "CJ온스타일", "카카오페이", "카카오쇼핑",
  "토스페이먼츠", "나이스페이", "페이코", "PAYCO", "다날", "알리익스프레스", "테무", "TEMU",
  "오늘의집", "무신사", "마켓컬리", "컬리",
];
export const ECOMMERCE_BIZ_TYPES = ["전자상거래", "통신판매", "결제대행", "온라인쇼핑", "인터넷쇼핑"];

export function isEcommerceMerchant(
  storeName: string | null | undefined,
  storeBizType?: string | null,
): boolean {
  if (isPgMerchant(storeBizType)) return true;
  const biz = stripSpaces(storeBizType ?? "");
  if (biz && ECOMMERCE_BIZ_TYPES.some((t) => biz.includes(t))) return true;
  const name = stripSpaces(storeName ?? "").toUpperCase();
  if (!name) return false;
  return ECOMMERCE_KEYWORDS.some((kw) => name.includes(stripSpaces(kw).toUpperCase()));
}

export interface ClassifyOptions {
  /** 전자상거래·결제대행 매입처의 자동 지정을 건너뛴다(개인카드 영수증 전용 — 아래 주석 참고). */
  skipEcommerce?: boolean;
}

export function classifyOne(
  input: ClassifyInput,
  categories: ExpenseCategory[],
  learned: Map<string, string>,
  storeRules: StoreRuleSet = EMPTY_STORE_RULES,
  options: ClassifyOptions = {},
): ClassifyResult | null {
  // ⓪ 사용자 고정 규칙 — 사업자번호 우선, 없으면 상호(PG 경유 결제 대응)
  const corpKey = normalizeCorpNum(input.storeCorpNum);
  if (corpKey) {
    const key = storeRules.byCorpNum.get(corpKey);
    if (key) return { categoryKey: key, source: "store_rule" };
  }
  const nameKey = normalizeStoreName(input.storeName);
  if (nameKey) {
    const key = storeRules.byName.get(nameKey);
    if (key) return { categoryKey: key, source: "store_rule" };
  }
  // 전자상거래·결제대행은 여기서 끝 — 학습·키워드·업태 어느 것으로도 자동 지정하지 않는다.
  // (개인카드 영수증 경로에서만 켠다. 법인카드는 원장에서 계정과목을 직접 지정하므로 그대로 둔다.)
  if (options.skipEcommerce && isEcommerceMerchant(input.storeName, input.storeBizType)) return null;
  if (input.storeCorpNum) {
    const key = learned.get(input.storeCorpNum);
    if (key) return { categoryKey: key, source: "learned" };
  }
  const name = stripSpaces(input.storeName ?? "");
  if (name) {
    for (const cat of categories) {
      if (cat.storeKeywordRules.some((kw) => kw && name.includes(stripSpaces(kw)))) {
        return { categoryKey: cat.categoryKey, source: "keyword" };
      }
    }
  }
  const biz = stripSpaces(input.storeBizType ?? "");
  if (biz) {
    for (const cat of categories) {
      if (cat.bizTypeRules.some((rule) => rule && biz.includes(stripSpaces(rule)))) {
        return { categoryKey: cat.categoryKey, source: "rule" };
      }
    }
  }
  return null;
}

export async function classifyMany(
  inputs: ClassifyInput[],
  options: ClassifyOptions = {},
): Promise<Array<ClassifyResult | null>> {
  const categories = await loadCategories();
  const [learned, storeRules] = await Promise.all([loadMerchantLinks(inputs.map((i) => i.storeCorpNum ?? "")), loadStoreRules()]);
  return inputs.map((i) => classifyOne(i, categories, learned, storeRules, options));
}

// ─────────────────────────────────────────────
// 결재문서 ↔ 카드 매입건 연동 (F1/F2)
// 표 행에 심어둔 _cardTxnId 메타로 doc_id 마킹·해제하고, 분류 확정을 학습 사전에 반영한다.
// ─────────────────────────────────────────────

/** field_values 안의 모든 표(행 배열)에서 { _cardTxnId, category } 를 수집한다. */
export function collectCardRefs(fieldValues: Record<string, unknown>): Array<{ cardTxnId: string; categoryOption: string | null }> {
  const out: Array<{ cardTxnId: string; categoryOption: string | null }> = [];
  for (const value of Object.values(fieldValues)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      if (!row || typeof row !== "object") continue;
      const cardTxnId = (row as Record<string, unknown>)._cardTxnId;
      if (typeof cardTxnId === "string" && cardTxnId) {
        const category = (row as Record<string, unknown>).category;
        out.push({ cardTxnId, categoryOption: typeof category === "string" && category ? category : null });
      }
    }
  }
  return out;
}

/**
 * 문서 저장/상신 시 호출 — 이 문서의 카드 사용건 연결을 현재 field_values 기준으로 동기화한다.
 * - 표에 남아 있는 건: doc_id/doc_form_id 마킹 + 분류 확정(category_key) + 학습(card_merchant_links)
 * - 표에서 빠진 건: doc_id 해제(다른 결의서에서 다시 선택 가능)
 */
export async function syncDocCardLinks(docId: string, formId: string, fieldValues: Record<string, unknown>): Promise<void> {
  const refs = collectCardRefs(fieldValues);
  const categories = await loadCategories();
  // 양식 옵션 문자열 → category_key 역매핑 (예: "교통비"(출장보고) → travel)
  const optionToKey = new Map<string, string>();
  for (const cat of categories) {
    const option = cat.formOptionMap[formId];
    if (option) optionToKey.set(option, cat.categoryKey);
    optionToKey.set(cat.label, cat.categoryKey); // 라벨 직접 일치 폴백
  }

  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  await withDbWrite(async (db) => {
    // 1) 이 문서에 연결돼 있던 기존 건 중 이번 목록에 없는 것 → 해제
    const keepIds = refs.map((r) => r.cardTxnId);
    await db.run(
      keepIds.length
        ? `UPDATE card_transactions SET doc_id = NULL, doc_form_id = NULL, updated_at = $2
            WHERE doc_id = $1 AND NOT (card_txn_id = ANY($3::text[]))`
        : `UPDATE card_transactions SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`,
      keepIds.length ? [docId, now, keepIds] : [docId, now],
    );

    // 2) 현재 목록 마킹 + 분류 확정 + 학습
    for (const ref of refs) {
      const categoryKey = ref.categoryOption ? optionToKey.get(ref.categoryOption) ?? null : null;
      await db.run(
        `UPDATE card_transactions
            SET doc_id = $2, doc_form_id = $3,
                category_key = COALESCE($4, category_key),
                category_source = CASE WHEN $4 IS NOT NULL THEN 'manual' ELSE category_source END,
                updated_at = $5
          WHERE card_txn_id = $1`,
        [ref.cardTxnId, docId, formId, categoryKey, now],
      );
      if (categoryKey) {
        // PG 가맹점은 학습 제외(실사용처가 아님 — 오학습 방지)
        const rows = rowsToObjects(
          await db.exec(`SELECT store_corp_num, store_name, store_biz_type FROM card_transactions WHERE card_txn_id = $1`, [ref.cardTxnId]),
        );
        const corpNum = rows[0]?.store_corp_num ? String(rows[0].store_corp_num) : null;
        const bizType = rows[0]?.store_biz_type ? String(rows[0].store_biz_type) : null;
        if (corpNum && !isPgMerchant(bizType)) {
          await db.run(
            `INSERT INTO card_merchant_links (store_corp_num, category_key, store_name_snapshot, confirm_count, last_confirmed_at, created_at)
             VALUES ($1, $2, $3, 1, $4, $4)
             ON CONFLICT (store_corp_num) DO UPDATE SET
               category_key = EXCLUDED.category_key,
               store_name_snapshot = EXCLUDED.store_name_snapshot,
               confirm_count = card_merchant_links.confirm_count + 1,
               last_confirmed_at = EXCLUDED.last_confirmed_at`,
            [corpNum, categoryKey, rows[0]?.store_name ? String(rows[0].store_name) : null, now],
          );
        }
      }
    }
  });
}

/** 문서 삭제 시 — 연결된 카드 사용건 전부 해제. */
export async function unlinkDocCards(docId: string): Promise<void> {
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  await withDbWrite(async (db) => {
    await db.run(`UPDATE card_transactions SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`, [docId, now]);
  });
}
