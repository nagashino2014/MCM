import { createHash } from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";

// 분류·공제검토·수집완료 여부는 후속 상태다. 정정의 원본 바인딩에 섞지 않는다.
const BASIS_FIELDS = ["card_txn_id","card_id","approval_type","approval_num","approved_at","amount_total","supply_amount","tax_amount","service_charge","store_corp_num","store_name","store_tax_type"] as const;
export const merchantHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function cardMerchantOriginalBasis(row: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(BASIS_FIELDS.map(key => [key, row[key] == null ? null : String(row[key])]));
}
export const cardMerchantOriginalHash = (row: Record<string, unknown>) => merchantHash(cardMerchantOriginalBasis(row));
export interface CardMerchantIdentity {
  eventId: string; version: number; action: "correct" | "withdraw";
  originalCorpNum: string | null; effectiveCorpNum: string | null;
  status: "corrected" | "original" | "review_required";
  originalSourceHash: string; currentSourceHash: string; evidenceHash: string;
  issues: string[];
}
export function merchantIdentity(row: Record<string, unknown>): CardMerchantIdentity | undefined {
  return row.merchant_correction as CardMerchantIdentity | undefined;
}
export function merchantDisplay(row: Record<string, unknown>) {
  const identity = merchantIdentity(row);
  return {originalCorpNum: identity ? identity.originalCorpNum : (row.store_corp_num == null ? null : String(row.store_corp_num)),
    effectiveCorpNum: row.store_corp_num == null ? null : String(row.store_corp_num), status: identity?.status ?? "original" as const};
}
export async function applyCardMerchantCorrections(db: PgDatabase, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  // 명시적인 구조 누락은 무정정으로 취급하지 않는다. 빈 모집단도 구조를 확인한다.
  let events: Record<string, unknown>[];
  try {
    events = rowsToObjects(await db.exec(`SELECT DISTINCT ON (e.card_txn_id) e.*,
      jsonb_build_object(${BASIS_FIELDS.map(key => `'${key}',t.${key}::text`).join(",")}) AS current_basis
      FROM card_merchant_corrections e JOIN card_transactions t USING(card_txn_id)
      WHERE e.card_txn_id=ANY($1::text[]) ORDER BY e.card_txn_id,e.version DESC`, [rows.map(row => String(row.card_txn_id))]));
  } catch (error) {
    if (["42P01","42703"].includes(String((error as {code?: string}).code))) throw Object.assign(new Error("228 카드 사업자번호 정정 자료구조가 준비되지 않았습니다."), {status:503, code:"card_merchant_schema_missing"});
    throw error;
  }
  const byId = new Map(events.map(event => [String(event.card_txn_id), event]));
  return rows.map(row => {
    const event = byId.get(String(row.card_txn_id));
    if (!event) return row; // 기존 무정정 원천의 해시와 자료 모양을 그대로 유지한다.
    const basis = event.current_basis as Record<string, unknown>;
    const currentSourceHash = cardMerchantOriginalHash(basis);
    const issues: string[] = [];
    if (String(event.original_source_hash) !== currentSourceHash) issues.push("사업자번호 정정 후 수집 원천이 달라졌습니다. 정정 증빙을 다시 검토하세요.");
    if (cardMerchantOriginalHash(event.original_basis as Record<string, unknown>) !== event.original_source_hash) issues.push("사업자번호 정정의 저장 원본 근거가 일치하지 않습니다.");
    const originalCorpNum = basis.store_corp_num == null ? null : String(basis.store_corp_num);
    const effectiveCorpNum = event.action === "correct" ? String(event.corp_num) : originalCorpNum;
    const identity: CardMerchantIdentity = {eventId:String(event.event_id),version:Number(event.version),action:event.action as CardMerchantIdentity["action"],originalCorpNum,effectiveCorpNum,
      status:issues.length ? "review_required" : event.action === "correct" ? "corrected" : "original",
      originalSourceHash:String(event.original_source_hash),currentSourceHash,
      evidenceHash:merchantHash([event.event_id,event.version,event.action,event.corp_num,event.original_source_hash,event.reason,event.evidence,event.actor_user_id,event.reviewed_by,event.created_at]),issues};
    return {...row, store_corp_num:effectiveCorpNum, merchant_correction:identity};
  });
}
