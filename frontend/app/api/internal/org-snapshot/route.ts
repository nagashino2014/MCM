import { NextRequest, NextResponse } from "next/server";
import { listOrganizationSnapshot } from "@/lib/admin/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ESG 플랫폼(이중중대성평가 등) 조직도 연동용 내부 API — 다른 내부 라우트처럼 세션 없이 비밀 헤더로만 가드한다.
 * - 헤더 x-org-sync-key 가 env ORG_SYNC_SECRET 과 같아야 한다(미설정이면 503: 연동 꺼짐).
 * - 부서·직위·인원(사번·이름·부서·직위·이메일·재직/퇴사·입사일)만 내보내고 성별·생년월일·사진 등 인사 정보는 제외한다.
 * - 입사·퇴사 처리는 employee_profiles.status 로 바로 반영되므로 ESG 플랫폼 쪽은 주기적으로 이 API 를 읽어 조직도를 갱신한다.
 */
export async function GET(req: NextRequest) {
  const secret = (process.env.ORG_SYNC_SECRET ?? "").trim();
  if (!secret) return NextResponse.json({ error: "org sync disabled (ORG_SYNC_SECRET 미설정)" }, { status: 503 });
  const key = req.headers.get("x-org-sync-key") ?? "";
  if (key.length !== secret.length || !timingSafeEqual(key, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const snap = await listOrganizationSnapshot();
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      departments: snap.departments,
      positions: snap.positions,
      employees: snap.employees.map((e) => ({
        employeeId: e.employeeId,
        userId: e.userId,
        employeeNo: e.employeeNo,
        name: e.name,
        deptId: e.deptId,
        positionId: e.positionId,
        positionName: e.positionName,
        positionRankOrder: e.positionRankOrder,
        email: e.email,
        status: e.status,
        hiredAt: e.hiredAt,
      })),
    });
  } catch (err) {
    console.error("[org-snapshot] 실패", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
