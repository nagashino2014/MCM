// 계약금액 = 청구·수금 단계 합 원칙(2026-08-25) 의 서버 쪽 보장.
// [단계 추가]·[수정]·[삭제]가 단계만 바꾸고 contracts.current_amount 를 그대로 두어, 상세 화면(단계 합 표시)과
// 대시보드 수주(current_amount 집계)가 어긋났다(2026-10-15 점검 — 씨제이제일제당 +7,000,000 등 4건).
// 단계를 바꾸는 라우트는 같은 트랜잭션 안에서 이 함수를 불러 계약금액을 단계 합으로 맞춘다.

import { rowsToObjects, type PgDatabase } from "@/lib/db";

/**
 * 계약금액(current_amount)을 단계 금액 합으로 맞추고 { before, after } 를 돌려준다.
 * 단계가 하나도 없거나 합이 0 이면 기존 금액을 지우지 않는다(신규 계약 모달과 같은 규칙).
 */
export async function syncContractAmountToMilestones(
  db: PgDatabase,
  contractId: string,
  now: string = new Date().toISOString()
): Promise<{ before: number | null; after: number | null }> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(c.current_amount, c.contract_amount) AS before_amount,
              (SELECT COALESCE(SUM(m.amount), 0) FROM contract_payment_milestones m WHERE m.contract_id = c.contract_id) AS stage_total
         FROM contracts c
        WHERE c.contract_id = $1`,
      [contractId]
    )
  );
  if (rows.length === 0) return { before: null, after: null };
  const before = rows[0].before_amount != null ? Number(rows[0].before_amount) : null;
  const total = Number(rows[0].stage_total ?? 0);
  if (!(total > 0) || (before != null && Math.abs(before - total) < 0.5)) return { before, after: before };
  await db.run("UPDATE contracts SET current_amount = $2, updated_at = $3 WHERE contract_id = $1", [contractId, total, now]);
  return { before, after: total };
}
