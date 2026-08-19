import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/access-log — 접속기록 조회(PR-P1).
// access_log + audit_log 의 파일함 열람성 액션(file_library_*)을 통합해 시간순으로 보여준다.
// 이 조회 자체도 접속기록에 남는다(열람 이력의 열람도 이력이다).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("security.access_log");
    const params = req.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") ?? 30) || 30));

    const ym = (v: string | null) => {
      const m = /^(\d{4})(\d{2})$/.exec((v ?? "").trim());
      return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
    };
    const conds: string[] = [];
    const values: unknown[] = [];
    const fromKey = ym(params.get("from"));
    if (fromKey) {
      values.push(fromKey);
      conds.push(`substring(t.created_at, 1, 7) >= $${values.length}`);
    }
    const toKey = ym(params.get("to"));
    if (toKey) {
      values.push(toKey);
      conds.push(`substring(t.created_at, 1, 7) <= $${values.length}`);
    }
    const kind = String(params.get("kind") ?? "").trim();
    if (kind) {
      values.push(kind);
      conds.push(`t.target_kind = $${values.length}`);
    }
    const action = String(params.get("action") ?? "").trim();
    if (action) {
      values.push(action);
      conds.push(`t.action = $${values.length}`);
    }
    const q = String(params.get("q") ?? "").trim();
    if (q) {
      values.push(`%${q}%`);
      const p = `$${values.length}`;
      conds.push(`(COALESCE(e.name, u.email, t.actor_user_id, '') ILIKE ${p} OR COALESCE(t.target_id, '') ILIKE ${p})`);
    }
    values.push(pageSize, (page - 1) * pageSize);

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT t.*, COALESCE(e.name, u.email, t.actor_user_id) AS actor_name,
                count(*) OVER() AS total_count
           FROM (
             SELECT 'acc-' || log_id::text AS id, actor_user_id, action, target_kind, target_id, detail, created_at
               FROM access_log
             UNION ALL
             SELECT 'aud-' || id::text, actor_user_id,
                    CASE action WHEN 'file_library_open' THEN 'view'
                                WHEN 'file_library_delete' THEN 'delete'
                                ELSE 'admin_change' END,
                    'file_library', target_id, after_json, created_at
               FROM audit_log
              WHERE action IN ('file_library_open', 'file_library_delete', 'file_retention_purge')
           ) t
           LEFT JOIN users u ON u.user_id = t.actor_user_id
           LEFT JOIN employee_profiles e ON e.user_id = t.actor_user_id
          ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
          ORDER BY t.created_at DESC
          LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      )
    );
    const total = rows.length ? Number(rows[0].total_count ?? 0) : 0;

    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "view",
      targetKind: "access_log",
      detail: { page, filters: { from: fromKey, to: toKey, kind: kind || null, action: action || null, q: q || null } },
    });

    return NextResponse.json({
      total,
      page,
      pageSize,
      logs: rows.map((r) => ({
        id: String(r.id),
        actorUserId: r.actor_user_id != null ? String(r.actor_user_id) : null,
        actorName: r.actor_name != null ? String(r.actor_name) : null,
        action: String(r.action),
        targetKind: String(r.target_kind),
        targetId: r.target_id != null ? String(r.target_id) : null,
        detail: r.detail ?? null,
        createdAt: String(r.created_at),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
