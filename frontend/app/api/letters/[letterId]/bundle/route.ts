import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse, sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { buildLetterBundleHwpx, buildLetterBundlePdf, hwpCombineStatus, letterFileBase, listLetterAttachments } from "@/lib/letter/bundle";
import { getLetterById } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// GET: 공문 + 첨부서류 결합 파일(2026-11-03).
//   ?format=pdf(기본) — 공문 뒤에 첨부를 순서대로 이은 PDF. ?disposition=inline 이면 뷰어용이며,
//     X-Letter-Parts 헤더(JSON, URI 인코딩)에 문서별 시작 쪽·쪽수·미리보기 오류를 싣는다.
//   ?format=hwpx — 첨부가 모두 HWPX 일 때만. 아니면 422 와 사유(뷰어 버튼 툴팁과 같은 문장).
export async function GET(req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    const attachments = await listLetterAttachments(letter);
    const base = `${letterFileBase(letter)}_첨부포함`;

    if (req.nextUrl.searchParams.get("format") === "hwpx") {
      const status = hwpCombineStatus(letter, attachments);
      if (!status.enabled) return NextResponse.json({ error: status.reason }, { status: 422 });
      try {
        const bytes = await buildLetterBundleHwpx(letter, attachments);
        return binaryResponse(bytes, "application/vnd.hancom.hwpx", `${base}.hwpx`);
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: 422 });
      }
    }

    let bundle: Awaited<ReturnType<typeof buildLetterBundlePdf>>;
    try {
      bundle = await buildLetterBundlePdf(letter, attachments);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 422 });
    }
    if (req.nextUrl.searchParams.get("disposition") === "inline") {
      return new NextResponse(Buffer.from(bundle.pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(`${base}.pdf`))}`,
          "Cache-Control": "private, max-age=0, no-store",
          "X-Letter-Parts": encodeURIComponent(JSON.stringify(bundle.parts)),
        },
      });
    }
    return binaryResponse(bundle.pdf, "application/pdf", `${base}.pdf`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
