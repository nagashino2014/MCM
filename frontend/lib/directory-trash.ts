/**
 * 주소록 외부 담당자 휴지통(381, 2026-11-27 사용자 결정 — 직원 개선 요청 27).
 *
 * - 삭제 = 휴지통 이동: 담당자 행 전체를 trash_items.before_json 에 담고 facility_contact_people 에서 뺀다.
 *   원본 표에 삭제 표시 열을 두지 않으므로, 담당자를 읽는 기존 조회(사업장 상세·메일 자동완성·계산서 수신처 등)는
 *   고치지 않아도 휴지통의 담당자를 보지 않는다.
 * - 한 번에 한 사람씩만(일괄 삭제 없음). 한 직원이 24시간 안에 5건을 옮기면 그 5번째부터 24시간 동안 더 옮길 수 없다.
 *   완전 삭제 권한자(trash.purge, 관리자)는 이 제한을 받지 않는다.
 * - 복원(trash.restore)은 같은 id 로 행을 되살리고, 완전 삭제(trash.purge)는 휴지통 행만 정리한다(/api/trash).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const CONTACT_TRASH_TYPE = "contact_person";
/** 24시간에 휴지통으로 옮길 수 있는 담당자 수. */
export const CONTACT_DELETE_DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ContactDeleteQuota {
  limit: number;
  /** 최근 24시간에 옮긴 건수. */
  used: number;
  /** 제한에 걸린 경우 다시 옮길 수 있는 시각(ISO). 걸리지 않았으면 null. */
  lockedUntil: string | null;
  /** 관리자(trash.purge) — 제한 없음. */
  exempt: boolean;
}

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

type Queryable = Pick<PgDatabase, "exec">;

/**
 * 제한 판정 — 이 직원이 옮긴 담당자 중, 그 시점 기준 앞 24시간 안에 5건째가 된 삭제가 최근 24시간 안에 있으면
 * 그 시각 + 24시간까지 잠근다. (5번째 삭제부터 하루 쿨타임)
 */
export async function getContactDeleteQuota(userId: string, exempt: boolean, db?: Queryable): Promise<ContactDeleteQuota> {
  const q = db ?? (await getDb());
  const rows = rowsToObjects(
    await q.exec(
      `WITH recent AS (
         SELECT deleted_at::timestamptz AS at
           FROM trash_items
          WHERE item_type = $2 AND deleted_by = $1
            AND deleted_at::timestamptz > now() - interval '48 hours'
       ), counted AS (
         SELECT at, count(*) OVER (ORDER BY at RANGE BETWEEN interval '24 hours' PRECEDING AND CURRENT ROW) AS c
           FROM recent
       )
       SELECT (SELECT count(*) FROM recent WHERE at > now() - interval '24 hours') AS used,
              (SELECT max(at) FROM counted WHERE c >= $3 AND at > now() - interval '24 hours') AS hit_at`,
      [userId, CONTACT_TRASH_TYPE, CONTACT_DELETE_DAILY_LIMIT]
    )
  );
  const used = Number(rows[0]?.used ?? 0);
  const hit = rows[0]?.hit_at != null ? new Date(rows[0].hit_at as string | Date) : null;
  const lockedUntil = !exempt && hit && !Number.isNaN(hit.getTime()) ? new Date(hit.getTime() + DAY_MS).toISOString() : null;
  return { limit: CONTACT_DELETE_DAILY_LIMIT, used, lockedUntil, exempt };
}

