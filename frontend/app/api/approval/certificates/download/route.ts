import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getCertificateIssue } from "@/lib/approval/certificates";
import { readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?issueId= : 발급본 PDF — 발급 담당(approval.manage) 또는 기안자 본인만.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const issueId = req.nextUrl.searchParams.get("issueId") ?? "";
    const wantHwpx = req.nextUrl.searchParams.get("format") === "hwpx";
    const issue = await getCertificateIssue(issueId);
    const key = wantHwpx ? issue?.hwpxKey : issue?.fileKey;
    if (!issue || !key) return NextResponse.json({ error: "발급본이 없습니다." }, { status: 404 });
    if (issue.userId !== ctx.userId && !(await hasPermission(ctx.userId, "approval.manage"))) {
      return NextResponse.json({ error: "이 발급본을 열람할 권한이 없습니다." }, { status: 403 });
    }
    const buf = await readContractDocument(key);
    if (!buf) return NextResponse.json({ error: "파일을 읽지 못했습니다." }, { status: 404 });
    const fileName = key.split("/").pop() ?? (wantHwpx ? "certificate.hwpx" : "certificate.pdf");
    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" && !wantHwpx ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": wantHwpx ? "application/vnd.hancom.hwpx" : "application/pdf",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
