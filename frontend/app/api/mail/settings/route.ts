import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { getMailboxSettings, saveMailboxSettings, type MailboxSettings } from "@/lib/mail/spam";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내 메일 설정(스팸·용량 배분) + 총용량.
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json(await getMailboxSettings(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 내 메일 설정 저장.
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as MailboxSettings;
    await saveMailboxSettings(ctx.userId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: (관리자) 사용자별 총용량 할당 — body: { mailboxId, quotaBytes } 또는 { totalPoolGb }(전사 총량, G2-15).
//      body 없이 목록 조회는 ?list=1 (totalPoolGb 포함).
export async function PUT(req: NextRequest) {
  try {
    await requirePermission("mail.manage");
    if (req.nextUrl.searchParams.get("list") === "1") {
      const db = await getDb();
      const rows = rowsToObjects(
        await db.exec(`SELECT mailbox_id, user_id, address, display_name, quota_bytes, used_bytes FROM mailboxes ORDER BY address`)
      );
      const pool = rowsToObjects(await db.exec(`SELECT value FROM mail_settings WHERE key = 'total_pool_gb'`));
      return NextResponse.json({
        totalPoolGb: pool.length ? Number(pool[0].value) || 100 : 100,
        mailboxes: rows.map((r) => ({
          mailboxId: String(r.mailbox_id),
          userId: r.user_id != null ? String(r.user_id) : null,
          address: String(r.address),
          displayName: r.display_name != null ? String(r.display_name) : "",
          quotaBytes: r.quota_bytes != null ? Number(r.quota_bytes) : null,
          usedBytes: r.used_bytes != null ? Number(r.used_bytes) : null,
        })),
      });
    }
    const body = (await req.json().catch(() => ({}))) as { mailboxId?: string; quotaBytes?: number; totalPoolGb?: number };
    if (Number.isFinite(body.totalPoolGb)) {
      // 전사 총 설정 용량 저장(mail_settings key-value).
      await withDbWrite(async (db) => {
        await db.run(
          `INSERT INTO mail_settings (key, value, updated_at) VALUES ('total_pool_gb', $1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [String(Math.max(1, Math.round(Number(body.totalPoolGb)))), new Date().toISOString()]
        );
      });
      return NextResponse.json({ ok: true });
    }
    if (!body.mailboxId || !Number.isFinite(body.quotaBytes)) {
      return NextResponse.json({ error: "mailboxId/quotaBytes 가 필요합니다." }, { status: 400 });
    }
    await withDbWrite(async (db) => {
      await db.run(`UPDATE mailboxes SET quota_bytes = $2, updated_at = $3 WHERE mailbox_id = $1`, [
        body.mailboxId,
        Math.max(0, Math.round(Number(body.quotaBytes))),
        new Date().toISOString(),
      ]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
