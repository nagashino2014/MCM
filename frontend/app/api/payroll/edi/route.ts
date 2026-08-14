import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getEdiStatus, parseEdiCsv, saveEdiNotices } from "@/lib/payroll/edi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?year&month — 해당 귀속월 EDI 업로드 상태 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const year = Number(sp.get("year"));
    const month = Number(sp.get("month"));
    if (!year || !month) return NextResponse.json({ error: "year·month가 필요합니다." }, { status: 400 });
    return NextResponse.json(await getEdiStatus(year, month));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** multipart: file(건강보험/연금 고지산출내역 CSV, cp949) + year + month — 종류 자동 감지 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const form = await req.formData();
    const file = form.get("file");
    const year = Number(form.get("year"));
    const month = Number(form.get("month"));
    if (!(file instanceof File) || !year || !month) {
      return NextResponse.json({ error: "file·year·month가 필요합니다." }, { status: 400 });
    }
    const parsed = parseEdiCsv(await file.arrayBuffer());
    const result = await saveEdiNotices(year, month, parsed, file.name);
    return NextResponse.json({ insurer: parsed.insurer, ...result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
