import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyYearend, uploadMyYearendFile, type YearendUploadKind } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 내 연말정산 개요 — 귀속연도별 정산 상태·결과·업로드 자료·원본 영수증 유무(본인 스코프). */
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json(await listMyYearend(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 자료 업로드(multipart: file, year, kind=simplified_pdf|deduction_form|other) — 보관 + 파싱 + 미확정 정산에 반영. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    const year = Number(form.get("year") ?? 0);
    const kindRaw = String(form.get("kind") ?? "other");
    const kind: YearendUploadKind = kindRaw === "simplified_pdf" || kindRaw === "deduction_form" ? kindRaw : "other";
    if (!(file instanceof File)) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    if (!year || year < 2000 || year > 2100) return NextResponse.json({ error: "귀속연도가 올바르지 않습니다." }, { status: 400 });
    const out = await uploadMyYearendFile(ctx.userId, {
      year,
      kind,
      fileName: file.name,
      contentType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
      label: String(form.get("label") ?? "").trim().slice(0, 40) || null,
    });
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
