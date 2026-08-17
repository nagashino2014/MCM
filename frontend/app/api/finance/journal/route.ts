import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  accountLedger,
  confirmEntry,
  listAccounts,
  listJournal,
  regenerateJournal,
  setEntryStatus,
  trialBalance,
  type JournalLineInput,
} from "@/lib/finance/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 전표·장부 조회 — view=list(분개장)/ledger(계정별원장)/trial(시산표)/accounts(계정 목록)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const view = sp.get("view") ?? "list";
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (view === "accounts") {
      return NextResponse.json({ accounts: await listAccounts() });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "기간(from/to, YYYY-MM-DD)이 필요합니다." }, { status: 400 });
    }
    if (view === "ledger") {
      const accountCode = sp.get("account") ?? "";
      if (!accountCode) return NextResponse.json({ error: "계정과목(account)이 필요합니다." }, { status: 400 });
      return NextResponse.json(await accountLedger({ accountCode, from, to }));
    }
    if (view === "trial") {
      return NextResponse.json(await trialBalance({ from, to }));
    }
    const status = sp.get("status") || undefined;
    return NextResponse.json({
      entries: await listJournal({
        from,
        to,
        status,
        sourceKind: sp.get("kind") || undefined,
        accountId: sp.get("accountId") || undefined,
        cardId: sp.get("cardId") || undefined,
        cardCompany: sp.get("cardCompany") || undefined,
        limit: Number(sp.get("limit") ?? 300) || 300,
      }),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "regenerate" | "confirm" | "exclude" | "unconfirm";
  from?: string;
  to?: string;
  entryId?: string;
  lines?: JournalLineInput[];
}

// POST: 재생성(finance.manage) / 확정·제외·확정취소(finance.manage)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "regenerate") {
      const result = await regenerateJournal(String(body.from ?? ""), String(body.to ?? ""));
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "journal_regenerate",
        targetTable: "journal_entries",
        targetId: `${body.from}~${body.to}`,
        after: { ...result },
      });
      return NextResponse.json(result);
    }
    if (!body.entryId) return NextResponse.json({ error: "entryId 가 필요합니다." }, { status: 400 });
    if (body.action === "confirm") {
      await confirmEntry(body.entryId, Array.isArray(body.lines) ? body.lines : [], ctx.userId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "exclude") {
      await setEntryStatus(body.entryId, "excluded", ctx.userId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "unconfirm") {
      await setEntryStatus(body.entryId, "pending", ctx.userId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
