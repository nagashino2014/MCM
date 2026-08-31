import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 업체 정보 팝업 '거래 은행' 카드 + 입금 내역 상세 모달용 행. 입금 1건(또는 미수 1단계)당 1행. */
export interface FacilityDepositRow {
  milestoneId: string;
  contractId: string;
  contractTitle: string;
  stageLabel: string;
  paymentMethod: string | null; // 계약의 대금 지급 방식 (현금 / 어음 : n개월)
  invoiceIssuedAt: string | null;
  invoiceAmount: number | null; // 청구(발행) 금액 — 공급가액
  collected: boolean; // 단계 완납 여부
  remaining: number; // 미수 잔액(공급가액 기준)
  depositAt: string | null; // 입금일 (미수 행은 null)
  depositAmount: number | null; // 입금액 (계좌 원장 매칭 시 실입금액, 수기 기록 시 수금액)
  bankName: string | null; // 입금 은행 — 계좌 원장(바로빌/엑셀) 매칭 건만 채워진다
  bankCode: string | null; // 바로빌 은행코드 (FinLogo 용)
  matched: boolean; // 수금 자동대조(확정)로 계좌 원장과 연결된 행인지
  noteKind: string | null; // 어음 종류(전자어음/외담대/상생협력론 등, 단계 입력값)
  noteBank: string | null; // 어음 취급 은행(단계 입력값)
  noteMaturityDate: string | null;
  noteLoanExecutedDate: string | null;
}

