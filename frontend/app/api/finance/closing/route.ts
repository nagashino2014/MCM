import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  buildClosingWorkbook,
  closeFiscalYear,
  closingStatus,
  detectTaxAdjustments,
  reopenFiscalYear,
  saveOpeningBalance,
} from "@/lib/finance/closing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: view=status(결산 점검+재무상태표)/adjustments(세무조정 후보). format=xlsx → 결산 자료 엑셀
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") ?? 0) || new Date().getFullYear();
    if (sp.get("format") === "xlsx") {
      const buf = await buildClosingWorkbook(year);
      const filename = encodeURIComponent(`결산자료_${year}.xlsx`);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        },
      });
    }
    if (sp.get("view") === "adjustments") {
      return NextResponse.json(await detectTaxAdjustments(year));
    }
    return NextResponse.json(await closingStatus(year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "close" | "reopen" | "save_opening";
  year?: number;
  accountCode?: string;
  amount?: number;
  memo?: string | null;
}

// POST: 마감/재개(감사 기록)·기초 잔액 입력 (finance.manage)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const year = Number(body.year ?? 0);
    if (!year) return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });

    if (body.action === "close") {
      await closeFiscalYear(year, ctx.userId);
      await recordAuditLog({ actorUserId: ctx.userId, action: "fiscal_close", targetTable: "fiscal_closings", targetId: String(year) });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reopen") {
      await reopenFiscalYear(year);
      await recordAuditLog({ actorUserId: ctx.userId, action: "fiscal_close", targetTable: "fiscal_closings", targetId: `${year}:reopen` });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "save_opening") {
      if (!body.accountCode || !Number.isFinite(Number(body.amount))) {
        return NextResponse.json({ error: "accountCode/amount 가 필요합니다." }, { status: 400 });
      }
      await saveOpeningBalance(year, String(body.accountCode), Number(body.amount), body.memo);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
