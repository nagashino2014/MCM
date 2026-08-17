import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  buildExpenseAlerts,
  buildVatLedger,
  buildVatReturn,
  buildVatReturnWorkbook,
  confirmVatReturn,
  latestClosedPeriod,
  listVatReturns,
  saveVatReturn,
  unconfirmVatReturn,
  updateHometaxInvoice,
  vatPeriod,
  vatPeriodsOfYear,
  type VatPeriod,
} from "@/lib/finance/vat-return";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePeriod(sp: URLSearchParams): VatPeriod | null {
  const year = Number(sp.get("year") ?? 0);
  const term = Number(sp.get("term") ?? 0);
  const kind = sp.get("kind") ?? "";
  if (!year || (term !== 1 && term !== 2) || (kind !== "pre" && kind !== "final")) return null;
  return vatPeriod(year, term as 1 | 2, kind);
}

// GET: view=periods(기수 목록)/ledger(매입매출장)/draft(신고서 계산)/list(저장본)/expense(경비 점검)
//      draft + format=xlsx → 신고 자료 엑셀 다운로드
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const view = sp.get("view") ?? "draft";

    if (view === "periods") {
      const now = latestClosedPeriod();
      const years = [now.year - 1, now.year];
      return NextResponse.json({
        default: { year: now.year, term: now.term, kind: now.kind },
        periods: years.flatMap((y) => vatPeriodsOfYear(y)),
      });
    }
    if (view === "list") {
      return NextResponse.json({ returns: await listVatReturns() });
    }
    if (view === "ledger") {
      const period = parsePeriod(sp);
      if (!period) return NextResponse.json({ error: "기수(year/term/kind)가 필요합니다." }, { status: 400 });
      const direction = sp.get("direction");
      return NextResponse.json(
        await buildVatLedger({
          from: period.from,
          to: period.to,
          direction: direction === "sales" || direction === "purchase" ? direction : undefined,
        }),
      );
    }
    if (view === "expense") {
      const period = parsePeriod(sp);
      if (!period) return NextResponse.json({ error: "기수(year/term/kind)가 필요합니다." }, { status: 400 });
      return NextResponse.json(await buildExpenseAlerts({ from: period.from, to: period.to }));
    }
    // draft — 신고서 자동 계산
    const period = parsePeriod(sp);
    if (!period) return NextResponse.json({ error: "기수(year/term/kind)가 필요합니다." }, { status: 400 });
    let manual: Record<string, number> | undefined;
    const manualRaw = sp.get("manual");
    if (manualRaw) {
      try {
        manual = JSON.parse(manualRaw) as Record<string, number>;
      } catch {
        manual = undefined;
      }
    }
    const form = await buildVatReturn(period, manual);
    if (sp.get("format") === "xlsx") {
      const buf = await buildVatReturnWorkbook(form);
      const filename = encodeURIComponent(`부가세신고자료_${period.year}년${period.term}기${period.kind === "pre" ? "예정" : "확정"}.xlsx`);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        },
      });
    }
    return NextResponse.json({ form });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "save" | "confirm" | "unconfirm" | "set_deductible";
  year?: number;
  term?: number;
  kind?: string;
  manual?: Record<string, number>;
  returnId?: string;
  htiId?: string;
  vatDeductible?: number | null;
  excluded?: boolean;
  memo?: string | null;
}

// POST: 신고서 저장/확정/확정취소, 매입 계산서 공제·제외 수정 (finance.manage)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "set_deductible") {
      if (!body.htiId) return NextResponse.json({ error: "htiId 가 필요합니다." }, { status: 400 });
      await updateHometaxInvoice(body.htiId, {
        vatDeductible: body.vatDeductible,
        excluded: body.excluded,
        memo: body.memo,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "save") {
      const term = Number(body.term ?? 0);
      const kind = String(body.kind ?? "");
      if (!body.year || (term !== 1 && term !== 2) || (kind !== "pre" && kind !== "final")) {
        return NextResponse.json({ error: "기수(year/term/kind)가 필요합니다." }, { status: 400 });
      }
      const period = vatPeriod(Number(body.year), term as 1 | 2, kind as "pre" | "final");
      const form = await buildVatReturn(period, body.manual);
      const returnId = await saveVatReturn(form, ctx.userId);
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "vat_return_save",
        targetTable: "vat_returns",
        targetId: returnId,
        after: { period: period.label, finalTaxDue: form.finalTaxDue },
      });
      return NextResponse.json({ returnId, form });
    }
    if (body.action === "confirm" || body.action === "unconfirm") {
      if (!body.returnId) return NextResponse.json({ error: "returnId 가 필요합니다." }, { status: 400 });
      if (body.action === "confirm") {
        await confirmVatReturn(body.returnId, ctx.userId);
        await recordAuditLog({
          actorUserId: ctx.userId,
          action: "vat_return_confirm",
          targetTable: "vat_returns",
          targetId: body.returnId,
        });
      } else {
        await unconfirmVatReturn(body.returnId);
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
