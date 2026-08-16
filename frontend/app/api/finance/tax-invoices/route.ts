// 전자세금계산서 API (P4 F5)
// GET  : ?contractId=  계약별 발행 이력 · &milestoneId= 이면 발행 모달 프리필까지
// POST : issue(발행) · refresh(상태 폴링) · popup-url(원본 보기) · cancel(전송 전 취소)

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { buildIssuePrefill, listContractInvoices, listRecentInvoices, issueTaxInvoice, issueModifiedTaxInvoice, refreshInvoiceStates, invoicePopUpUrl, cancelTaxInvoice, type IssueParams, type ModifyParams } from "@/lib/barobill/invoicing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const contractId = sp.get("contractId") || "";
    if (!contractId) return NextResponse.json({ invoices: await listRecentInvoices(Number(sp.get("limit") || 100)) });
    const milestoneId = sp.get("milestoneId");
    if (milestoneId) return NextResponse.json({ prefill: await buildIssuePrefill(contractId, milestoneId) });
    return NextResponse.json({ invoices: await listContractInvoices(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody extends Partial<IssueParams>, Partial<Omit<ModifyParams, "writeDate" | "amountTotal" | "taxTotal" | "totalAmount" | "itemName" | "remark1">> {
  action: "issue" | "modify" | "refresh" | "popup-url" | "cancel";
  invoiceId?: string;
  invoiceIds?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "refresh") {
      await requirePermission("finance.view");
      return NextResponse.json(await refreshInvoiceStates(body.invoiceIds));
    }

    if (body.action === "popup-url") {
      await requirePermission("finance.view");
      if (!body.invoiceId) return NextResponse.json({ error: "invoiceId 가 필요합니다." }, { status: 400 });
      return NextResponse.json({ url: await invoicePopUpUrl(body.invoiceId) });
    }

    // 발행·취소는 국세청에 나가는 행위 — 별도 권한(과금 발생)
    const actor = await requirePermission("taxinvoice.issue");

    if (body.action === "issue") {
      const required = ["contractId", "milestoneId", "writeDate", "itemName", "invoicee", "invoicer"] as const;
      for (const key of required) {
        if (!body[key]) return NextResponse.json({ error: `${key} 가 필요합니다.` }, { status: 400 });
      }
      const result = await issueTaxInvoice(body as IssueParams, actor.userId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "tax_invoice_issue",
        targetTable: "tax_invoices",
        targetId: result.invoiceId,
        after: {
          contractId: body.contractId,
          milestoneId: body.milestoneId,
          totalAmount: body.totalAmount,
          invoicee: body.invoicee?.corpName,
          mgtKey: result.mgtKey,
        },
      });
      return NextResponse.json(result);
    }

    if (body.action === "modify") {
      const required = ["originalInvoiceId", "modifyCode", "writeDate", "itemName"] as const;
      for (const key of required) {
        if (!body[key]) return NextResponse.json({ error: `${key} 가 필요합니다.` }, { status: 400 });
      }
      const result = await issueModifiedTaxInvoice(
        {
          originalInvoiceId: body.originalInvoiceId!,
          modifyCode: body.modifyCode!,
          writeDate: body.writeDate!,
          amountTotal: Number(body.amountTotal ?? 0),
          taxTotal: Number(body.taxTotal ?? 0),
          totalAmount: Number(body.totalAmount ?? 0),
          itemName: body.itemName!,
          remark1: body.remark1,
          invoiceeEmail: body.invoiceeEmail,
        },
        actor.userId,
      );
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "tax_invoice_issue",
        targetTable: "tax_invoices",
        targetId: result.invoiceId,
        after: { modify: true, originalInvoiceId: body.originalInvoiceId, modifyCode: body.modifyCode, totalAmount: body.totalAmount },
      });
      return NextResponse.json(result);
    }

    if (body.action === "cancel") {
      if (!body.invoiceId) return NextResponse.json({ error: "invoiceId 가 필요합니다." }, { status: 400 });
      await cancelTaxInvoice(body.invoiceId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "tax_invoice_cancel",
        targetTable: "tax_invoices",
        targetId: body.invoiceId,
        after: { canceled: true },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "알 수 없는 액션입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
