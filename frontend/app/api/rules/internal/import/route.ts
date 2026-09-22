// POST /api/rules/internal/import — HWPX·DOCX·TXT·MD → 조문 IR + 머리 정보 + 번호 자동 교정 결과.
// DB 에는 저장하지 않는다 — 편집 화면이 결과를 받아 확인·수정한 뒤 [저장]으로 남긴다.

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { importInternalRule } from "@/lib/rules/internal-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("rules.manage");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "파일을 선택해 주세요." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "파일이 너무 큽니다(최대 30MB)." }, { status: 400 });

    let result;
    try {
      result = await importInternalRule(file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "파일을 해석하지 못했습니다." }, { status: 400 });
    }
    if (!result.stats.articles) {
      return NextResponse.json(
        { error: "조문(제N조)을 하나도 찾지 못했습니다. '제1조(목적)'처럼 조 표기가 있는 규정 문서인지 확인해 주세요." },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
