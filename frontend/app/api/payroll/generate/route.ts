import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import {
  buildLedger,
  confirmLedger,
  createDraftLedger,
  deleteDraftLedger,
  recalcEntryTaxes,
  updateEntryLine,
} from "@/lib/payroll/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** action: preview(미리보기) | create(draft 생성) | update-line(셀 수정) | confirm(확정) | delete(draft 삭제) */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "preview" || action === "create") {
      const year = Number(body.year);
      const month = Number(body.month);
      if (!year || !month || month < 1 || month > 12) {
        return NextResponse.json({ error: "연·월이 필요합니다." }, { status: 400 });
      }
      if (action === "preview") return NextResponse.json(await buildLedger(year, month));
      return NextResponse.json(await createDraftLedger(year, month, ctx.userId));
    }
    if (action === "update-line") {
      if (!body.entryId || !body.itemId) {
        return NextResponse.json({ error: "entryId·itemId가 필요합니다." }, { status: 400 });
      }
      await updateEntryLine(String(body.entryId), String(body.itemId), Number(body.amount ?? 0));
      return NextResponse.json({ ok: true });
    }
    if (action === "recalc-taxes") {
      if (!body.entryId) return NextResponse.json({ error: "entryId가 필요합니다." }, { status: 400 });
      await recalcEntryTaxes(String(body.entryId));
      return NextResponse.json({ ok: true });
    }
    if (action === "confirm") {
      await confirmLedger(String(body.ledgerId ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (action === "delete") {
      await deleteDraftLedger(String(body.ledgerId ?? ""));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
