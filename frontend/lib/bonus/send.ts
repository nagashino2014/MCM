import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { BonusPeriod } from "@/lib/bonus/source";
import { getBonusSettings, listBonusTargets } from "@/lib/bonus/targets";
import {
  getStatementDetail,
  listStatementsOverview,
  type StatementDetail,
  type StatementOverviewRow,
} from "@/lib/bonus/statements";
import { renderStatementPdf } from "@/lib/bonus/statement-pdf";
import { sendMail } from "@/lib/mail/send";

/**
 * 지급 명세서 이메일 발송 (블루프린트 §6 — 이메일 + PDF 첨부 확정)
 * - 대상: participant / dept_head 버킷만 (영업·지원/임원은 발송 불필요 확정).
 * - 발신 = 실행 관리자의 개인 메일함(@koensain.app), 수신 = employee_profiles.email.
 * - 이력은 bonus_statement_sends 에 기록(재발송 = 같은 함수 재호출).
 */

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function periodLabel(p: BonusPeriod): string {
  return `${p.year}년 ${p.half === "H1" ? "상반기" : "하반기"}`;
}

interface PdfContext {
  label: string;
  issuedDatesByContract: Map<string, string[]>;
  deptApplied: Map<string, number>;
  deptNames: Map<string, string>;
  deptHeadRates: Record<string, number>;
}

async function buildPdfContext(p: BonusPeriod): Promise<PdfContext> {
  const settings = await getBonusSettings(p.year, p.half);
  const targets = await listBonusTargets(p);
  const issuedDatesByContract = new Map<string, string[]>();
  const deptApplied = new Map<string, number>();
  for (const t of targets) {
    issuedDatesByContract.set(
      t.contractId,
      t.stages.filter((s) => s.inPeriod && s.issuedAt).map((s) => String(s.issuedAt).slice(0, 10))
    );
    if (t.owningDeptId) {
      deptApplied.set(t.owningDeptId, (deptApplied.get(t.owningDeptId) ?? 0) + t.appliedInPeriod);
    }
  }
  const db = await getDb();
  const deptNames = new Map(
    rowsToObjects(await db.exec(`SELECT dept_id, dept_name FROM departments`)).map((d) => [
      String(d.dept_id),
      String(d.dept_name),
    ])
  );
  return { label: periodLabel(p), issuedDatesByContract, deptApplied, deptNames, deptHeadRates: settings.deptHeadRates };
}

async function renderFor(ctx: PdfContext, row: StatementOverviewRow, detail: StatementDetail): Promise<Uint8Array> {
  const deptHeadAmounts = (detail.meta?.deptHeadAmounts ?? {}) as Record<string, number>;
  return renderStatementPdf({
    periodLabel: ctx.label,
    employeeName: row.employeeName,
    deptName: row.deptName,
    positionName: row.positionName,
    totalAmount: detail.totalAmount,
    lines: detail.lines.map((l) => ({
      title: l.contractTitle,
      issuedDates: (ctx.issuedDatesByContract.get(l.contractId) ?? []).join(", ") || "-",
      amount: l.amount,
    })),
    deptHeadRows: Object.entries(deptHeadAmounts).map(([deptId, amount]) => ({
      deptName: ctx.deptNames.get(deptId) ?? deptId,
      gross: ctx.deptApplied.get(deptId) ?? 0,
      ratePct: ctx.deptHeadRates[deptId] ?? 0,
      amount: Number(amount),
    })),
  });
}

export interface SendResult {
  sent: number;
  skipped: Array<{ name: string; reason: string }>;
  failed: Array<{ name: string; error: string }>;
}

