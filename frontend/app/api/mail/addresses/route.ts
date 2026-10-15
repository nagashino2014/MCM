import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { bulkRegisterDomain, listAddressAdmin } from "@/lib/mail/addresses-admin";
import { addMailboxAddress, removeMailboxAddress, setDomainSendEnabled, setPrimaryAddress } from "@/lib/mail/mailbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 회사 주소(다중 도메인, 280) 관리 — 전부 관리자 전용. 대표 주소 전환은 해당 직원의 발신 주소를 바꾸는 민감 설정.

export async function GET() {
  try {
    await requirePermission("mail.manage");
    return NextResponse.json(await listAddressAdmin());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

type Body =
  | { op: "add"; mailboxId?: string; address?: string }
  | { op: "remove"; mailboxId?: string; address?: string }
  | { op: "primary"; mailboxId?: string; address?: string }
  | { op: "bulk-register"; domain?: string }
  | { op: "domain-send"; domain?: string; enabled?: boolean };

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("mail.manage");
    const body = (await req.json().catch(() => ({}))) as Body;
    const log = (targetId: string, detail: Record<string, unknown>) =>
      recordAccessLog({ actorUserId: ctx.userId, action: "admin_change", targetKind: "mail_address", targetId, detail });

    switch (body.op) {
      case "add":
      case "remove":
      case "primary": {
        if (!body.mailboxId || !body.address) {
          return NextResponse.json({ error: "mailboxId·address 가 필요합니다." }, { status: 400 });
        }
        if (body.op === "add") {
          const added = await addMailboxAddress(body.mailboxId, body.address, "manual");
          await log(body.mailboxId, { op: "add", address: added.address });
          return NextResponse.json({ ok: true, address: added.address });
        }
        if (body.op === "remove") {
          await removeMailboxAddress(body.mailboxId, body.address);
          await log(body.mailboxId, { op: "remove", address: body.address });
          return NextResponse.json({ ok: true });
        }
        const changed = await setPrimaryAddress(body.mailboxId, body.address);
        await log(body.mailboxId, { op: "primary", ...changed });
        return NextResponse.json({ ok: true, ...changed });
      }
      case "bulk-register": {
        if (!body.domain) return NextResponse.json({ error: "domain 이 필요합니다." }, { status: 400 });
        const result = await bulkRegisterDomain(body.domain);
        await log(body.domain, { op: "bulk-register", created: result.created, mailboxesCreated: result.mailboxesCreated, failures: result.failures.length });
        return NextResponse.json({ ok: true, ...result });
      }
      case "domain-send": {
        if (!body.domain || typeof body.enabled !== "boolean") {
          return NextResponse.json({ error: "domain·enabled 가 필요합니다." }, { status: 400 });
        }
        await setDomainSendEnabled(body.domain, body.enabled);
        await log(body.domain, { op: "domain-send", enabled: body.enabled });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "알 수 없는 작업입니다." }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
