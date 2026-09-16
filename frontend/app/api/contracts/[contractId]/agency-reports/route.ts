import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { AGENCY_REPORT_MAX_BYTES, storeAgencyReportPdf } from "@/lib/filings/agency-report-document";
import { deliverAgencyReport } from "@/lib/filings/agency-report-delivery";
import { createAgencyReport, isAgencyReportKind, isReportDeliveryMode, listAgencyReports } from "@/lib/filings/agency-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

/** 계약의 대행 실적 보고 이력 — 체결 → 변경 → 완료 순. */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    await requirePermission("contract.view", { target: { contractId } });
    return NextResponse.json({ reports: await listAgencyReports(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 이력 추가 — multipart/form-data. IEPS 에서 신고를 마치고 받은 실적보고 출력 PDF 를 함께 올린다.
 * 필드: reportKind(conclude|amend|complete), reportedOn(YYYY-MM-DD), receiptNo?, note?, file?(PDF),
 *       deliveryMode?(mail|messenger|both|hold — 비우면 설정 기본값)
 * PDF 를 함께 올리면 실무자에게 바로 발송한다(254) — 결과는 응답의 delivery.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const form = await req.formData();
    const reportKind = String(form.get("reportKind") ?? "").trim();
    const reportedOn = String(form.get("reportedOn") ?? "").trim();
    const receiptNo = String(form.get("receiptNo") ?? "").trim() || null;
    const note = String(form.get("note") ?? "").trim() || null;
    const file = form.get("file");
    const deliveryModeRaw = String(form.get("deliveryMode") ?? "").trim();
    const deliveryMode = isReportDeliveryMode(deliveryModeRaw) ? deliveryModeRaw : null;

    if (!isAgencyReportKind(reportKind)) {
      return NextResponse.json({ error: "신고 구분은 체결·변경·완료 중 하나여야 합니다." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportedOn)) {
      return NextResponse.json({ error: "신고일은 8자리(YYYYMMDD)로 입력해 주세요." }, { status: 400 });
    }
    if (file instanceof File) {
      if (file.size > AGENCY_REPORT_MAX_BYTES) {
        return NextResponse.json({ error: "신고서 PDF는 30MB 이하만 올릴 수 있습니다." }, { status: 400 });
      }
      if (file.type && file.type !== "application/pdf") {
        return NextResponse.json({ error: "신고서는 PDF 파일만 올릴 수 있습니다." }, { status: 400 });
      }
    }

    const db = await getDb();
    const contractRows = rowsToObjects(
      await db.exec(`SELECT contract_title, contract_date, started_at FROM contracts WHERE contract_id = $1`, [contractId])
    );
    if (contractRows.length === 0) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    const contractTitle = String(contractRows[0]?.contract_title ?? "").trim();
    const contractDate =
      String(contractRows[0]?.contract_date ?? "").trim() || String(contractRows[0]?.started_at ?? "").trim();
    if (file instanceof File && (!contractTitle || !/^\d{4}-\d{2}-\d{2}$/.test(contractDate))) {
      return NextResponse.json(
        { error: "계약명·계약일자가 있어야 신고서 파일을 보관할 수 있습니다." },
        { status: 400 }
      );
    }

    const reportId = await withDbWrite(async (txn) => {
      const documentId =
        file instanceof File
          ? await storeAgencyReportPdf(txn, {
              contractId,
              contractTitle,
              contractDate,
              reportedOn,
              reportKind,
              file,
              actorUserId: actor.userId,
            })
          : null;
      const id = await createAgencyReport(
        contractId,
        { reportKind, reportedOn, receiptNo, note, documentId },
        actor.userId,
        txn
      );
      if (deliveryMode) {
        await txn.run(`UPDATE contract_agency_reports SET delivery_mode = $2 WHERE report_id = $1`, [id, deliveryMode]);
      }
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "agency_report_create",
        targetTable: "contract_agency_reports",
        targetId: id,
        after: { contractId, reportKind, reportedOn, receiptNo, documentId },
      });
      return id;
    });

    // 신고서 PDF 가 붙었으면 실무자에게 발송(설정·건별 방식에 따라 보류일 수도 있다)
    const delivery = file instanceof File ? await deliverAgencyReport(reportId, actor.userId).catch((e) => ({
      status: "failed" as const, mode: deliveryMode ?? "mail", channels: [], recipients: [], error: (e as Error).message, staffingPath: null,
    })) : null;
    const reports = await listAgencyReports(contractId);
    return NextResponse.json({ reportId, reports, delivery });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
