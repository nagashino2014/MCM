import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteImportBatch, importLedger, listImportBatches, reconcileReport } from "@/lib/finance/ledger-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 백테스트 하네스(§7 T1-①) — 세무법인 결산 자료(계정 원장 엑셀) 임포트 + 앱 전표와 계정별 대사.

// GET: 배치 목록(기본) 또는 ?batchId= 대사 리포트
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const batchId = req.nextUrl.searchParams.get("batchId");
    if (batchId) return NextResponse.json(await reconcileReport(batchId));
    return NextResponse.json({ batches: await listImportBatches() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 엑셀 업로드(multipart: file, year) → 배치 적재 + 미매칭 계정 리포트
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "엑셀 파일을 첨부하세요." }, { status: 400 });
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      return NextResponse.json({ error: "엑셀(xls/xlsx) 형식만 지원합니다." }, { status: 400 });
    }
    const result = await importLedger({
      buf: Buffer.from(await file.arrayBuffer()),
      yearLabel: String(form.get("year") ?? ""),
      fileName: file.name,
      actorUserId: ctx.userId,
    });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "journal_ledger_import",
      targetTable: "ledger_import_batches",
      targetId: result.batchId,
      after: { fileName: file.name, lineCount: result.lineCount },
    });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 배치 삭제(?batchId=)
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const batchId = req.nextUrl.searchParams.get("batchId");
    if (!batchId) return NextResponse.json({ error: "batchId 가 필요합니다." }, { status: 400 });
    await deleteImportBatch(batchId);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "journal_ledger_import_delete",
      targetTable: "ledger_import_batches",
      targetId: batchId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