export async function sendStatementEmails(
  actorUserId: string,
  p: BonusPeriod,
  employeeIds?: string[],
  /** 테스트 발송용 수신 주소 대체 — 지정 시 employeeIds 1명만 허용(실수신 오발송 방지) */
  overrideEmail?: string
): Promise<SendResult> {
  if (overrideEmail && (employeeIds?.length ?? 0) !== 1) {
    throw Object.assign(new Error("테스트 발송(overrideEmail)은 대상 1명 지정 시에만 가능합니다."), {
      status: 400,
    });
  }
  const overview = await listStatementsOverview(p);
  const wanted = new Set(employeeIds ?? []);
  const rows = overview.filter(
    (r) =>
      (r.bucket === "participant" || r.bucket === "dept_head") &&
      (wanted.size === 0 || wanted.has(r.employeeId))
  );
  const ctx = await buildPdfContext(p);
  const result: SendResult = { sent: 0, skipped: [], failed: [] };
  const records: Array<{
    employeeId: string;
    email: string | null;
    status: string;
    error: string | null;
    messageId: string | null;
  }> = [];

  for (const row of rows) {
    const toEmail = overrideEmail ?? row.email;
    if (!toEmail) {
      result.skipped.push({ name: row.employeeName, reason: "이메일 미등록" });
      records.push({ employeeId: row.employeeId, email: null, status: "skipped", error: "이메일 미등록", messageId: null });
      continue;
    }
    try {
      const detail = await getStatementDetail(p, row.employeeId);
      if (!detail) {
        result.skipped.push({ name: row.employeeName, reason: "산정 결과 없음" });
        records.push({ employeeId: row.employeeId, email: toEmail, status: "skipped", error: "산정 결과 없음", messageId: null });
        continue;
      }
      const pdf = await renderFor(ctx, row, detail);
      const sendResult = await sendMail({
        userId: actorUserId,
        to: [{ name: overrideEmail ? undefined : row.employeeName, address: toEmail }],
        subject: `${overrideEmail ? "[테스트 발송] " : ""}[한국환경안전연구원] ${ctx.label} 성과급 지급 명세서`,
        bodyHtml:
          `<p>${row.employeeName} 님, 안녕하세요.</p>` +
          `<p>${ctx.label} 성과급 지급 명세서를 첨부와 같이 안내드립니다.</p>` +
          `<p>문의 사항은 경영지원 담당자에게 연락 바랍니다.</p>`,
        attachments: [
          {
            filename: `${ctx.label} 성과급 지급 명세서_${row.employeeName}.pdf`,
            contentType: "application/pdf",
            content: Buffer.from(pdf),
          },
        ],
      });
      if (!sendResult.ok) throw new Error(sendResult.error ?? "메일 발송 실패");
      result.sent += 1;
      // 테스트 발송(override)은 실발송 이력으로 남기지 않는다(화면 ✓ 오인 방지).
      if (!overrideEmail) {
        records.push({
          employeeId: row.employeeId,
          email: toEmail,
          status: "sent",
          error: null,
          messageId: sendResult.sesMessageId ?? sendResult.messageId ?? null,
        });
      }
    } catch (err) {
      const message = (err as Error).message ?? "발송 실패";
      result.failed.push({ name: row.employeeName, error: message });
      if (!overrideEmail) {
        records.push({ employeeId: row.employeeId, email: toEmail, status: "failed", error: message, messageId: null });
      }
    }
  }

  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (const r of records) {
      await db.run(
        `INSERT INTO bonus_statement_sends
           (send_id, period_year, period_half, employee_id, email, status, error, message_id, sent_by, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id("bss"), p.year, p.half, r.employeeId, r.email, r.status, r.error, r.messageId, actorUserId, now]
      );
    }
  });

  return result;
}

/** 관리자 미리보기용 — 발송과 동일한 PDF 바이트를 반환. */
export async function buildStatementPdf(
  p: BonusPeriod,
  employeeId: string
): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const overview = await listStatementsOverview(p);
  const row = overview.find((r) => r.employeeId === employeeId);
  const detail = await getStatementDetail(p, employeeId);
  if (!row || !detail) return null;
  const ctx = await buildPdfContext(p);
  const bytes = await renderFor(ctx, row, detail);
  return { filename: `${ctx.label} 성과급 지급 명세서_${row.employeeName}.pdf`, bytes };
}
