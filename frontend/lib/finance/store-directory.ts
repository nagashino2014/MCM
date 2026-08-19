// 사업자번호 → 상호·업태 사전 (영수증 파싱 보정용)
//
// 지류 영수증은 인쇄 품질이 나빠 상호(한글)의 OCR 오인식이 잦다. 반면 사업자번호는 숫자 10자리에
// 체크섬까지 있어 훨씬 안정적으로 읽힌다 → 사업자번호로 상호를 찾아 덮어쓰는 편이 정확하다.
// 조회는 이미 쌓여 있는 실데이터만 쓴다(외부 API 없음):
//   1) card_transactions      법인카드 매입내역의 가맹점 — 영수증 가맹점과 성격이 가장 가깝다(170)
//   2) hometax_tax_invoices   홈택스 매입 세금계산서의 공급자 상호(179)
//   3) card_merchant_links    분류 확정 때 남긴 상호 스냅샷(170)
//   4) personal_receipts      내가 이전에 확정해 둔 같은 사업자번호의 영수증(177)
// 업태(bizType)까지 같이 돌려주는 이유: 자동분류(classify)의 업태 규칙 단계를 태울 수 있다.

import { getDb, rowsToObjects } from "@/lib/db";

export interface StoreInfo {
  storeName: string | null;
  bizType: string | null;
  /** 어느 소스에서 찾았는지 — 사용자 안내 문구·감사에 쓴다. */
  source: "card_txn" | "tax_invoice" | "merchant_link" | "receipt";
}

/** 사업자번호 10자리만 남긴다(하이픈·공백 제거). 자릿수가 안 맞으면 null. */
export function normalizeCorpNum(v: string | null | undefined): string | null {
  const digits = String(v ?? "").replace(/[^0-9]/g, "");
  return digits.length === 10 ? digits : null;
}

/**
 * 국세청 사업자등록번호 체크섬. OCR 오인식(자릿수는 맞는데 숫자가 틀린 경우)을 걸러낸다.
 * 가중치 [1,3,7,1,3,7,1,3,5]를 앞 9자리에 곱해 더하고, 9번째 자리 곱의 십의 자리를 한 번 더 더한 뒤
 * 10의 보수가 마지막 자리와 같아야 한다.
 */
export function isValidCorpNum(v: string | null | undefined): boolean {
  const n = normalizeCorpNum(v);
  if (!n) return false;
  const d = n.split("").map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += d[i] * weights[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

/** 표시용 000-00-00000. 10자리가 아니면 원본 그대로. */
export function formatCorpNum(v: string | null | undefined): string {
  const n = normalizeCorpNum(v);
  return n ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : String(v ?? "");
}

/**
 * 사업자번호들로 상호·업태를 찾는다. 우선순위가 높은 소스에서 먼저 채우고,
 * 이미 채워진 번호는 이후 소스에서 건너뛴다(같은 번호에 대해 소스 1건만 채택).
 */
export async function lookupStoresByCorpNum(corpNums: Array<string | null | undefined>): Promise<Map<string, StoreInfo>> {
  const out = new Map<string, StoreInfo>();
  const targets = [...new Set(corpNums.map(normalizeCorpNum).filter((v): v is string => !!v))];
  if (!targets.length) return out;

  const db = await getDb();
  // 사업자번호는 소스마다 하이픈 유무가 다를 수 있어, 비교 시 숫자만 남겨 맞춘다.
  const digitsOf = (col: string) => `regexp_replace(${col}, '[^0-9]', '', 'g')`;

  const queries: Array<{ source: StoreInfo["source"]; sql: string }> = [
    {
      source: "card_txn",
      sql: `SELECT DISTINCT ON (${digitsOf("store_corp_num")}) ${digitsOf("store_corp_num")} AS corp_num,
                   store_name AS name, store_biz_type AS biz_type
              FROM card_transactions
             WHERE store_name IS NOT NULL AND ${digitsOf("store_corp_num")} = ANY($1::text[])
             ORDER BY ${digitsOf("store_corp_num")}, approved_at DESC`,
    },
    {
      source: "tax_invoice",
      sql: `SELECT DISTINCT ON (${digitsOf("invoicer_corp_num")}) ${digitsOf("invoicer_corp_num")} AS corp_num,
                   invoicer_corp_name AS name, invoicer_biz_type AS biz_type
              FROM hometax_tax_invoices
             WHERE invoicer_corp_name IS NOT NULL AND ${digitsOf("invoicer_corp_num")} = ANY($1::text[])
             ORDER BY ${digitsOf("invoicer_corp_num")}, write_date DESC`,
    },
    {
      source: "merchant_link",
      sql: `SELECT ${digitsOf("store_corp_num")} AS corp_num, store_name_snapshot AS name, NULL AS biz_type
              FROM card_merchant_links
             WHERE store_name_snapshot IS NOT NULL AND ${digitsOf("store_corp_num")} = ANY($1::text[])`,
    },
    {
      source: "receipt",
      sql: `SELECT DISTINCT ON (${digitsOf("store_corp_num")}) ${digitsOf("store_corp_num")} AS corp_num,
                   store_name AS name, NULL AS biz_type
              FROM personal_receipts
             WHERE store_name IS NOT NULL AND ${digitsOf("store_corp_num")} = ANY($1::text[])
             ORDER BY ${digitsOf("store_corp_num")}, created_at DESC`,
    },
  ];

  for (const q of queries) {
    const remaining = targets.filter((t) => !out.has(t));
    if (!remaining.length) break;
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = rowsToObjects(await db.exec(q.sql, [remaining]));
    } catch {
      // 소스 테이블이 아직 없는 환경(마이그 미적용)에서도 나머지 소스로 계속 진행한다.
      continue;
    }
    for (const r of rows) {
      const corpNum = r.corp_num ? String(r.corp_num) : "";
      const name = r.name ? String(r.name).trim() : "";
      if (!corpNum || !name || out.has(corpNum)) continue;
      out.set(corpNum, {
        storeName: name,
        bizType: r.biz_type ? String(r.biz_type).trim() || null : null,
        source: q.source,
      });
    }
  }
  return out;
}

/** 단건 조회 헬퍼. */
export async function lookupStoreByCorpNum(corpNum: string | null | undefined): Promise<StoreInfo | null> {
  const map = await lookupStoresByCorpNum([corpNum]);
  const key = normalizeCorpNum(corpNum);
  return key ? (map.get(key) ?? null) : null;
}
