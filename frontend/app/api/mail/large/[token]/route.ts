import { NextRequest, NextResponse } from "next/server";
import { resolveLargeAttachmentDownload } from "@/lib/mail/large-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, message: string, status: number): NextResponse {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:-apple-system,'Malgun Gothic',sans-serif;background:#f4f5f7;margin:0;padding:48px 16px;color:#111827">
<div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #e6e8eb;border-radius:10px;padding:24px">
<div style="font-size:16px;font-weight:700;margin-bottom:8px">${title}</div><div style="font-size:14px;color:#6b7280;line-height:1.6">${message}</div>
</div></body></html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * 메일 대용량 첨부 다운로드(261) — 외부 수신자용 무인증 경로(edge-config 허용 목록).
 * 토큰은 무작위 32바이트. 확인되면 5분짜리 presigned GET 으로 넘긴다.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const out = await resolveLargeAttachmentDownload(token);
    if (!out) return page("파일을 찾을 수 없습니다", "링크가 잘못되었거나 삭제된 첨부입니다. 보낸 사람에게 다시 요청해 주세요.", 404);
    if ("expired" in out) return page("다운로드 기간이 지났습니다", "대용량 첨부 보관기간이 끝났습니다. 보낸 사람에게 다시 요청해 주세요.", 410);
    return NextResponse.redirect(out.url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[mail-large] 다운로드 실패", err);
    return page("잠시 후 다시 시도해 주세요", "파일을 준비하는 중 오류가 발생했습니다.", 500);
  }
}
