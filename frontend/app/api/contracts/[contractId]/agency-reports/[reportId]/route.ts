import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  AGENCY_REPORT_MAX_BYTES,
  removeAgencyReportPdf,
  storeAgencyReportPdf,
} from "@/lib/filings/agency-report-document";
import { deliverAgencyReport } from "@/lib/filings/agency-report-delivery";
import { getAgencyReport, isAgencyReportKind, isReportDeliveryMode, listAgencyReports } from "@/lib/filings/agency-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; reportId: string }>;
}

/**
 * 이력 수정 — multipart/form-data.
 * 필드: reportKind?, reportedOn?, receiptNo?, note?, file?(신고서 PDF 새로 첨부·교체), removeFile=1(첨부 해제),
 *       deliveryMode?(mail|messenger|both|hold, 빈 값 = 기본값으로 되돌림)
 * 새 PDF 가 붙으면 실무자에게 발송한다(254) — 결과는 응답의 delivery.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, reportId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const current = await getAgencyReport(reportId);
    if (!current || current.contractId !== contractId) {
      return NextResponse.json({ error: "신고 이력을 찾을 수 없습니다." }, { status: 404 });
    }

    const form = await req.formData();
    const has = (key: string) => form.get(key) !== null;
    const reportKind = has("reportKind") ? String(form.get("reportKind")).trim() : current.reportKind;
    const reportedOn = has("reportedOn") ? String(form.get("reportedOn")).trim() : current.reportedOn;
    const receiptNo = has("receiptNo") ? String(form.get("receiptNo")).trim() || null : current.receiptNo;
    const note = has("note") ? String(form.get("note")).trim() || null : current.note;
    const removeFile = String(form.get("removeFile") ?? "") === "1";
    const hasDeliveryMode = form.get("deliveryMode") !== null;
    const deliveryModeRaw = String(form.get("deliveryMode") ?? "").trim();
    const deliveryMode = isReportDeliveryMode(deliveryModeRaw) ? deliveryModeRaw : null;
    const file = form.get("file");

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
    const contractTitle = String(contractRows[0]?.contract_title ?? "").trim();
    const contractDate =
      String(contractRows[0]?.contract_date ?? "").trim() || String(contractRows[0]?.started_at ?? "").trim();
    if (file instanceof File && (!contractTitle || !/^\d{4}-\d{2}-\d{2}$/.test(contractDate))) {
      return NextResponse.json(
        { error: "계약명·계약일자가 있어야 신고서 파일을 보관할 수 있습니다." },
        { status: 400 }
      );
    }

    await withDbWrite(async (txn) => {
      let documentId = current.documentId;
      if (file instanceof File) {
        documentId = await storeAgencyReportPdf(txn, {
          contractId,
          contractTitle,
          contractDate,
          reportedOn,
          reportKind,
          file,
          actorUserId: actor.userId,
        });
      } else if (removeFile) {
        documentId = null;
      }
      await txn.run(
        `UPDATE contract_agency_reports
            SET report_kind = $2, reported_on = $3, receipt_no = $4, note = $5, document_id = $6, updated_at = $7
          WHERE report_id = $1`,
        [reportId, reportKind, reportedOn, receiptNo, note, documentId, new Date().toISOString()]
      );
      if (hasDeliveryMode) {
        await txn.run(`UPDATE contract_agency_reports SET delivery_mode = $2 WHERE report_id = $1`, [reportId, deliveryMode]);
      }
      // 교체·해제로 떨어져 나온 옛 신고서 PDF 정리(다른 이력이 쓰고 있으면 남긴다)
      if (current.documentId && current.documentId !== documentId) {
        await removeAgencyReportPdf(txn, current.documentId);
      }
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "agency_report_update",
        targetTable: "contract_agency_reports",
        targetId: reportId,
        before: {
          reportKind: current.reportKind,
          reportedOn: current.reportedOn,
          receiptNo: current.receiptNo,
          documentId: current.documentId,
        },
        after: { reportKind, reportedOn, receiptNo, documentId },
      });
    });

    const delivery = file instanceof File ? await deliverAgencyReport(reportId, actor.userId).catch((e) => ({
      status: "failed" as const, mode: deliveryMode ?? "mail", channels: [], recipients: [], error: (e as Error).message, staffingPath: null,
    })) : null;
    return NextResponse.json({ reports: await listAgencyReports(contractId), delivery });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 이력 삭제 — 이 이력에만 매달린 신고서 PDF 도 함께 지운다. */
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, reportId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const current = await getAgencyReport(reportId);
    if (!current || current.contractId !== contractId) {
      return NextResponse.json({ error: "신고 이력을 찾을 수 없습니다." }, { status: 404 });
    }
    await withDbWrite(async (txn) => {
      await txn.run(`DELETE FROM contract_agency_reports WHERE report_id = $1`, [reportId]);
      if (current.documentId) await removeAgencyReportPdf(txn, current.documentId);
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "agency_report_delete",
        targetTable: "contract_agency_reports",
        targetId: reportId,
        before: { contractId, reportKind: current.reportKind, reportedOn: current.reportedOn },
      });
    });
    return NextResponse.json({ reports: await listAgencyReports(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
