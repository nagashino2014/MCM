// 재무 > 연결 관리 API — 계좌/카드 목록(GET) + 연결 액션(POST)
// 액션: manage-url(호스팅 등록 URL 발급) / stop / cancel-stop / re-regist / refresh-now(카드) / update-meta(카드)
// 자격증명(계좌비번·카드사 웹PW)은 바로빌 호스팅 URL에서만 입력 — 앱 서버를 거치지 않음(블루프린트 F0).

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listConnections, getConnectionSecretNo, updateCardMeta, listSyncLogs } from "@/lib/barobill/queries";
import { isSyncStale, runFinanceSync, syncRegistry } from "@/lib/barobill/sync";
import {
  getBankAccountManagementUrl,
  stopBankAccount,
  cancelStopBankAccount,
  reRegistBankAccount,
} from "@/lib/barobill/bank";
import {
  getCardManagementUrl,
  stopCard,
  cancelStopCard,
  reRegisterCard,
  refreshCardNow,
} from "@/lib/barobill/card";
import { BarobillError } from "@/lib/barobill/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    if (refresh) await syncRegistry();
    const [connections, logs, stale] = await Promise.all([listConnections(), listSyncLogs(20), isSyncStale()]);
    // catch-up: 화면 진입 시 최신 아니면 백그라운드로 수집 시작 (응답은 기다리지 않음)
    if (stale) void runFinanceSync().catch(() => {});
    return NextResponse.json({ connections, logs, stale });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface ActionBody {
  action: "manage-url" | "stop" | "cancel-stop" | "re-regist" | "refresh-now" | "update-meta";
  kind: "bank" | "card";
  id?: string; // manage-url 외 필수
  meta?: { alias?: string | null; holderEmployeeId?: string | null; isActive?: boolean };
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const body = (await req.json()) as ActionBody;

    if (body.action === "manage-url") {
      const url = body.kind === "bank" ? await getBankAccountManagementUrl() : await getCardManagementUrl();
      return NextResponse.json({ url, validSeconds: 60 });
    }

    if (!body.id) return NextResponse.json({ error: "대상 id가 필요합니다." }, { status: 400 });

    if (body.action === "update-meta") {
      if (body.kind !== "card") return NextResponse.json({ error: "메타 수정은 카드만 지원합니다." }, { status: 400 });
      await updateCardMeta(body.id, body.meta ?? {});
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_card_meta_update",
        targetTable: "card_registry",
        targetId: body.id,
        after: body.meta,
      });
      return NextResponse.json({ ok: true });
    }

    const secretNo = await getConnectionSecretNo(body.kind, body.id);
    if (!secretNo) return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });

    if (body.action === "stop") {
      if (body.kind === "bank") await stopBankAccount(secretNo);
      else await stopCard(secretNo);
      await syncRegistry();
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_connection_stop",
        targetTable: body.kind === "bank" ? "bank_accounts" : "card_registry",
        targetId: body.id,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "cancel-stop" || body.action === "re-regist") {
      if (body.kind === "bank") {
        if (body.action === "cancel-stop") await cancelStopBankAccount(secretNo);
        else await reRegistBankAccount(secretNo);
      } else {
        if (body.action === "cancel-stop") await cancelStopCard(secretNo);
        else await reRegisterCard(secretNo);
      }
      await syncRegistry();
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_connection_resume",
        targetTable: body.kind === "bank" ? "bank_accounts" : "card_registry",
        targetId: body.id,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "refresh-now") {
      if (body.kind !== "card") return NextResponse.json({ error: "즉시 수집은 카드만 지원합니다." }, { status: 400 });
      const { alreadyRunning, code, note } = await refreshCardNow(secretNo);
      return NextResponse.json({ ok: true, alreadyRunning, code, note });
    }

    return NextResponse.json({ error: "알 수 없는 액션입니다." }, { status: 400 });
  } catch (err) {
    if (err instanceof BarobillError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