/** 잠금 해제 시각 안내 — "11월 28일 14:05"(한국 시간). */
export function formatUnlockAt(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 담당자 한 명을 휴지통으로 옮긴다. 반환 = 옮긴 뒤의 제한 상태(5번째면 lockedUntil 이 채워진다). */
export async function moveContactPersonToTrash(params: {
  id: number;
  actorUserId: string;
  /** 관리자(trash.purge) — 하루 제한 없음. */
  exempt: boolean;
}): Promise<{ personName: string; quota: ContactDeleteQuota }> {
  let personName = "";
  let quota: ContactDeleteQuota | null = null;
  try {
    await withDbWrite(async (txn) => {
      // 같은 직원의 동시 삭제 요청이 제한을 함께 통과하지 않게 직원 단위로 줄 세운다.
      await txn.exec("SELECT pg_advisory_xact_lock(hashtext($1))", [`contact-trash:${params.actorUserId}`]);
      const before = await getContactDeleteQuota(params.actorUserId, params.exempt, txn);
      if (before.lockedUntil) {
        throw userError(
          `하루에 삭제할 수 있는 담당자는 ${CONTACT_DELETE_DAILY_LIMIT}건입니다. ${formatUnlockAt(before.lockedUntil)} 이후에 다시 삭제할 수 있습니다.`,
          429
        );
      }
      const rows = rowsToObjects(
        await txn.exec(
          `SELECT to_jsonb(p) AS snap, p.person_name, f.company_name
             FROM facility_contact_people p
             LEFT JOIN facilities f ON f.facility_id = p.facility_id
            WHERE p.id = $1
            FOR UPDATE OF p`,
          [params.id]
        )
      );
      if (!rows.length) throw userError("담당자를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.", 404);
      personName = String(rows[0].person_name ?? "");
      const company = rows[0].company_name != null ? String(rows[0].company_name) : "";
      const snap = rows[0].snap;
      const now = new Date().toISOString();
      await txn.run(
        `INSERT INTO trash_items (trash_id, item_type, item_id, item_title, reason, before_json, deleted_by, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          "trash_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16),
          CONTACT_TRASH_TYPE,
          String(params.id),
          company ? `${personName} (${company})` : personName,
          "주소록에서 삭제",
          JSON.stringify(typeof snap === "string" ? JSON.parse(snap) : snap),
          params.actorUserId,
          now,
        ]
      );
      await txn.run(`DELETE FROM facility_contact_people WHERE id = $1`, [params.id]);
      await recordAuditLogInline(txn, {
        actorUserId: params.actorUserId,
        action: "contact_person_trash",
        targetTable: "facility_contact_people",
        targetId: String(params.id),
        before: snap,
        after: { trashed: true },
      });
      quota = await getContactDeleteQuota(params.actorUserId, params.exempt, txn);
    });
  } catch (err) {
    // 381 적용 전 — trash_items 의 item_type CHECK 가 contact_person 을 막는다.
    if ((err as { code?: string })?.code === "23514") {
      throw userError("주소록 휴지통(381 마이그레이션)이 아직 적용되지 않아 삭제할 수 없습니다. 관리자에게 알려 주세요.", 409);
    }
    throw err;
  }
  return { personName, quota: quota as unknown as ContactDeleteQuota };
}

/**
 * 휴지통에서 담당자 복원(트랜잭션 안) — before_json 으로 같은 id 의 행을 다시 넣는다.
 * 지금 표에 있는 열만 넣어, 삭제 뒤에 생긴 열은 기본값을 받는다.
 */
export async function restoreContactPersonFromTrash(txn: PgDatabase, item: Record<string, unknown>): Promise<void> {
  const id = String(item.item_id ?? "");
  const snapRaw = item.before_json;
  const snap = (typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw) as Record<string, unknown> | null;
  if (!snap || typeof snap !== "object") throw userError("휴지통 기록에 담당자 정보가 없어 복원할 수 없습니다.");
  const exists = rowsToObjects(await txn.exec(`SELECT 1 FROM facility_contact_people WHERE id = $1`, [Number(id)]));
  if (exists.length) throw userError("같은 담당자가 이미 주소록에 있습니다.", 409);
  const facility = rowsToObjects(
    await txn.exec(`SELECT 1 FROM facilities WHERE facility_id = $1`, [String(snap.facility_id ?? "")])
  );
  if (!facility.length) throw userError("소속 기관·업체가 완전히 삭제되어 담당자를 복원할 수 없습니다.", 409);
  const colRows = rowsToObjects(
    await txn.exec(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'facility_contact_people'`
    )
  );
  const cols = colRows.map((r) => String(r.column_name)).filter((c) => Object.prototype.hasOwnProperty.call(snap, c));
  if (!cols.includes("id") || !cols.includes("facility_id")) throw userError("휴지통 기록이 올바르지 않아 복원할 수 없습니다.");
  const list = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
  await txn.run(
    `INSERT INTO facility_contact_people (${list})
     SELECT ${list} FROM jsonb_populate_record(NULL::facility_contact_people, $1::jsonb)`,
    [JSON.stringify(snap)]
  );
}
