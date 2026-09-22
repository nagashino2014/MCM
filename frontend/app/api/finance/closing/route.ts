import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { summarizeClosingCompleteness, type ClosingCompleteness } from "@/lib/finance/closing-integrity";
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

function closingDatabaseError(err: unknown): NextResponse | null {
  const error = err as { code?: string; constraint?: string; message?: string };
  if (error.code === "23514" && error.constraint === "finance_journal_use_stale_closing") {
    return NextResponse.json({
      error: "현재 원천 또는 전표와 일치하지 않는 전표 사용이 있어 마감할 수 없습니다. 전표 사용을 해제하고 다시 검토하세요.",
      code: "journal_use_stale_blocks_closing",
    }, { status: 409 });
  }
  return null;
}

// GET: 기본 요약, view=impact는 현재 상세 근거 내려받기. format=xlsx는 결산 자료.
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
    if (sp.get("view") === "impact") {
      const status = await closingStatus(year, undefined, {impactDetails: true});
      const filename = encodeURIComponent(`결산검증범위_${year}.json`);
      return NextResponse.json({year, basis: "current_sources", checkedAt: status.completeness.checkedAt, completeness: status.completeness}, {
        headers: {"Content-Disposition": `attachment; filename*=UTF-8''${filename}`, "Cache-Control": "no-store"},
      });
    }
    return NextResponse.json(await closingStatus(year));
  } catch (err) {
    const databaseError = closingDatabaseError(err);
    if (databaseError) return databaseError;
    if ((err as {completeness?: unknown})?.completeness) {
      const error = err as Error & {status: number; completeness: ClosingCompleteness};
      return NextResponse.json({error: error.message, completeness: summarizeClosingCompleteness(error.completeness)}, {status: error.status});
    }
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "close" | "reopen" | "save_opening";
  year?: number;
  accountCode?: string;
  amount?: number;
  memo?: string | null;
  reason?: string;
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
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reopen") {
      await reopenFiscalYear(year, ctx.userId, typeof body.reason === "string" ? body.reason : "");
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
    const databaseError = closingDatabaseError(err);
    if (databaseError) return databaseError;
    if ((err as {completeness?: unknown})?.completeness) {
      const error = err as Error & {status: number; completeness: ClosingCompleteness};
      return NextResponse.json({error: error.message, completeness: summarizeClosingCompleteness(error.completeness)}, {status: error.status});
    }
    return authErrorToResponse(err);
  }
}
