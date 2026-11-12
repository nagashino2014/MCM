import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDb, withDbWrite } from "@/lib/db";
import { pushInfoForMessage } from "@/lib/chat/queries";
import { sendPush } from "@/lib/notify/push-expo";
import { recordTodoNotifications } from "@/lib/todo/inbox";
import {
  confirmQuick,
  getQuickRegistration,
  requestPersonDetails,
  supplementHref,
  supplementPerson,
  type SupplementInput,
} from "@/lib/contact-quick/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 간이 등록 한 건 — 조회·보완은 등록한 직원과 관리자, 확정·상세정보 요청은 관리자(facility.edit)만.

function parseId(v: string): number | null {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const fail = (err: unknown) => {
  const status = (err as { status?: number }).status;
  if (status && !(err instanceof AuthError)) return NextResponse.json({ error: (err as Error).message }, { status });
  return authErrorToResponse(err);
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const quickId = parseId((await ctx.params).id);
    if (!quickId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });
    const item = await getQuickRegistration(await getDb(), quickId);
    if (!item) return NextResponse.json({ error: "간이 등록을 찾을 수 없습니다." }, { status: 404 });
    const admin = await hasPermission(session.userId, "facility.edit");
    if (!admin && item.registeredBy !== session.userId) return NextResponse.json({ error: "본인이 등록한 항목만 볼 수 있습니다." }, { status: 403 });
    return NextResponse.json({ item, canReview: admin });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const quickId = parseId((await ctx.params).id);
    if (!quickId) return NextResponse.json({ error: "id 가 올바르지 않습니다." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { action?: string; note?: string | null; person?: SupplementInput };
    const admin = await hasPermission(session.userId, "facility.edit");

    if (body.action === "confirm") {
      if (!admin) throw new AuthError("확정은 사업장 관리 권한이 필요합니다.", 403);
      const item = await withDbWrite((db) => confirmQuick(db, quickId, session.userId));
      return NextResponse.json({ item });
    }

    if (body.action === "request") {
      if (!admin) throw new AuthError("상세정보 요청은 사업장 관리 권한이 필요합니다.", 403);
      const sent = await withDbWrite((db) => requestPersonDetails(db, quickId, session.userId, body.note ?? null));
      // 메신저 DM 은 위 트랜잭션에서 저장했다. 웹 알림(종)·앱 푸시는 실패해도 요청은 남는다.
      const who = [sent.item.personName, sent.item.title].filter(Boolean).join(" ");
      await recordTodoNotifications([sent.recipientId], {
        event: "contact.detail_request",
        title: `주소록 상세정보 요청 — ${sent.item.facilityName} ${who}`.trim(),
        body: body.note ? String(body.note).slice(0, 200) : "간이 등록한 담당자의 부서·연락처를 보완해 주세요.",
        link: supplementHref(quickId),
        actorUserId: session.userId,
      });
      try {
        const info = await pushInfoForMessage(sent.roomId, session.userId);
        await sendPush([sent.recipientId], {
          event: "chat.message",
          title: info.senderName,
          body: `[주소록 상세정보 요청] ${sent.item.facilityName} ${who}`.trim(),
          link: `/chat/${sent.roomId}`,
          targetRef: `chat:${sent.roomId}`,
          dedupKey: `chat:${sent.roomId}:${sent.messageId}`,
        });
      } catch (e) {
        console.error("[contact-quick] 푸시 발송 실패", e);
      }
      return NextResponse.json({ item: sent.item });
    }

    if (body.action === "supplement") {
      const current = await getQuickRegistration(await getDb(), quickId);
      if (!current) return NextResponse.json({ error: "간이 등록을 찾을 수 없습니다." }, { status: 404 });
      if (!admin && current.registeredBy !== session.userId) throw new AuthError("본인이 등록한 담당자만 보완할 수 있습니다.", 403);
      const item = await withDbWrite((db) => supplementPerson(db, quickId, session.userId, body.person ?? {}));
      return NextResponse.json({ item });
    }

    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return fail(err);
  }
}
