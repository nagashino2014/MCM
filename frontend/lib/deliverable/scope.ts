// 착수계·준공계 작성 권한 범위 — 작성 책임을 용역 담당 실무자에게 일임한다(2026-08-07 사용자 확정).
// 관리자(role=admin)는 전 계약, 그 외 사용자는 **본인이 수행인력으로 등록된 계약**만 보인다.
// 수행인력의 단일 진실원은 service_participants(029)이고, 로그인 계정↔조직 인원은
// users.employee_id → employee_profiles.employee_id 로 연결된다.

import { getDb, rowsToObjects } from "@/lib/db";

/**
 * 이 사용자가 착수계·준공계를 작성할 수 있는 계약 id 목록.
 * null = 제한 없음(관리자) — 호출측은 null 이면 필터를 걸지 않는다.
 */
export async function resolveDeliverableContractIds(userId: string, role: string): Promise<string[] | null> {
  if (role === "admin") return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT sp.contract_id
         FROM service_participants sp
         JOIN users u ON u.employee_id = sp.employee_id
        WHERE u.user_id = $1`,
      [userId]
    )
  );
  return rows.map((r) => String(r.contract_id));
}
