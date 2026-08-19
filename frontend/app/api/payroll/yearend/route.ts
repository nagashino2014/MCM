import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { listSettlements, saveSettlement, setSettlementStatus, type YearendInputs } from "@/lib/finance/yearend";
import { parseSimplifiedPdf } from "@/lib/finance/yearend-pdf-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 귀속연도 직원별 정산 목록(총급여·기납부 자동 + 저장된 입력·결과). 급여는 admin 전용(§8-4).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0) || new Date().getFullYear() - 1;
    const rows = await listSettlements(year);
    // 접속기록(PR-P1) — 연말정산(전 직원 소득·부양가족) 열람.
    await recordAccessLog({ actorUserId: ctx.userId, action: "view", targetKind: "yearend", targetId: String(year) });
    return NextResponse.json({ year, rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: JSON(action=save/confirm/unconfirm) 또는 multipart(action=parse_pdf — 간소화 PDF 파싱)
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "PDF 파일이 필요합니다." }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const parsed = await parseSimplifiedPdf(buf);
      if (!parsed) return NextResponse.json({ error: "PDF 파싱에 실패했습니다 — 값을 직접 입력해 주세요." }, { status: 422 });
      return NextResponse.json(parsed);
    }

    const body = (await req.json().catch(() => ({}))) as {
      action?: "save" | "confirm" | "unconfirm";
      year?: number;
      employeeId?: string;
      inputs?: YearendInputs;
      memo?: string | null;
    };
    const year = Number(body.year ?? 0);
    if (!year || !body.employeeId) return NextResponse.json({ error: "year/employeeId 가 필요합니다." }, { status: 400 });

    if (body.action === "save") {
      const result = await saveSettlement(year, body.employeeId, body.inputs ?? {}, body.memo);
      return NextResponse.json({ result });
    }
    if (body.action === "confirm" || body.action === "unconfirm") {
      await setSettlementStatus(year, body.employeeId, body.action === "confirm" ? "confirmed" : "draft");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
