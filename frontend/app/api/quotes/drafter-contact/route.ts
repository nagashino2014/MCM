import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 견적서 공급자란 담당자 연락처 — 기안자(현재 사용자)의 직원 정보에서 Mobile 자동 채움.
// 2026-09-30 작성 화면의 Mobile 입력란을 없애고 employee_profiles.mobile_phone 을 쓴다(approval/notify 와 동일 소스).
export async function GET() {
  try {
    const ctx = await requireSession();
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT ep.mobile_phone, ep.name
           FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
          WHERE u.user_id = $1`,
        [ctx.userId]
      )
    );
    const r = rows[0];
    return NextResponse.json({
      mobile: r?.mobile_phone != null ? String(r.mobile_phone) : "",
      name: r?.name != null ? String(r.name) : "",
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
