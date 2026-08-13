import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { buildStatementPdf } from "@/lib/bonus/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 지급 명세서 PDF 미리보기/다운로드 — 관리자 전용(발송 전 확인용). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const sp = new URL(req.url).searchParams;
    const p = parsePeriod(sp.get("period") ?? "");
    const employeeId = sp.get("employeeId") ?? "";
    if (!p || !employeeId) {
      return NextResponse.json({ error: "period/employeeId가 필요합니다." }, { status: 400 });
    }
    const pdf = await buildStatementPdf(p, employeeId);
    if (!pdf) return NextResponse.json({ error: "산정 결과가 없습니다." }, { status: 404 });
    return new NextResponse(Buffer.from(pdf.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
