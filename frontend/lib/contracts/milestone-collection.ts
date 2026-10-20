import crypto from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";

/*
 * 대금 지급 단계(milestone) 수금 기록 — 부분입금 누적 규칙의 단일 출처.
 * 수금 합계 = partial_payments_json 항목 합, 완료(payment_collected=1) = 합계가 발행금액(없으면 단계 금액) 이상.
 * 수금 자동대조(lib/barobill/recon.ts applyToMilestone)와 같은 판정이다.
 *
 * - add: 이번 입금액을 기존 합계에 더한다(미수금 '수금 등록').
 * - total: 화면의 '수금 금액'을 단계의 누적 합계로 보고 차액만 항목으로 남긴다(발행/수금 모달·수금내역 수정).
 *   기존 항목(자동대조 표식 포함)은 지우지 않으므로 항목 합 = collected_amount 가 유지된다.
 * - markCollected: 잔액 면제(할인·대손 등)로 금액이 모자라도 사용자가 명시적으로 완료 처리할 때만 true.
 */

export interface PartialPaymentEntry {
  id: string;
  collectedAt: string | null;
  amount: number;
  ratio: number;
  memo: string | null;
  recordedBy: string | null;
  recordedAt: string;
  reconMatchId?: string;
}

export interface CollectionInput {
  mode: "add" | "total";
  amount: number;
  collectedAt: string | null;
  memo?: string | null;
  markCollected?: boolean;
  actorUserId?: string | null;
}

export interface CollectionPlan {
  entries: PartialPaymentEntry[];
  totalAmount: number;
  totalRatio: number;
  isCollected: boolean;
  added: PartialPaymentEntry | null;
}

export function parsePartialPayments(raw: unknown): PartialPaymentEntry[] {
  if (Array.isArray(raw)) return raw as PartialPaymentEntry[];
  if (typeof raw === "string" && raw.length) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PartialPaymentEntry[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 순수 계산 — DB 없이 누적·완료 판정만 한다(테스트 대상). */
export function planCollection(
  current: {
    baseAmount: number;
    entries: PartialPaymentEntry[];
    legacyCollected: number;
    legacyCollectedAt: string | null;
  },
  input: CollectionInput,
  now: string = new Date().toISOString(),
  newId: () => string = () => "pp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12)
): CollectionPlan {
  const base = current.baseAmount;
  const entries = [...current.entries];
  // 화면(미수금 잔액)은 collected_amount 를 본다. 수기로 collected_amount 만 적혀 있거나 예전 경로가 덮어써
  // 항목 합과 어긋난 단계는 차액을 항목으로 먼저 남겨 기존 수금이 사라지거나 두 번 세어지지 않게 한다.
  const entrySum = entries.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  if (current.legacyCollected > 0 && current.legacyCollected !== entrySum) {
    const diff = current.legacyCollected - entrySum;
    entries.push({
      id: entries.length ? newId() : "pp_legacy",
      collectedAt: current.legacyCollectedAt,
      amount: diff,
      ratio: base > 0 ? diff / base : 0,
      memo: entries.length ? "기존 수금 합계 맞춤" : "기존 수금 기록",
      recordedBy: null,
      recordedAt: now,
    });
  }
  const before = entries.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const delta = input.mode === "add" ? input.amount : input.amount - before;
  let added: PartialPaymentEntry | null = null;
  if (delta !== 0) {
    added = {
      id: newId(),
      collectedAt: input.collectedAt,
      amount: delta,
      ratio: base > 0 ? delta / base : 0,
      memo: input.memo?.trim() || (input.mode === "total" && delta < 0 ? "수금 금액 정정" : null),
      recordedBy: input.actorUserId ?? null,
      recordedAt: now,
    };
    entries.push(added);
  }
  const totalAmount = entries.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const totalRatio = base > 0
    ? Math.round((totalAmount / base) * 1000) / 1000
    : entries.reduce((acc, e) => acc + Number(e.ratio ?? 0), 0);
  const reached = base > 0 ? totalAmount >= base - 1 : totalRatio >= 1;
  return { entries, totalAmount, totalRatio, isCollected: reached || input.markCollected === true, added };
}

/** 단계 수금 기록 — 호출자의 트랜잭션(db) 안에서 실행한다. 발행금액을 같은 트랜잭션에서 바꿨다면 그 뒤에 부른다. */
export async function applyMilestoneCollection(
  db: PgDatabase,
  contractId: string,
  milestoneId: string,
  input: CollectionInput
): Promise<CollectionPlan & { baseAmount: number }> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT amount, invoice_amount, collected_amount, payment_collected_at, partial_payments_json
         FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2`,
      [milestoneId, contractId]
    )
  );
  if (!rows.length) throw Object.assign(new Error("단계를 찾을 수 없습니다."), { status: 404 });
  const row = rows[0];
  const baseAmount = Number(row.invoice_amount ?? row.amount ?? 0);
  const plan = planCollection(
    {
      baseAmount,
      entries: parsePartialPayments(row.partial_payments_json),
      legacyCollected: Number(row.collected_amount ?? 0),
      legacyCollectedAt: row.payment_collected_at ? String(row.payment_collected_at).slice(0, 10) : null,
    },
    input
  );
  await db.run(
    `UPDATE contract_payment_milestones
        SET partial_payments_json = $1::jsonb,
            collected_amount = $2,
            collection_ratio = $3,
            payment_collected = $4,
            payment_collected_at = COALESCE($5, payment_collected_at),
            updated_at = $6
      WHERE milestone_id = $7 AND contract_id = $8`,
    [
      JSON.stringify(plan.entries),
      plan.totalAmount,
      plan.totalRatio,
      plan.isCollected ? 1 : 0,
      input.collectedAt,
      new Date().toISOString(),
      milestoneId,
      contractId,
    ]
  );
  return { ...plan, baseAmount };
}
