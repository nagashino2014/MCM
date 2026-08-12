import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getTemplate, listTemplates, resolveTemplateForSubtype, upsertTemplate } from "@/lib/agreement/store";
import { QUOTE_SERVICE_OPTIONS } from "@/lib/quote/types";
import { seedForSubtype, seedAsTemplateRow } from "@/lib/agreement/catalog";
import type { TemplateProfile } from "@/lib/deliverable/types";
import type { AgreementRenderMode, AgreementSpec } from "@/lib/agreement/types";

// 계약서 양식 템플릿 — 세분류별 표준 셋 resolve(작성 화면) / 기준 관리 목록 / 저장(fork 포함).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;

    // 단건 — templateId(시드 가상 id 포함)
    const templateId = sp.get("templateId");
    if (templateId) {
      const tpl = await getTemplate(templateId);
      if (!tpl) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });
      return NextResponse.json({ template: tpl });
    }

    // 세분류 resolve — 작성 화면 자동 선택(DB 활성 우선 → 코드 시드 폴백 → null)
    const serviceType = sp.get("serviceType");
    const serviceSubtype = sp.get("serviceSubtype");
    if (serviceType && serviceSubtype) {
      const tpl = await resolveTemplateForSubtype(serviceType, serviceSubtype);
      return NextResponse.json({ template: tpl });
    }

    // 기준 관리 목록 — 용역 대분류→세분류 매트릭스(견적 기준 관리 스타일).
    // DB 활성 셋이 있으면 그것, 없으면 시드, 둘 다 없으면 null(미지정) 으로 채운다.
    const dbRows = await listTemplates({});
    const standard = QUOTE_SERVICE_OPTIONS.map((o) => ({
      serviceType: o.type,
      subtypes: o.subtypes.map((sub) => {
        const db = dbRows.find(
          (t) => t.kind === "standard" && t.status === "active" && t.serviceType === o.type && t.serviceSubtype === sub
        );
        if (db) {
          return { serviceSubtype: sub, templateId: db.templateId, name: db.name, seeded: false, clauseCount: db.spec.clausePage?.clauses.length ?? 0 };
        }
        const seed = seedForSubtype(o.type, sub);
        return seed
          ? { serviceSubtype: sub, templateId: seed.templateId, name: seed.name, seeded: true, clauseCount: seedAsTemplateRow(seed, sub).spec.clausePage?.clauses.length ?? 0 }
          : { serviceSubtype: sub, templateId: null, name: null, seeded: false, clauseCount: 0 };
      }),
    }));
    const custom = dbRows
      .filter((t) => t.kind === "custom")
      .map((t) => ({
        templateId: t.templateId,
        name: t.name,
        originFacilityId: t.originFacilityId,
        originFacilityName: t.originFacilityName,
        renderMode: t.renderMode,
        slotCount: t.profile?.docs?.[0]?.slots.length ?? 0,
        clauseCount: t.spec.clausePage?.clauses.length ?? 0,
        updatedAt: t.updatedAt,
      }));
    return NextResponse.json({ standard, custom });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 템플릿 저장 — 시드 편집(fork) 포함. 기준 관리 화면(관리 권한) 전용.
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission("approval.manage");
    const body = (await req.json()) as {
      templateId?: string | null;
      name: string;
      kind: "standard" | "custom";
      serviceType?: string | null;
      serviceSubtype?: string | null;
      status?: string;
      originFacilityId?: string | null;
      spec: AgreementSpec;
      renderMode?: AgreementRenderMode;
      profile?: TemplateProfile | null;
      sourceKind?: string | null;
      sourceKey?: string | null;
    };
    if (!body?.name?.trim()) return NextResponse.json({ error: "양식 이름을 입력하세요." }, { status: 400 });
    const renderMode: AgreementRenderMode = body.renderMode === "overlay" ? "overlay" : "spec";
    if (renderMode === "overlay") {
      // overlay 는 원본 파일과 슬롯 매핑이 둘 다 있어야 값 주입이 가능하다(148)
      if (!body.sourceKey) return NextResponse.json({ error: "원본 양식 파일 정보가 없습니다(재업로드 필요)." }, { status: 400 });
      if (!body.profile?.docs?.length) return NextResponse.json({ error: "값 자리 매핑이 비어 있습니다." }, { status: 400 });
    } else if (!body.spec || !Array.isArray(body.spec.coverBlocks)) {
      return NextResponse.json({ error: "양식 spec 이 올바르지 않습니다." }, { status: 400 });
    }
    if (body.kind === "standard" && (!body.serviceType || !body.serviceSubtype))
      return NextResponse.json({ error: "표준 셋은 용역 대분류·세분류가 필요합니다." }, { status: 400 });
    const templateId = await upsertTemplate({
      templateId: body.templateId ?? null,
      name: body.name.trim(),
      kind: body.kind,
      serviceType: body.serviceType ?? null,
      serviceSubtype: body.serviceSubtype ?? null,
      status: body.status,
      originFacilityId: body.originFacilityId ?? null,
      // overlay 는 spec 을 렌더에 쓰지 않지만, 폴백(원본 유실)·목록 표기를 위해 최소 형태를 남긴다
      spec: body.spec ?? { coverBlocks: [], terms: { orderer: "발주자", contractor: "과업수행자" } },
      renderMode,
      profile: body.profile ?? null,
      sourceKind: body.sourceKind ?? (body.sourceKey ? "hwpx" : null),
      sourceKey: body.sourceKey ?? null,
      createdBy: session.userId,
    });
    return NextResponse.json({ templateId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
