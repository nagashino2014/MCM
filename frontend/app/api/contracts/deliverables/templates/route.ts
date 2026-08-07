import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { analyzeTemplateHwpx } from "@/lib/deliverable/template-analyze";
import { createTemplate, listTemplates, saveTemplateProfile, setTemplateSource } from "@/lib/deliverable/store";
import type { DeliverableKind, TemplateSourceKind } from "@/lib/deliverable/types";

/**
 * 발주처 자체양식(D4) — 목록 조회 / 업로드+분석.
 * HWPX 로 받은 양식은 원본을 보관해 두고 값만 주입하므로(overlay), 원본 파일이 곧 서식의 원본이다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind");
    const templates = await listTemplates({
      kind: kind === "start" || kind === "completion" ? kind : null,
      ownerFacilityId: sp.get("ownerFacilityId") || null,
    });
    return NextResponse.json({
      templates: templates.map((t) => ({
        templateId: t.templateId,
        name: t.name,
        kind: t.kind,
        ownerFacilityId: t.ownerFacilityId,
        ownerFacilityName: t.ownerFacilityName,
        sourceKind: t.sourceKind,
        renderMode: t.renderMode,
        analyzedAt: t.analyzedAt,
        analyzeNote: t.analyzeNote,
        docs: (t.profile?.docs ?? []).map((d) => ({
          docType: d.docType,
          title: d.title,
          slotCount: d.slots.length,
        })),
        updatedAt: t.updatedAt,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** multipart: name, kind, ownerFacilityId?, file — 업로드 즉시 분석까지 시도한다. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const name = String(form.get("name") ?? "").trim();
    const kindRaw = String(form.get("kind") ?? "").trim();
    const kind: DeliverableKind = kindRaw === "start" ? "start" : "completion";
    const ownerFacilityId = String(form.get("ownerFacilityId") ?? "").trim() || null;
    const file = form.get("file");

    if (!name) return NextResponse.json({ error: "양식 이름이 필요합니다." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "양식 파일이 필요합니다." }, { status: 400 });
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "양식 파일은 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }

    const lower = (file.name || "").toLowerCase();
    const sourceKind: TemplateSourceKind = lower.endsWith(".hwpx") ? "hwpx" : lower.endsWith(".pdf") ? "pdf" : "docx";
    if (sourceKind !== "hwpx") {
      // 한글 원본(.hwp)은 바이너리라 우리가 못 읽는다 — 한컴에서 HWPX 로 저장해 올려야 한다.
      return NextResponse.json(
        { error: "현재는 HWPX 양식만 지원합니다. 한글에서 '다른 이름으로 저장 → HWPX' 로 변환해 올려주세요." },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const templateId = await createTemplate({
      name,
      kind,
      ownerFacilityId,
      sourceKind,
      renderMode: "overlay",
      createdBy: actor.userId,
    });

    const sourceKey = `deliverable-templates/${templateId}/${sanitizeFilename(file.name || "form")}`;
    await putContractDocument(sourceKey, Buffer.from(bytes), "application/vnd.hancom.hwpx");
    await setTemplateSource(templateId, { sourceKind, sourceKey });

    // 분석이 실패해도 템플릿은 남긴다 — 사용자가 화면에서 직접 매핑할 수 있다.
    let analyzeError: string | null = null;
    try {
      const { profile } = await analyzeTemplateHwpx(bytes, kind);
      await saveTemplateProfile(templateId, profile);
    } catch (e) {
      analyzeError = (e as Error).message;
      console.warn("[deliverable] 양식 분석 실패:", analyzeError);
    }

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "deliverable_templates",
      targetId: templateId,
      after: { name, kind, sourceKind, analyzed: !analyzeError },
    });
    return NextResponse.json({ templateId, analyzeError });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
