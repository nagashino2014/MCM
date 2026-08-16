// 수금 자동대조 API (P3 F4)
// GET  : 검토 큐(bucket=high|review|other|confirmed) · ?receivables=1 이면 수동 매칭용 미수 목록
// POST : run(매칭 재실행) · confirm / bulk-confirm(일괄 승인) · reject · unconfirm(확정 되돌리기) · manual(수동 매칭)

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listReconQueue, listOpenReceivables, runRecon, confirmMatch, rejectMatch, unconfirmMatch, manualMatch } from "@/lib/barobill/recon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    if (sp.get("receivables") === "1") {
      return NextResponse.json({ receivables: await listOpenReceivables(sp.get("facilityId") || undefined) });
    }
    const bucketParam = sp.get("bucket");
    const bucket = bucketParam === "review" || bucketParam === "other" || bucketParam === "confirmed" ? bucketParam : "high";
    return NextResponse.json(await listReconQueue({ bucket }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action: "run" | "confirm" | "bulk-confirm" | "reject" | "unconfirm" | "manual";
  matchId?: string;
  matchIds?: string[];
  from?: string;
  to?: string;
  includeAll?: boolean;
  txnId?: string;
  facilityId?: string | null;
  lines?: Array<{ milestoneId: string; allocatedAmount: number }>;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "run") {
      const actor = await requirePermission("finance.manage");
      const result = await runRecon({ from: body.from, to: body.to, includeAll: body.includeAll === true });
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_recon_run",
        targetTable: "recon_matches",
        targetId: "run",
        after: result,
      });
      return NextResponse.json(result);
    }

    // 확정 계열은 수금 반영이므로 recon.confirm 권한
    const actor = await requirePermission("recon.confirm");

    if (body.action === "confirm" || body.action === "bulk-confirm") {
      const ids = body.action === "confirm" ? (body.matchId ? [body.matchId] : []) : body.matchIds ?? [];
      if (!ids.length) return NextResponse.json({ error: "대상이 없습니다." }, { status: 400 });
      const failed: Array<{ matchId: string; error: string }> = [];
      let confirmed = 0;
      for (const id of ids) {
        try {
          await confirmMatch(id, actor.userId);
          confirmed += 1;
        } catch (err) {
          failed.push({ matchId: id, error: (err as Error).message });
        }
      }
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_recon_confirm",
        targetTable: "recon_matches",
        targetId: ids.length === 1 ? ids[0] : `bulk:${confirmed}`,
        after: { confirmed, failed },
      });
      return NextResponse.json({ confirmed, failed });
    }

    if (body.action === "reject") {
      if (!body.matchId) return NextResponse.json({ error: "matchId 가 필요합니다." }, { status: 400 });
      await rejectMatch(body.matchId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_recon_confirm",
        targetTable: "recon_matches",
        targetId: body.matchId,
        after: { rejected: true },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "unconfirm") {
      if (!body.matchId) return NextResponse.json({ error: "matchId 가 필요합니다." }, { status: 400 });
      await unconfirmMatch(body.matchId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_recon_confirm",
        targetTable: "recon_matches",
        targetId: body.matchId,
        after: { unconfirmed: true },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "manual") {
      if (!body.txnId || !body.lines?.length) {
        return NextResponse.json({ error: "입금 건과 배분 대상이 필요합니다." }, { status: 400 });
      }
      const matchId = await manualMatch({ txnId: body.txnId, facilityId: body.facilityId ?? null, lines: body.lines }, actor.userId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_recon_confirm",
        targetTable: "recon_matches",
        targetId: matchId,
        after: { manual: true, lines: body.lines },
      });
      return NextResponse.json({ ok: true, matchId });
    }

    return NextResponse.json({ error: "알 수 없는 액션입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
