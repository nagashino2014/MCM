import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  buildCmsFile,
  groupByPerson,
  listSettlementItems,
  listSettlements,
  listUnsettledItems,
  monthlyTrend,
  runSettlement,
} from "@/lib/finance/expense-settlement";
import { sendVatBundle } from "@/lib/finance/expense-vat-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET: ?view=unsettled(미정산 현황) | ?view=list(정산 이력) | ?settlementId=(상세) | ?trend=YYYY(추이)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const settlementId = sp.get("settlementId");
    if (settlementId) {
      const items = await listSettlementItems(settlementId);
      return NextResponse.json({
        settlement: (await listSettlements()).find((s) => s.settlementId === settlementId) ?? null,
        items,
        persons: await groupByPerson(items),
      });
    }
    if (sp.get("trend")) {
      const year = Number(sp.get("trend")) || new Date().getFullYear();
      return NextResponse.json({ trend: await monthlyTrend(year) });
    }
    if (sp.get("view") === "list") {
      return NextResponse.json({ settlements: await listSettlements() });
    }
    const items = await listUnsettledItems();
    return NextResponse.json({ items, persons: await groupByPerson(items) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "run" | "cms" | "vat-send";
  settlementId?: string;
  note?: string | null;
  toEmail?: string;
  toName?: string | null;
  message?: string | null;
}

// POST: {action:"run"} 일괄 정산 실행 / {action:"cms", settlementId} CMS 생성 /
//       {action:"vat-send", settlementId, toEmail} 부가세 자료 발송 — 모두 finance.manage.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    if (body.action === "run") {
      const settlement = await runSettlement({ actorUserId: actor.userId, note: body.note ?? null });
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "expense_settlement_run",
        targetTable: "expense_settlements",
        targetId: settlement.settlementId,
        after: { totalAmount: settlement.totalAmount, itemCount: settlement.itemCount, personCount: settlement.personCount },
      });
      return NextResponse.json({ settlement });
    }
    if (body.action === "cms") {
      if (!body.settlementId) return NextResponse.json({ error: "settlementId가 필요합니다." }, { status: 400 });
      const result = await buildCmsFile(body.settlementId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "expense_settlement_cms",
        targetTable: "expense_settlements",
        targetId: body.settlementId,
        after: { fileName: result.fileName },
      });
      return NextResponse.json(result);
    }
    if (body.action === "vat-send") {
      if (!body.settlementId || !body.toEmail?.trim()) {
        return NextResponse.json({ error: "settlementId와 수신 메일이 필요합니다." }, { status: 400 });
      }
      const result = await sendVatBundle({
        settlementId: body.settlementId,
        actorUserId: actor.userId,
        toEmail: body.toEmail.trim(),
        toName: body.toName ?? null,
        message: body.message ?? null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error ?? "발송 실패" }, { status: 500 });
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "expense_settlement_vat_send",
        targetTable: "expense_settlements",
        targetId: body.settlementId,
        after: { toEmail: body.toEmail.trim() },
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
