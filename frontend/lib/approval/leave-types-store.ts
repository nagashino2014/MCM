import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { LeaveTypeItem } from "@/lib/approval/leave-types";

/*
 * 휴가 종류 카탈로그 DB 접근(서버 전용) — 조회/저장. 타입·시드·순수 조회는 leave-types.ts.
 * ⚠ 클라이언트 컴포넌트에서 이 파일을 import 하지 말 것(pg 가 번들에 끌려 들어감).
 */

function mapRow(r: Record<string, unknown>): LeaveTypeItem {
  return {
    key: String(r.key ?? ""),
    label: String(r.label ?? ""),
    group: String(r.group_name ?? ""),
    days: r.days != null ? Number(r.days) : null,
    deduct: r.deduct === "full" || r.deduct === "half" ? r.deduct : null,
    sortOrder: Number(r.sort_order ?? 0),
    active: Number(r.active ?? 1) === 1,
  };
}

/** 전체 카탈로그 조회(정렬순). activeOnly = 기안 화면용(비활성 제외). */
export async function listLeaveTypes(activeOnly = false): Promise<LeaveTypeItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM leave_types ${activeOnly ? "WHERE active = 1" : ""} ORDER BY sort_order, key`)
  );
  return rows.map(mapRow);
}

/** 카탈로그 전체 교체 저장(admin) — 받은 목록으로 upsert 후 빠진 key 삭제. */
export async function saveLeaveTypes(items: LeaveTypeItem[], _actorUserId: string): Promise<number> {
  const seen = new Set<string>();
  const valid = items.filter((it) => {
    const k = it.key.trim();
    if (!k || !/^[a-z][a-z0-9_]*$/.test(k) || seen.has(k) || !it.label.trim() || !it.group.trim()) return false;
    seen.add(k);
    return true;
  });
  if (!valid.length) throw new Error("저장할 유효한 항목이 없습니다.");
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    for (let i = 0; i < valid.length; i++) {
      const it = valid[i];
      await txn.run(
        `INSERT INTO leave_types (key, label, group_name, days, deduct, sort_order, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (key) DO UPDATE SET
           label = EXCLUDED.label, group_name = EXCLUDED.group_name, days = EXCLUDED.days,
           deduct = EXCLUDED.deduct, sort_order = EXCLUDED.sort_order, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at`,
        [it.key.trim(), it.label.trim(), it.group.trim(), it.days, it.deduct, i, it.active ? 1 : 0, now]
      );
    }
    await txn.run(`DELETE FROM leave_types WHERE key <> ALL($1::text[])`, [valid.map((it) => it.key.trim())]);
  });
  return valid.length;
}
