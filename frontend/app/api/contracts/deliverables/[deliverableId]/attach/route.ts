import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { CATALOG_BY_TYPE } from "@/lib/deliverable/catalog";
import { generateDeliverableArtifacts, resolveSpecs, templateDocTitles } from "@/lib/deliverable/generate";
import { letterAttachItemsFor, letterBodyFor, letterSubjectFor } from "@/lib/deliverable/letter-template";
import { getDeliverable, getTemplate } from "@/lib/deliverable/store";
import { loadContractContext } from "@/lib/deliverable/data";

/**
 * 공문 첨부용 산출물 등록(D3) — PDF 를 생성·S3 보관하고 공문 작성 화면이 바로 쓸 수 있는
 * 첨부 항목({name,key,size})과 제목·본문·붙임 템플릿, 수신처(발주처)를 함께 돌려준다.
 * 공문 작성 화면이 /approval/letter?deliverable=<id> 로 진입할 때 한 번 호출한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deliverableId: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const { deliverableId } = await ctx.params;
    await requirePermission("contract.edit", { fallbackRoles: ["editor"] });

    const row = await getDeliverable(deliverableId);
    if (!row) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });

    // 산출물 보관 실패(스토리지 미설정 등)에도 제목·본문·붙임 템플릿은 돌려준다 —
    // 사용자가 파일만 직접 첨부하면 공문 작성을 이어갈 수 있게 한다.
    let attachment: { name: string; key: string; size: number } | null = null;
    let storageError: string | null = null;
    try {
      const { pdfKey, pdfBytes, fileBase } = await generateDeliverableArtifacts(deliverableId, { persist: true });
      if (pdfKey) attachment = { name: `${fileBase}.pdf`, key: pdfKey, size: pdfBytes.byteLength };
    } catch (e) {
      storageError = (e as Error).message;
      console.warn("[deliverable] 첨부 산출물 보관 실패:", storageError);
    }
    // 붙임 목록의 문서명 — 기본양식은 카탈로그, 발주처 자체양식은 그 양식의 서식 제목을 쓰되
    // 양식에 없는 기본 추가 서식(내역서·결과보고서·대금청구서)은 카탈로그 제목으로 채운다(2026-08-19)
    const tpl = row.templateId ? await getTemplate(row.templateId) : null;
    let docTitles: string[];
    if (tpl) {
      const titleByType = new Map(templateDocTitles(tpl).map((d) => [d.docType, d.title]));
      const picked = (row.docTypes.length ? row.docTypes : [...titleByType.keys()])
        .map((t) => titleByType.get(t) ?? CATALOG_BY_TYPE[t]?.title)
        .filter((t): t is string => !!t);
      docTitles = picked;
    } else {
      docTitles = (await resolveSpecs(row)).map((s) => CATALOG_BY_TYPE[s.docType]?.title ?? s.title);
    }
    const contractTitle = String(row.values["contract.title"] ?? row.title);

    // 수신처 = 계약 발주처(계약상대 업체). 공문 수신란 표기·주소 자동 채움용.
    const ctxRow = await loadContractContext(row.contractId);

    return NextResponse.json({
      deliverableId,
      kind: row.kind,
      attachment,
      storageError,
      subject: letterSubjectFor(row.kind, contractTitle),
      bodyHtml: letterBodyFor(row.kind, contractTitle),
      attachItems: letterAttachItemsFor(docTitles),
      recipient: ctxRow
        ? { name: ctxRow.ordererName, facilityName: ctxRow.ordererName, address: ctxRow.siteAddress }
        : null,
    });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
