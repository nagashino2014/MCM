import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getDb, rowsToObjects } from "@/lib/db";
import {
  registTaxInvoiceScrap,
  updateTaxInvoiceScrap,
  getTaxInvoiceScrapRequestUrl,
  syncHometaxInvoices,
  type ScrapRegistInput,
} from "@/lib/barobill/hometax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 홈택스 수집 현황 — 마지막 수집·월별 적재 요약
export async function GET() {
  try {
    await requirePermission("finance.view");
    const db = await getDb();
    const syncRows = rowsToObjects(
      await db.exec(
        `SELECT status, fetched, inserted, error, started_at, finished_at
           FROM finance_sync_logs WHERE kind = 'hometax' ORDER BY started_at DESC LIMIT 5`,
      ),
    );
    const monthly = rowsToObjects(
      await db.exec(
        `SELECT substr(write_date, 1, 7) AS month, direction, count(*) AS n,
                COALESCE(SUM(amount_total), 0) AS supply, COALESCE(SUM(tax_total), 0) AS tax
           FROM hometax_tax_invoices
          GROUP BY substr(write_date, 1, 7), direction
          ORDER BY month DESC LIMIT 48`,
      ),
    );
    return NextResponse.json({
      recentSyncs: syncRows.map((r) => ({
        status: String(r.status),
        fetched: Number(r.fetched || 0),
        inserted: Number(r.inserted || 0),
        error: r.error ? String(r.error) : null,
        startedAt: String(r.started_at ?? ""),
        finishedAt: r.finished_at ? String(r.finished_at) : null,
      })),
      monthly: monthly.map((r) => ({
        month: String(r.month),
        direction: String(r.direction),
        count: Number(r.n || 0),
        supply: Number(r.supply || 0),
        tax: Number(r.tax || 0),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "regist_scrap" | "update_scrap" | "scrap_request_url" | "sync";
  loginMethod?: "ID" | "CERT";
  hometaxId?: string;
  hometaxPwd?: string;
  shortJuminNum?: string;
  fromMonth?: string; // YYYYMM
  toMonth?: string;
}

// POST: 수집 서비스 신청/변경(자격증명은 바로빌에 전달만, 저장·로그 기록 안 함) / 수집 실행
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "regist_scrap" || body.action === "update_scrap") {
      const input: ScrapRegistInput = {
        loginMethod: body.loginMethod === "CERT" ? "CERT" : "ID",
        hometaxId: body.hometaxId,
        hometaxPwd: body.hometaxPwd,
        shortJuminNum: body.shortJuminNum,
      };
      if (input.loginMethod === "ID" && (!input.hometaxId || !input.hometaxPwd || !input.shortJuminNum)) {
        return NextResponse.json({ error: "홈택스 아이디·비밀번호·주민등록번호 앞 7자리가 필요합니다." }, { status: 400 });
      }
      if (body.action === "regist_scrap") await registTaxInvoiceScrap(input);
      else await updateTaxInvoiceScrap(input);
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "hometax_scrap_regist",
        targetTable: "finance_sync_logs",
        targetId: body.action,
        after: { loginMethod: input.loginMethod }, // 자격증명은 기록하지 않는다
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "scrap_request_url") {
      return NextResponse.json({ url: await getTaxInvoiceScrapRequestUrl() });
    }
    if (body.action === "sync") {
      const range =
        body.fromMonth && /^\d{6}$/.test(body.fromMonth)
          ? { fromMonth: body.fromMonth, toMonth: body.toMonth && /^\d{6}$/.test(body.toMonth) ? body.toMonth : body.fromMonth }
          : undefined;
      const result = await syncHometaxInvoices(range);
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "hometax_sync",
        targetTable: "hometax_tax_invoices",
        targetId: `${result.months[0] ?? ""}~${result.months[result.months.length - 1] ?? ""}`,
        after: { fetched: result.fetched, inserted: result.inserted, errors: result.errors.length },
      });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