/**
 * GET /api/facilities/[id]/deposits
 * 해당 거래처(발주처·조달 경유 시 수요기관 포함)가 걸린 매출 계약의 청구 단계 전체를,
 * 확정된 수금 자동대조(recon_matches) → 계좌 원장(bank_transactions)과 이어 붙여 돌려준다.
 * 계좌 원장은 바로빌 수집분과 엑셀 업로드분(source='excel')이 같은 테이블이라 한 경로로 잡힌다.
 */
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("contract.view");
    const { id } = await ctx.params;
    const db = await getDb();

    const milestones = rowsToObjects(
      await db.exec(
        `SELECT m.milestone_id, m.contract_id, m.stage_label, m.stage_order,
                m.amount, m.invoice_amount, m.invoice_issued_at,
                m.payment_collected, m.payment_collected_at, m.collected_amount,
                m.settlement_amount, m.partial_payments_json,
                m.note_kind, m.note_bank, m.note_maturity_date, m.note_loan_executed_date,
                c.contract_title, c.payment_method
           FROM contract_payment_milestones m
           JOIN contracts c ON c.contract_id = m.contract_id
          WHERE COALESCE(c.contract_direction, 'sales') = 'sales'
            AND (c.counterparty_facility_id = $1
                 OR c.facility_id = $1
                 OR EXISTS (SELECT 1 FROM contract_facilities cf
                             WHERE cf.contract_id = c.contract_id AND cf.facility_id = $1))
            AND (m.invoice_issued = 1 OR m.payment_collected = 1)
          ORDER BY COALESCE(m.invoice_issued_at, m.payment_collected_at) DESC NULLS LAST, m.stage_order`,
        [id],
      ),
    );

    const milestoneIds = milestones.map((m) => String(m.milestone_id));
    const txnRows = milestoneIds.length
      ? rowsToObjects(
          await db.exec(
            `SELECT l.milestone_id, l.allocated_amount, t.txn_at, t.amount AS txn_amount,
                    COALESCE(a.bank_name, a.bank_code) AS bank_name, a.bank_code
               FROM recon_match_lines l
               JOIN recon_matches rm ON rm.match_id = l.match_id AND rm.status = 'confirmed'
               JOIN bank_transactions t ON t.txn_id = rm.txn_id
               JOIN bank_accounts a ON a.account_id = t.account_id
              WHERE l.milestone_id = ANY($1::text[])
              ORDER BY t.txn_at`,
            [milestoneIds],
          ),
        )
      : [];
    const txnsByMilestone = new Map<
      string,
      Array<{ txnAt: string; amount: number; bankName: string | null; bankCode: string | null; allocated: number }>
    >();
    for (const t of txnRows) {
      const key = String(t.milestone_id);
      const list = txnsByMilestone.get(key) ?? [];
      list.push({
        txnAt: String(t.txn_at).slice(0, 10),
        amount: Number(t.txn_amount || 0),
        bankName: t.bank_name ? String(t.bank_name) : null,
        bankCode: t.bank_code ? String(t.bank_code) : null,
        allocated: Number(t.allocated_amount || 0),
      });
      txnsByMilestone.set(key, list);
    }

    const rows: FacilityDepositRow[] = [];
    for (const m of milestones) {
      const milestoneId = String(m.milestone_id);
      const base = Number(m.invoice_amount ?? m.amount ?? 0);
      const collectedAmount = Number(m.collected_amount ?? 0);
      const collected = Number(m.payment_collected ?? 0) === 1;
      const common = {
        milestoneId,
        contractId: String(m.contract_id),
        contractTitle: String(m.contract_title ?? ""),
        stageLabel: String(m.stage_label ?? ""),
        paymentMethod: m.payment_method ? String(m.payment_method) : null,
        invoiceIssuedAt: m.invoice_issued_at ? String(m.invoice_issued_at).slice(0, 10) : null,
        invoiceAmount: base > 0 ? base : null,
        collected,
        remaining: collected ? 0 : Math.max(0, Math.round(base - collectedAmount)),
        noteKind: m.note_kind ? String(m.note_kind) : null,
        noteBank: m.note_bank ? String(m.note_bank) : null,
        noteMaturityDate: m.note_maturity_date ? String(m.note_maturity_date) : null,
        noteLoanExecutedDate: m.note_loan_executed_date ? String(m.note_loan_executed_date) : null,
      };

      const txns = txnsByMilestone.get(milestoneId) ?? [];
      if (txns.length) {
        // 계좌 원장과 확정 매칭된 입금 — 은행까지 확인된 행
        for (const t of txns) {
          rows.push({ ...common, depositAt: t.txnAt, depositAmount: t.amount, bankName: t.bankName, bankCode: t.bankCode, matched: true });
        }
        continue;
      }

      // 원장 매칭이 없는 수금 기록(자동대조 이전 수기 입력 등) — 부분입금 이력이 있으면 항목별로 싣는다.
      const entries = parseEntries(m.partial_payments_json);
      if (entries.length) {
        for (const e of entries) {
          rows.push({
            ...common,
            depositAt: e.collectedAt ? String(e.collectedAt).slice(0, 10) : null,
            depositAmount: Number(e.amount || 0) || null,
            bankName: null,
            bankCode: null,
            matched: false,
          });
        }
        continue;
      }
      if (collected || collectedAmount > 0) {
        rows.push({
          ...common,
          depositAt: m.payment_collected_at ? String(m.payment_collected_at).slice(0, 10) : null,
          depositAmount: collectedAmount > 0 ? collectedAmount : base > 0 ? base : null,
          bankName: null,
          bankCode: null,
          matched: false,
        });
        continue;
      }

      // 미수 — 입금 정보 없이 잔액만 표기
      rows.push({ ...common, depositAt: null, depositAmount: null, bankName: null, bankCode: null, matched: false });
    }

    // 거래 은행 태그 요약 — 원장 매칭이 확인된 입금만 집계한다.
    const bankAgg = new Map<string, { bankCode: string | null; count: number; totalAmount: number }>();
    for (const r of rows) {
      if (!r.matched || !r.bankName || !r.depositAmount) continue;
      const prev = bankAgg.get(r.bankName) ?? { bankCode: r.bankCode, count: 0, totalAmount: 0 };
      bankAgg.set(r.bankName, { bankCode: prev.bankCode ?? r.bankCode, count: prev.count + 1, totalAmount: prev.totalAmount + r.depositAmount });
    }
    const banks = [...bankAgg.entries()]
      .map(([bankName, agg]) => ({ bankName, ...agg }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    return NextResponse.json({ banks, rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function parseEntries(raw: unknown): Array<{ collectedAt?: string | null; amount?: number }> {
  if (Array.isArray(raw)) return raw as Array<{ collectedAt?: string | null; amount?: number }>;
  if (typeof raw === "string" && raw.length) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
