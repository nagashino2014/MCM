import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getMailboxByUser } from "@/lib/mail/mailbox";
import {
  createAppPassword,
  getExternalClientConfig,
  listAppPasswords,
  resolveExternalClientConfig,
  revokeAppPassword,
  saveExternalClientConfig,
  type ExternalClientConfig,
} from "@/lib/mail/app-passwords";
import { getGatewayServiceStatus, syncGatewayService } from "@/lib/mail/gateway-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 외부 메일 프로그램(아웃룩 등) 연결 — 서버 정보·내 앱 비밀번호(306). 설계: docs/mail-external-client-plan.md

// GET: 연결 설정 + 로그인 이름(내 대표 주소) + 내 앱 비밀번호 목록.
export async function GET() {
  try {
    const ctx = await requireSession();
    const [config, passwords, mailbox] = await Promise.all([
      getExternalClientConfig(),
      listAppPasswords(ctx.userId),
      getMailboxByUser(ctx.userId),
    ]);
    return NextResponse.json({ config, passwords, username: mailbox?.address ?? null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 앱 비밀번호 발급 — body { label }. 평문은 이 응답에서만 내려간다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { label?: string };
    const res = await createAppPassword(ctx.userId, String(body.label ?? ""));
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "admin_change",
      targetKind: "mail_app_password",
      targetId: res.item.appPasswordId,
      detail: { op: "create", label: res.item.label },
    });
    return NextResponse.json(res);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 앱 비밀번호 폐기 — ?id=. 이 비밀번호로 붙어 있던 연결은 게이트웨이의 다음 확인(1분 안)에서 끊긴다.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const ok = await revokeAppPassword(ctx.userId, id);
    if (!ok) return NextResponse.json({ error: "앱 비밀번호를 찾을 수 없습니다." }, { status: 404 });
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "admin_change",
      targetKind: "mail_app_password",
      targetId: id,
      detail: { op: "revoke" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: (관리자) 연결 사용 여부·서버 주소. ?probe=1 이면 권한 확인만, ?status=1 이면 게이트웨이 서버 상태만.
// 저장할 때 게이트웨이 ECS 서비스 대수를 함께 맞춘다(켜짐=1, 꺼짐=0 — 비용 정지).
//   켤 때: 서버를 먼저 올리고 허용 저장 / 끌 때: 허용을 먼저 끊고(연결은 1분 안에 종료) 서버를 내린다.
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("mail.manage");
    if (req.nextUrl.searchParams.get("probe") === "1") return NextResponse.json({ ok: true });
    if (req.nextUrl.searchParams.get("status") === "1") return NextResponse.json({ gateway: await getGatewayServiceStatus() });
    const body = (await req.json().catch(() => ({}))) as Partial<ExternalClientConfig>;
    // 형식 검사를 먼저 — 서버를 올린 뒤 저장이 400 으로 실패해 서버만 켜진 채 남지 않게.
    const target = await resolveExternalClientConfig(body);
    const gatewayFirst = target.enabled ? await syncGatewayService(true) : null;
    const config = await saveExternalClientConfig(target);
    const gateway = gatewayFirst ?? (await syncGatewayService(config.enabled));
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "admin_change",
      targetKind: "mail_external_client",
      detail: { ...config, gatewayDesired: gateway.available ? gateway.desired : null, gatewayError: gateway.error ?? null },
    });
    return NextResponse.json({ config, gateway });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
