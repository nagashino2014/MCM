import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { listSettlements } from "@/lib/finance/expense-settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?settlementId= : 생성된 CMS xlsx 다운로드(finance.view) — 키는 서버가 정산 이력에서 찾는다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const settlementId = req.nextUrl.searchParams.get("settlementId") ?? "";
    const settlement = (await listSettlements()).find((s) => s.settlementId === settlementId);
    if (!settlement?.cmsFileKey) return NextResponse.json({ error: "생성된 CMS 파일이 없습니다." }, { status: 404 });
    const buf = await readContractDocument(settlement.cmsFileKey);
    if (!buf) return NextResponse.json({ error: "파일을 읽지 못했습니다." }, { status: 404 });
    const fileName = settlement.cmsFileKey.split("/").pop() ?? "cms.xlsx";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
