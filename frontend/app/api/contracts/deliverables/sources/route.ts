import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { buildAutoValues, loadContractContext, searchContracts } from "@/lib/deliverable/data";
import { listTemplates } from "@/lib/deliverable/store";
import type { DeliverableKind } from "@/lib/deliverable/types";

// 작성 화면 데이터 소스 — 계약 검색(?q=) / 계약 선택 시 자동채움·기성회차(?contractId=&kind=).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;
    const contractId = sp.get("contractId");
    const kind: DeliverableKind = sp.get("kind") === "start" ? "start" : "completion";

    if (!contractId) {
      const contracts = await searchContracts(sp.get("q") ?? "", Number(sp.get("limit") ?? 30));
      return NextResponse.json({ contracts });
    }

    const ctx = await loadContractContext(contractId);
    if (!ctx) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    const values = await buildAutoValues(ctx, kind, {
      milestoneId: sp.get("milestoneId"),
      // 복수 회차 청구(대금청구서) — ?milestoneIds=a,b 콤마 구분
      milestoneIds: (sp.get("milestoneIds") ?? "").split(",").map((v) => v.trim()).filter(Boolean),
      actualDate: sp.get("actualDate"),
      issueDate: sp.get("issueDate"),
      vatNote: sp.get("vatNote"),
    });
    // 이 발주처가 자체양식을 요구하면 작성 화면에서 우선 추천한다.
    // overlay 양식은 원본에 값을 주입하므로 spec 이 없다 → 서식 목록·편집 대상 바인딩을
    // profile.docs 에서 뽑아 같은 모양으로 내려준다(화면이 두 방식을 구분하지 않아도 되게).
    const templates = (await listTemplates({ kind })).map((t) => ({
      templateId: t.templateId,
      name: t.name,
      ownerFacilityId: t.ownerFacilityId,
      ownerFacilityName: t.ownerFacilityName,
      renderMode: t.renderMode,
      specs: t.specs,
      docs:
        t.renderMode === "overlay"
          ? (t.profile?.docs ?? []).map((d) => ({
              docType: d.docType,
              title: d.title,
              bindings: [...new Set(d.slots.map((s) => s.binding))],
            }))
          : t.specs.map((s) => ({ docType: s.docType, title: s.title, bindings: [] as string[] })),
    }));
    return NextResponse.json({ contract: ctx, values, templates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
