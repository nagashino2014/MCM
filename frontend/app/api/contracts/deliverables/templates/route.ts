import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { analyzeTemplateHwpx } from "@/lib/deliverable/template-analyze";
import { analyzeTemplateScan } from "@/lib/deliverable/template-scan";
import { createTemplate, listTemplates, saveTemplateProfile, saveTemplateSpec, setTemplateSource } from "@/lib/deliverable/store";
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
        // overlay 는 매핑(profile)에서, spec(스캔 PDF 재구축)은 블록 수로 규모를 보여준다
        docs:
          t.renderMode === "overlay"
            ? (t.profile?.docs ?? []).map((d) => ({ docType: d.docType, title: d.title, slotCount: d.slots.length }))
            : t.specs.map((s) => ({ docType: s.docType, title: s.title, slotCount: s.blocks.length })),
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
    const sourceKind: TemplateSourceKind | null = lower.endsWith(".hwpx") ? "hwpx" : lower.endsWith(".pdf") ? "pdf" : null;
    if (!sourceKind) {
      // 한글 원본(.hwp)은 바이너리라 우리가 못 읽는다 — 한컴에서 HWPX 로 저장해야 한다.
      return NextResponse.json(
        { error: "HWPX 또는 PDF 만 올릴 수 있습니다. 한글 파일(.hwp)은 '다른 이름으로 저장 → HWPX' 로 변환해 주세요." },
        { status: 400 }
      );
    }
    // HWPX 는 원본을 그대로 두고 값만 주입한다(서식 보존). PDF 는 구조를 읽어 재구축한다(근사).
    const renderMode = sourceKind === "hwpx" ? "overlay" : "spec";

    const bytes = new Uint8Array(await file.arrayBuffer());
    const templateId = await createTemplate({
      name,
      kind,
      ownerFacilityId,
      sourceKind,
      renderMode,
      createdBy: actor.userId,
    });

    const sourceKey = `deliverable-templates/${templateId}/${sanitizeFilename(file.name || "form")}`;
    const contentType = sourceKind === "hwpx" ? "application/vnd.hancom.hwpx" : "application/pdf";
    await putContractDocument(sourceKey, Buffer.from(bytes), contentType);
    await setTemplateSource(templateId, { sourceKind, sourceKey });

    // 분석이 실패해도 템플릿은 남긴다 — 사용자가 화면에서 직접 매핑할 수 있다.
    let analyzeError: string | null = null;
    try {
      if (sourceKind === "hwpx") {
        const { profile } = await analyzeTemplateHwpx(bytes, kind);
        await saveTemplateProfile(templateId, profile);
      } else {
        const { specs, note, model } = await analyzeTemplateScan(bytes, kind);
        await saveTemplateSpec(templateId, specs, { analyzedAt: new Date().toISOString(), analyzeModel: model, analyzeNote: note ?? null });
      }
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
