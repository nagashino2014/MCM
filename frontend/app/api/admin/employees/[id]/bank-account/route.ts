import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 경비/급여 입금 계좌(203) — 개인카드 경비 정산 CMS 파일 생성에 쓴다. 인사관리 탭에서 편집.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("staffing.view", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT bank_name, bank_code, bank_account, bank_account_holder FROM employee_profiles WHERE employee_id = $1`, [id])
    );
    if (!rows.length) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({
      bankName: rows[0].bank_name != null ? String(rows[0].bank_name) : null,
      bankCode: rows[0].bank_code != null ? String(rows[0].bank_code) : null,
      bankAccount: rows[0].bank_account != null ? String(rows[0].bank_account) : null,
      accountHolder: rows[0].bank_account_holder != null ? String(rows[0].bank_account_holder) : null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH {bankName, bankCode, bankAccount, accountHolder} — 빈 문자열은 NULL 로 지운다.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("staffing.changes.record", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      bankName?: string | null;
      bankCode?: string | null;
      bankAccount?: string | null;
      accountHolder?: string | null;
    };
    const bankName = String(body.bankName ?? "").trim() || null;
    const bankCode = String(body.bankCode ?? "").replace(/\D/g, "").trim() || null;
    const bankAccount = String(body.bankAccount ?? "").replace(/[^\d-]/g, "").trim() || null;
    const accountHolder = String(body.accountHolder ?? "").trim() || null;
    await withDbWrite(async (txn) => {
      await txn.run(
        `UPDATE employee_profiles SET bank_name = $2, bank_code = $3, bank_account = $4, bank_account_holder = $5, updated_at = $6 WHERE employee_id = $1`,
        [id, bankName, bankCode, bankAccount, accountHolder, new Date().toISOString()]
      );
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "employee_update",
      targetTable: "employee_profiles",
      targetId: id,
      after: { bankCode, bankAccountMasked: bankAccount ? `***${bankAccount.slice(-4)}` : null },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
