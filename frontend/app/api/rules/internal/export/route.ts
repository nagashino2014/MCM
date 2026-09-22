// POST /api/rules/internal/export — 내부 규정 PDF·HWPX 내려받기(일람 표시창·작성 화면 공용).
// 화면에 올라와 있는 머리 정보·조문 IR 을 그대로 출력한다(작성 중 저장 전 내용 포함). 저장은 하지 않는다.
// body: { header: { title, regNo, ownerDept, approver, enactedDate }, body: RuleBody, format: "pdf" | "hwpx" }

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { renderFlowHwpx } from "@/lib/flowdoc/hwpx";
import { renderFlowPdf } from "@/lib/flowdoc/pdf";
import { buildRuleFlow, ruleExportFileBase, type RuleExportHeader } from "@/lib/rules/export";
import type { RuleBody } from "@/lib/rules/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("rules.view");
    const payload = (await req.json().catch(() => ({}))) as { header?: RuleExportHeader; body?: RuleBody; format?: string };
    if (!payload.body || !Array.isArray(payload.body.chapters)) {
      return NextResponse.json({ error: "조문 본문이 없습니다." }, { status: 400 });
    }
    const header: RuleExportHeader = {
      title: String(payload.header?.title ?? ""),
      regNo: payload.header?.regNo ? Number(payload.header.regNo) || null : null,
      ownerDept: payload.header?.ownerDept ?? null,
      approver: payload.header?.approver ?? null,
      enactedDate: payload.header?.enactedDate ?? null,
    };
    const body: RuleBody = {
      chapters: payload.body.chapters ?? [],
      addendum: payload.body.addendum ?? [],
      appendices: payload.body.appendices ?? [],
      history: payload.body.history ?? [],
    };
    const format = payload.format === "hwpx" ? "hwpx" : "pdf";
    const blocks = buildRuleFlow(header, body);
    const bytes = format === "hwpx" ? await renderFlowHwpx(blocks, { pageNumbers: true }) : await renderFlowPdf(blocks, { pageNumbers: true });
    const name = sanitizeDownloadName(`${ruleExportFileBase(header)}.${format}`);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": format === "hwpx" ? "application/vnd.hancom.hwpx" : "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
