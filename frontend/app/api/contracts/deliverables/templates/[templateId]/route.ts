import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { readStorageObject } from "@/lib/contracts/document-bundle";
import { parseHwpx } from "@/lib/deliverable/hwpx-doc";
import { outlineHwpx } from "@/lib/deliverable/template-form";
import { analyzeTemplateHwpx } from "@/lib/deliverable/template-analyze";
import { analyzeTemplateScan } from "@/lib/deliverable/template-scan";
import { deleteTemplate, getTemplate, saveTemplateProfile, saveTemplateSpec } from "@/lib/deliverable/store";
import type { TemplateProfile } from "@/lib/deliverable/types";

/**
 * 발주처 자체양식 한 건 — 매핑 확인/보정/재분석/삭제.
 * GET 은 매핑과 함께 원본의 문단·표 개요를 돌려준다(화면에서 "어느 자리인지" 보여주기 위함).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { templateId } = await ctx.params;
    await requirePermission("contract.view");
    const tpl = await getTemplate(templateId);
    if (!tpl) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });

    // 개요는 무거우므로 필요할 때만(편집 화면)
    let outline = null;
    if (req.nextUrl.searchParams.get("outline") === "1" && tpl.sourceKey) {
      try {
        outline = outlineHwpx(await parseHwpx(await readStorageObject(tpl.sourceKey)));
      } catch (e) {
        console.warn("[deliverable] 양식 개요 추출 실패:", (e as Error).message);
      }
    }
    return NextResponse.json({ template: tpl, outline });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 매핑 보정 저장(profile) 또는 재분석(reanalyze). */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { templateId } = await ctx.params;
    await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const tpl = await getTemplate(templateId);
    if (!tpl) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { profile?: TemplateProfile; reanalyze?: boolean };

    if (body.reanalyze) {
      if (!tpl.sourceKey) return NextResponse.json({ error: "원본 파일이 없어 재분석할 수 없습니다." }, { status: 400 });
      const source = await readStorageObject(tpl.sourceKey);
      if (tpl.sourceKind === "pdf") {
        // 스캔 PDF 는 구조를 다시 그리는 것이라 재분석 시 고정밀 모델을 쓴다(저화질 대비)
        const { specs, note, model } = await analyzeTemplateScan(source, tpl.kind, { highQuality: true });
        await saveTemplateSpec(templateId, specs, { analyzedAt: new Date().toISOString(), analyzeModel: model, analyzeNote: note ?? null });
        return NextResponse.json({ specs });
      }
      const { profile } = await analyzeTemplateHwpx(source, tpl.kind);
      await saveTemplateProfile(templateId, profile);
      return NextResponse.json({ profile });
    }

    if (body.profile) {
      // 사용자가 고친 매핑은 분석 시각·모델을 사람 손으로 표시해 둔다
      const profile: TemplateProfile = {
        ...body.profile,
        analyzedAt: new Date().toISOString(),
        model: `${tpl.analyzeModel ?? "manual"} + 사용자 보정`,
      };
      await saveTemplateProfile(templateId, profile);
      return NextResponse.json({ profile });
    }
    return NextResponse.json({ error: "저장할 내용이 없습니다." }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { templateId } = await ctx.params;
    await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    await deleteTemplate(templateId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
