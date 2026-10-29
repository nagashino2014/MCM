import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getAnnualStatement } from "@/lib/payroll/annual-statement";
import {
  annualStatementFileName,
  buildAnnualStatementXlsx,
  renderAnnualStatementPdf,
} from "@/lib/payroll/annual-statement-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 직원별 연간 급여 명세서 다운로드 — ?year=&name=&format=xlsx|pdf */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("payroll.view");
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    const name = sp.get("name")?.trim() ?? "";
    const format = sp.get("format") === "pdf" ? "pdf" : "xlsx";
    if (!Number.isInteger(year) || !name) {
      return NextResponse.json({ error: "year·name 이 필요합니다." }, { status: 400 });
    }
    const statement = await getAnnualStatement(year, name);
    if (!statement.months.length) {
      return NextResponse.json({ error: "해당 연도 급여 자료가 없습니다." }, { status: 404 });
    }
    // 접속기록(PR-P1) — 개인 연간 급여·퇴직금 추계 다운로드.
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "download",
      targetKind: "payroll",
      targetId: `annual:${year}:${statement.profile.employeeId ?? name}`,
      detail: { format },
    });
    const fileName = annualStatementFileName(statement, format);
    if (format === "pdf") {
      const bytes = await renderAnnualStatementPdf(statement);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
          "Cache-Control": "no-store",
        },
      });
    }
    const buf = await buildAnnualStatementXlsx(statement);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
