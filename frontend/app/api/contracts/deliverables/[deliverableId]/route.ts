import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteDeliverable, getDeliverable, linkDeliverableToLetter, updateDeliverable } from "@/lib/deliverable/store";
import type { DeliverableValues } from "@/lib/deliverable/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deliverableId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { deliverableId } = await ctx.params;
    await requirePermission("contract.view");
    const row = await getDeliverable(deliverableId);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PatchBody {
  docTypes?: string[];
  templateId?: string | null;
  title?: string;
  values?: DeliverableValues;
  unlocked?: Record<string, boolean>;
  /** 공문 연계(D3) — 공문 문서가 저장되면 그 doc_id 를 기록해 상태를 'attached' 로 올린다 */
  letterDocId?: string;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { deliverableId } = await ctx.params;
    await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as PatchBody;
    const row = await getDeliverable(deliverableId);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (row.status === "sent") {
      return NextResponse.json({ error: "발송 완료된 문서는 수정할 수 없습니다." }, { status: 409 });
    }
    await updateDeliverable(deliverableId, {
      docTypes: body.docTypes,
      templateId: body.templateId,
      title: body.title,
      values: body.values,
      unlocked: body.unlocked,
    });
    if (body.letterDocId) await linkDeliverableToLetter(deliverableId, String(body.letterDocId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const { deliverableId } = await ctx.params;
    await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    await deleteDeliverable(deliverableId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
