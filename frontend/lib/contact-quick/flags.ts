/** 주소록 간이 등록(357) 표시 — 목록 화면이 가볍게 가져다 쓰도록 store 와 분리한다. */
import { rowsToObjects, type PgDatabase } from "@/lib/db";

/** 주소록 목록에 '간이' 표시를 붙일 담당자 id — 357 적용 전에는 빈 집합. */
export async function openQuickPersonIds(db: PgDatabase): Promise<Set<number>> {
  try {
    return new Set(rowsToObjects(await db.exec(
      `SELECT person_id FROM contact_quick_registrations WHERE kind = 'person' AND status <> 'done'`
    )).map((r) => Number(r.person_id)));
  } catch {
    return new Set();
  }
}
