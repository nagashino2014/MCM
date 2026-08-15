import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { withDbWrite } from "@/lib/db";
import { matchOvertimeRequests, ordinaryHourlyWages, overtimeAmounts } from "@/lib/payroll/overtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 초과근무 신청 × 근태 대조 내역 (?year=&month=) — 급여대장 산정 근거 확인용.
 * 신청 시간대와 실제 재실 시간대의 교집합만 인정하며, 미근무(absent)·조기퇴근(short)을 그대로 보여준다.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    const month = Number(sp.get("month"));
    if (!year || !month) return NextResponse.json({ error: "year·month가 필요합니다." }, { status: 400 });

    const [rows, amounts, hourly] = await Promise.all([
      matchOvertimeRequests(year, month),
      overtimeAmounts(year, month),
      ordinaryHourlyWages(),
    ]);
    const byEmployee = [...amounts.entries()]
      .filter(([, v]) => v.amount > 0 || v.cappedMin > 0)
      .map(([employeeId, v]) => ({
        employeeId,
        name: rows.find((r) => r.employeeId === employeeId)?.name ?? "",
        hourlyWage: hourly.get(employeeId) ?? null,
        ...v,
      }))
      .sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      year, month, rows, byEmployee,
      summary: {
        docs: rows.length,
        absent: rows.filter((r) => r.verdict === "absent").length,
        short: rows.filter((r) => r.verdict === "short").length,
        noRecord: rows.filter((r) => r.verdict === "no-record").length,
        requestedHours: Math.round((rows.reduce((a, r) => a + r.reqMin, 0) / 60) * 10) / 10,
        actualHours: Math.round((rows.reduce((a, r) => a + r.actualMin, 0) / 60) * 10) / 10,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 예외 승인/반려 — 지문 미태그 등으로 근태와 신청이 어긋난 건을 관리자가 확인 후 처리한다.
 * mode: approve=신청 전량 인정 · reject=전량 불인정 · clear=예외 해제(자동 대조로 복귀).
 * ※ 2026-09 앱 정식 전환 이후로는 미태그 건을 예외 없이 미근무 처리할 예정(과도기 보정 수단).
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      docId?: string;
      employeeId?: string | null;
      workDate?: string | null;
      mode?: "approve" | "reject" | "clear";
      reason?: string | null;
    };
    if (!body.docId || !body.mode) {
      return NextResponse.json({ error: "docId·mode가 필요합니다." }, { status: 400 });
    }
    await withDbWrite(async (db) => {
      if (body.mode === "clear") {
        await db.run(`DELETE FROM overtime_match_overrides WHERE doc_id = $1`, [body.docId]);
        return;
      }
      await db.run(
        `INSERT INTO overtime_match_overrides (doc_id, employee_id, work_date, mode, reason, approved_by, approved_at)
         VALUES ($1,$2,$3::date,$4,$5,$6, now()::text)
         ON CONFLICT (doc_id) DO UPDATE SET
           mode = EXCLUDED.mode, reason = EXCLUDED.reason,
           approved_by = EXCLUDED.approved_by, approved_at = now()::text`,
        [body.docId, body.employeeId ?? null, body.workDate ?? null, body.mode, body.reason ?? null, actor.userId]
      );
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "overtime_match_override",
      targetTable: "overtime_match_overrides",
      targetId: body.docId,
      after: { mode: body.mode, reason: body.reason ?? null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
