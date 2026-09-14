import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { attachOriginalWithholdingPdf, listYearendUploads } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 관리자 — ?year= 직원 셀프 업로드 자료 목록(연말정산 화면). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0);
    if (!year) return NextResponse.json({ error: "year 가 필요합니다." }, { status: 400 });
    const uploads = (await listYearendUploads(year)).map(({ fileKey: _k, ...u }) => u);
    return NextResponse.json({ uploads });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 관리자 — 세무법인 원본 원천징수영수증 PDF 등록(multipart: file, year, employeeId). 개인 열람·증명서 발급 원본이 된다. */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const form = await req.formData();
    const file = form.get("file");
    const year = Number(form.get("year") ?? 0);
    const employeeId = String(form.get("employeeId") ?? "");
    if (!(file instanceof File) || !year || !employeeId) {
      return NextResponse.json({ error: "file·year·employeeId 가 필요합니다." }, { status: 400 });
    }
    if (!/\.pdf$/i.test(file.name)) return NextResponse.json({ error: "PDF 파일만 등록할 수 있습니다." }, { status: 400 });
    await attachOriginalWithholdingPdf(year, employeeId, { fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
