import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { buildIncomeLedgerWorkbook, listIncomeLedger, type IncomeKind } from "@/lib/finance/income-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?year=&kind= : 사업·기타소득 대장 조회(205). ?format=xlsx 는 실무 대장 양식 엑셀(주민번호 복호화
// 전체 표기 — 세무 제출용이므로 finance.manage 로 승격).
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year")) || new Date().getFullYear();
    if (sp.get("format") === "xlsx") {
      await requirePermission("finance.manage");
      const buf = await buildIncomeLedgerWorkbook(year);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`기타소득 & 사업소득대장(${year}).xlsx`)}`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }
    await requirePermission("finance.view");
    const kind = sp.get("kind");
    const rows = await listIncomeLedger(year, kind === "business" || kind === "other" ? (kind as IncomeKind) : undefined);
    return NextResponse.json({ rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
