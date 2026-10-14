/*
 * To-do 아바타 사진(§19-8) — users.user_id 배열 → employee_profiles.photo_public_path 맵을 1쿼리로.
 * photo_public_path 는 업로드 시 "/api/admin/employees/{employeeId}/photo" 로 기록된다(052, 인증 사용자면 열람 가능).
 * 사진이 없으면 null → 화면은 중립 이니셜 아바타(CdAvatar name 만).
 * 한 사용자에 프로필이 여럿이면 재직(active)·최근 수정 순으로 1건.
 */
import { rowsToObjects, type PgDatabase } from "@/lib/db";

export type TodoPhotoMap = Map<string, string | null>;

export async function loadPhotoUrls(db: PgDatabase, userIds: readonly (string | null | undefined)[]): Promise<TodoPhotoMap> {
  const map: TodoPhotoMap = new Map();
  const ids = [...new Set(userIds.filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (!ids.length) return map;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (p.user_id) p.user_id, p.photo_public_path
         FROM employee_profiles p
        WHERE p.user_id = ANY($1::text[])
        ORDER BY p.user_id, (p.status = 'active') DESC, p.photo_updated_at DESC NULLS LAST, p.updated_at DESC`,
      [ids]
    )
  );
  for (const id of ids) map.set(id, null);
  for (const r of rows) {
    const path = r.photo_public_path != null ? String(r.photo_public_path).trim() : "";
    map.set(String(r.user_id), path ? path : null);
  }
  return map;
}

export const photoOf = (map: TodoPhotoMap, userId: string | null | undefined): string | null =>
  userId ? (map.get(userId) ?? null) : null;
