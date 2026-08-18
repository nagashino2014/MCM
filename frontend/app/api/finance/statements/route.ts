// 계좌·카드 내역 엑셀 업로드 API
// GET  : 업로드 대상(계좌·카드) 목록 + 지원 양식
// POST : multipart(file, mode=preview|commit, targetId?) — 양식 자동 판별 후 미리보기/적재
//
// 바로빌 수집분과 겹치는 구간이 있으므로 자연키로 중복을 거른다:
//   계좌 = 계좌 + 거래일시(초) + 입출금 + 금액,  카드 = 카드 + 승인번호 + 승인일시
// 카드 취소 건은 적재하지 않는다 — 지출이 발생하지 않은 건이라 원장에 넣으면 분개·부가세가 왜곡된다.

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { normalizeRemitter } from "@/lib/barobill/sync";
import { parseStatementWorkbook, maskedCardParts, SUPPORTED_PROFILES, type ParsedStatement } from "@/lib/finance/statement-import";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, seed: string) => `${prefix}-${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
const onlyDigits = (s: string) => s.replace(/[^0-9]/g, "");

interface TargetOption {
  id: string;
  kind: "bank" | "card";
  label: string;
  no: string;
}

async function listTargets(): Promise<TargetOption[]> {
  const db = await getDb();
  const banks = rowsToObjects(
    await db.exec(`SELECT account_id, account_no, account_alias, bank_name FROM bank_accounts ORDER BY bank_name, account_no`),
  ).map((r) => ({
    id: String(r.account_id),
    kind: "bank" as const,
    label: `${String(r.bank_name ?? "")} ${String(r.account_alias ?? "")}`.trim() || String(r.account_no ?? ""),
    no: String(r.account_no ?? ""),
  }));
  const cards = rowsToObjects(
    await db.exec(`SELECT card_id, card_num, card_alias, card_company_name FROM card_registry ORDER BY card_company_name, card_num`),
  ).map((r) => ({
    id: String(r.card_id),
    kind: "card" as const,
    label: `${String(r.card_company_name ?? "")} ${String(r.card_alias ?? "")}`.trim() || String(r.card_num ?? ""),
    no: String(r.card_num ?? ""),
  }));
  return [...banks, ...cards];
}

/** 파일에서 읽은 번호로 등록된 계좌·카드를 추정한다. 카드는 마스킹이라 앞자리+뒷자리로 맞춘다. */
function guessTarget(parsed: ParsedStatement, targets: TargetOption[]): TargetOption | null {
  const hint = parsed.accountHint ?? "";
  const pool = targets.filter((t) => t.kind === parsed.kind);
  if (!hint) return null;
  if (parsed.kind === "bank") {
    const digits = onlyDigits(hint);
    return pool.find((t) => onlyDigits(t.no) === digits) ?? null;
  }
  const { head, tail } = maskedCardParts(hint);
  if (!head && !tail) return null;
  const matched = pool.filter((t) => {
    const no = onlyDigits(t.no);
    return (!head || no.startsWith(head)) && (!tail || no.endsWith(tail));
  });
  return matched.length === 1 ? matched[0] : null;
}

export async function GET() {
  try {
    await requirePermission("finance.view");
    return NextResponse.json({ targets: await listTargets(), profiles: SUPPORTED_PROFILES });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const form = await req.formData();
    const file = form.get("file");
    const mode = String(form.get("mode") ?? "preview");
    const targetIdInput = String(form.get("targetId") ?? "");
    if (!(file instanceof File)) return NextResponse.json({ error: "엑셀 파일이 필요합니다." }, { status: 400 });

    const parsed = parseStatementWorkbook(Buffer.from(await file.arrayBuffer()));
    const targets = await listTargets();
    const guessed = guessTarget(parsed, targets);
    const target = targetIdInput ? targets.find((t) => t.id === targetIdInput) ?? null : guessed;

    if (target && target.kind !== parsed.kind) {
      return NextResponse.json({ error: `${parsed.profileLabel} 파일은 ${parsed.kind === "bank" ? "계좌" : "카드"}에만 적재할 수 있습니다.` }, { status: 400 });
    }

    const db = await getDb();
    const summary = {
      profileId: parsed.profileId,
      profileLabel: parsed.profileLabel,
      kind: parsed.kind,
      fileName: file.name,
      accountHint: parsed.accountHint,
      period: parsed.period,
      target: target ? { id: target.id, label: target.label, no: target.no } : null,
      guessed: Boolean(guessed && (!targetIdInput || guessed.id === targetIdInput)),
      total: parsed.kind === "bank" ? parsed.bankRows.length : parsed.cardRows.length,
      canceled: parsed.kind === "card" ? parsed.cardRows.filter((r) => r.approvalType === "취소").length : 0,
      duplicated: 0,
      newRows: 0,
      inserted: 0,
      warnings: parsed.warnings,
      sample: [] as Array<Record<string, string | number | null>>,
    };

    // ── 계좌 ────────────────────────────────────────────────────────────────
    if (parsed.kind === "bank") {
      const rows = parsed.bankRows;
      summary.sample = rows.slice(0, 5).map((r) => ({
        일시: r.txnAt,
        구분: r.direction === "in" ? "입금" : "출금",
        금액: r.amount,
        상대: r.counterparty,
        잔액: r.balanceAfter,
      }));
      if (!target) {
        return NextResponse.json({ ...summary, needTarget: true, targets: targets.filter((t) => t.kind === "bank") });
      }
      const seen = new Set<string>();
      for (const r of rows) {
        const found = rowsToObjects(
          await db.exec(
            `SELECT 1 AS x FROM bank_transactions
              WHERE account_id = $1 AND txn_at = $2 AND direction = $3 AND amount = $4 LIMIT 1`,
            [target.id, r.txnAt, r.direction, r.amount],
          ),
        );
        if (found.length) summary.duplicated += 1;
        else {
          seen.add(`${r.txnAt}|${r.direction}|${r.amount}`);
          summary.newRows += 1;
        }
      }
      if (mode !== "commit") return NextResponse.json({ ...summary, targets: targets.filter((t) => t.kind === "bank") });

      await withDbWrite(async (tx) => {
        for (const r of rows) {
          const dedupKey = `xls:${onlyDigits(target.no)}:${r.txnAt}:${r.direction}:${r.amount}`;
          const dup = rowsToObjects(
            await tx.exec(
              `SELECT 1 AS x FROM bank_transactions
                WHERE dedup_key = $1 OR (account_id = $2 AND txn_at = $3 AND direction = $4 AND amount = $5) LIMIT 1`,
              [dedupKey, target.id, r.txnAt, r.direction, r.amount],
            ),
          );
          if (dup.length) continue;
          await tx.run(
            `INSERT INTO bank_transactions
               (txn_id, account_id, txn_at, direction, amount, balance_after,
                remitter_name_raw, remitter_name_norm, trans_type, trans_office, remark1, remark2,
                bank_ref, dedup_key, source, raw_json, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), $13, $14, 'excel', $15::jsonb, $16)
             ON CONFLICT (dedup_key) DO NOTHING`,
            [
              hashId("btx", dedupKey),
              target.id,
              r.txnAt,
              r.direction,
              r.amount,
              r.balanceAfter,
              r.counterparty,
              normalizeRemitter(r.counterparty),
              r.transType,
              r.transOffice,
              r.remark1,
              r.remark2,
              dedupKey,
              dedupKey,
              JSON.stringify({ ...r.raw, fileName: file.name }),
              KST_NOW(),
            ],
          );
          summary.inserted += 1;
        }
      });
    }

    // ── 카드 ────────────────────────────────────────────────────────────────
    if (parsed.kind === "card") {
      // 취소 건은 지출이 없던 거래라 적재하지 않는다(롯데는 승인·취소가 같은 내용으로 2행 들어온다).
      const rows = parsed.cardRows.filter((r) => r.approvalType === "승인");
      summary.sample = rows.slice(0, 5).map((r) => ({
        일시: r.approvedAt,
        승인번호: r.approvalNum,
        금액: r.amountTotal,
        가맹점: r.storeName,
        사업자번호: r.storeCorpNum || null,
      }));
      if (!target) {
        return NextResponse.json({ ...summary, needTarget: true, targets: targets.filter((t) => t.kind === "card") });
      }
      for (const r of rows) {
        const found = rowsToObjects(
          await db.exec(
            `SELECT 1 AS x FROM card_transactions
              WHERE card_id = $1 AND approval_num = $2 AND approved_at = $3 LIMIT 1`,
            [target.id, r.approvalNum, r.approvedAt],
          ),
        );
        if (found.length) summary.duplicated += 1;
        else summary.newRows += 1;
      }
      if (mode !== "commit") return NextResponse.json({ ...summary, targets: targets.filter((t) => t.kind === "card") });

      await withDbWrite(async (tx) => {
        for (const r of rows) {
          const dedupKey = `xls:${onlyDigits(target.no) || target.id}:${r.approvalNum}:${r.approvedAt}`;
          const dup = rowsToObjects(
            await tx.exec(
              `SELECT 1 AS x FROM card_transactions
                WHERE dedup_key = $1 OR (card_id = $2 AND approval_num = $3 AND approved_at = $4) LIMIT 1`,
              [dedupKey, target.id, r.approvalNum, r.approvedAt],
            ),
          );
          if (dup.length) continue;
          // 엑셀 승인내역에는 공급가액·세액이 없다 — 역산하면 면세 가맹점에서 틀리므로 비워 둔다.
          await tx.run(
            `INSERT INTO card_transactions
               (card_txn_id, card_id, history_key, dedup_key, approval_type, approval_num, approved_at, use_date,
                amount_total, supply_amount, tax_amount, service_charge,
                store_corp_num, store_name, store_addr, store_biz_type,
                is_purchased, payment_plan, installment_months, use_location, is_debit, raw_json, created_at)
             VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8,
                     $9, NULL, NULL, 0,
                     NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
                     0, NULLIF($14, ''), NULLIF($15, ''), NULLIF($16, ''), 0, $17::jsonb, $18)
             ON CONFLICT (dedup_key) DO NOTHING`,
            [
              hashId("ctx", dedupKey),
              target.id,
              `xls-${r.approvalNum}`,
              dedupKey,
              r.approvalType,
              r.approvalNum,
              r.approvedAt,
              r.approvedAt.slice(0, 10),
              r.amountTotal,
              r.storeCorpNum,
              r.storeName,
              r.storeAddr,
              r.storeBizType,
              r.paymentPlan,
              r.installmentMonths,
              r.useLocation,
              JSON.stringify({ ...r.raw, fileName: file.name }),
              KST_NOW(),
            ],
          );
          summary.inserted += 1;
        }
      });
    }

    // 수집 로그에 남겨 "언제 무엇을 올렸는지"를 바로빌 수집과 같은 화면에서 본다.
    const syncId = hashId("fs", `excel:${file.name}:${Date.now()}`);
    await withDbWrite(async (tx) => {
      await tx.run(
        `INSERT INTO finance_sync_logs (sync_id, kind, target_id, status, fetched, inserted, started_at, finished_at)
         VALUES ($1, $2, $3, 'ok', $4, $5, $6, $6)`,
        [syncId, parsed.kind === "bank" ? "excel-bank" : "excel-card", target?.id ?? null, summary.total, summary.inserted, KST_NOW()],
      );
    });

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "finance_statement_import",
      targetTable: parsed.kind === "bank" ? "bank_transactions" : "card_transactions",
      targetId: target?.id ?? parsed.profileId,
      after: {
        file: file.name,
        profile: parsed.profileId,
        period: parsed.period,
        total: summary.total,
        inserted: summary.inserted,
        duplicated: summary.duplicated,
      },
    });

    return NextResponse.json(summary);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
