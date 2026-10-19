import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { assertContractsVisible, filterByVisibleContracts, loadVisibleContractSet, requireVisibleContracts } from "@/lib/auth/scope-guards";
import { buildAutoValues, loadContractContext } from "@/lib/deliverable/data";
import { createDeliverable, listDeliverables } from "@/lib/deliverable/store";
import { DEFAULT_DOC_TYPES } from "@/lib/deliverable/catalog";
import { DELIVERABLE_KIND_LABEL, type DeliverableKind, type DeliverableStatus } from "@/lib/deliverable/types";

// 착수계·준공계 문서 목록/생성. 설계: docs/contract-deliverables-blueprint.md
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { visible } = await requireVisibleContracts("contract.view");
    const sp = req.nextUrl.searchParams;
    const rows = await listDeliverables({
      contractId: sp.get("contractId"),
      kind: (sp.get("kind") as DeliverableKind | null) ?? null,
      status: (sp.get("status") as DeliverableStatus | null) ?? null,
      q: sp.get("q"),
      limit: Number(sp.get("limit") ?? 100),
    });
    // 가시 계약의 문서만(2026-10-19 §7.7)
    return NextResponse.json({ rows: filterByVisibleContracts(rows, visible, (r) => r.contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface CreateBody {
  contractId?: string;
  kind?: DeliverableKind;
  templateId?: string | null;
  docTypes?: string[];
  milestoneId?: string | null;
  actualDate?: string | null;
  issueDate?: string | null;
  vatNote?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const editable = await loadVisibleContractSet(actor.userId, "contract.edit");
    const body = (await req.json()) as CreateBody;
    const contractId = String(body.contractId ?? "").trim();
    const kind: DeliverableKind = body.kind === "start" ? "start" : "completion";
    if (!contractId) return NextResponse.json({ error: "계약을 선택하세요." }, { status: 400 });
    assertContractsVisible(editable, [contractId]); // 편집 범위 밖 계약에는 작성 불가(2026-10-19 §7.7)

    const ctx = await loadContractContext(contractId);
    if (!ctx) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });

    const values = await buildAutoValues(ctx, kind, {
      milestoneId: body.milestoneId ?? null,
      actualDate: body.actualDate ?? null,
      issueDate: body.issueDate ?? null,
      vatNote: body.vatNote ?? null,
    });
    const docTypes = body.docTypes?.length ? body.docTypes : DEFAULT_DOC_TYPES[kind];
    const title = `${ctx.title} ${DELIVERABLE_KIND_LABEL[kind]}`;

    const deliverableId = await createDeliverable({
      contractId,
      kind,
      templateId: body.templateId ?? null,
      docTypes,
      title,
      values,
      createdBy: actor.userId,
    });
    return NextResponse.json({ deliverableId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
