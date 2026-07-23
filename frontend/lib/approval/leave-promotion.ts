import { getDb, rowsToObjects } from "@/lib/db";

/*
 * 연차사용촉진제도(088, LP) — 직원별 소진율·1/2차 고지 현황 집계.
 * 발송/회신/2차는 후속(LP-P2/P3). 여기서는 관리 화면용 조회를 담당한다.
 * 설계: docs/leave-promotion-blueprint.md.
 */

/** 1차 고지 기간(고정 7/1~7/20) */
export const PROMO_FIRST_START = "07-01";
export const PROMO_FIRST_END = "07-20";

export interface PromotionRow {
  employeeId: string;
  name: string;
  positionName: string | null;
  deptName: string | null;
  photoPath: string | null;
  granted: number;
  used: number;
  remaining: number;
  rate: number; // 소진율 %
  // 고지 현황
  round1: { noticeDate: string; status: string } | null;
  round2: { noticeDate: string; status: string } | null;
}

/**
 * 연차촉진 관리 대상 목록 — 재직자 전체(잔여 연차 집계 + 1/2차 고지 상태 조인).
 * usedAnnual = 연차 차감분(연차·반차). rate = 사용 ÷ 부여.
 */
export async function listPromotion(year: string): Promise<PromotionRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.photo_public_path, d.dept_name, p.position_name, p.rank_order, e.hired_at,
              COALESCE(SUM(CASE WHEN l.entry_type IN ('grant','adjust') THEN l.days END), 0) AS granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' AND (lt.deduct IS NOT NULL OR l.leave_type_key IS NULL) THEN l.days END), 0) AS used
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN annual_leave_ledger l ON l.employee_id = e.employee_id AND l.year = $1
         LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE e.status = 'active'
        GROUP BY e.employee_id, e.name, e.photo_public_path, d.dept_name, p.position_name, p.rank_order, e.hired_at
        ORDER BY p.rank_order DESC NULLS LAST, e.hired_at ASC NULLS LAST, e.name`,
      [year]
    )
  );
  const notices = rowsToObjects(
    await db.exec(`SELECT employee_id, round, notice_date, status FROM leave_notices WHERE year = $1`, [year])
  );
  const noticeMap = new Map<string, { round: number; noticeDate: string; status: string }[]>();
  for (const n of notices) {
    const eid = String(n.employee_id);
    noticeMap.set(eid, [...(noticeMap.get(eid) ?? []), { round: Number(n.round), noticeDate: String(n.notice_date ?? ""), status: String(n.status ?? "") }]);
  }
  return rows.map((r) => {
    const granted = Number(r.granted ?? 0);
    const used = Number(r.used ?? 0);
    const remaining = Math.round((granted - used) * 100) / 100;
    const ns = noticeMap.get(String(r.employee_id)) ?? [];
    const r1 = ns.find((x) => x.round === 1);
    const r2 = ns.find((x) => x.round === 2);
    return {
      employeeId: String(r.employee_id ?? ""),
      name: String(r.name ?? ""),
      positionName: r.position_name != null ? String(r.position_name) : null,
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
      granted,
      used,
      remaining,
      rate: granted > 0 ? Math.round((used / granted) * 1000) / 10 : 0,
      round1: r1 ? { noticeDate: r1.noticeDate, status: r1.status } : null,
      round2: r2 ? { noticeDate: r2.noticeDate, status: r2.status } : null,
    };
  });
}

/** 발송 게이팅 상태 — 오늘 날짜 기준 1차/2차 발송 가능 여부. */
export function promotionGate(today: Date): { canFirst: boolean; canSecond: boolean; phase: string } {
  const mmdd = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const inFirst = mmdd >= PROMO_FIRST_START && mmdd <= PROMO_FIRST_END;
  const afterFirst = mmdd > PROMO_FIRST_END;
  return {
    canFirst: inFirst,
    canSecond: afterFirst,
    phase: mmdd < PROMO_FIRST_START ? "before" : inFirst ? "first" : "second",
  };
}
