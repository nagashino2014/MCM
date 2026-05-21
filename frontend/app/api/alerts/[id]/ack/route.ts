import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AlertSnapshot {
  id: number;
  severity: string;
  source: string;
  code: string;
  title: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireEditor();
    const { id: idStr } = await params;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "invalid alert id" }, { status: 400 });
    }

    const result = await withDbWrite(async (db) => {
      // 현재 상태 스냅샷
      let before: AlertSnapshot | null = null;
      try {
        const r = await db.exec(
          "SELECT id, severity, source, code, title, acknowledged_at, acknowledged_by FROM alerts WHERE id = $1",
          [id]
        );
        if (r.length && r[0].values.length) {
          const row = r[0].values[0];
          before = {
            id: Number(row[0]),
            severity: String(row[1] ?? ""),
            source: String(row[2] ?? ""),
            code: String(row[3] ?? ""),
            title: String(row[4] ?? ""),
            acknowledgedAt: row[5] != null ? String(row[5]) : null,
            acknowledgedBy: row[6] != null ? String(row[6]) : null,
          };
        }
      } catch {
        before = null;
      }
      if (!before) return { ok: false, status: 404, message: "alert not found" } as const;
      if (before.acknowledgedAt) {
        return {
          ok: true,
          status: 200,
          alreadyAcknowledged: true,
          alert: before,
        } as const;
      }

      const now = new Date().toISOString();
      await db.run(
        "UPDATE alerts SET acknowledged_at = $1, acknowledged_by = $2 WHERE id = $3",
        [now, actor.userId || actor.email || "unknown", id]
      );

      const after: AlertSnapshot = { ...before, acknowledgedAt: now, acknowledgedBy: actor.userId };
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "alert.ack",
        targetTable: "alerts",
        targetId: String(id),
        before,
        after,
      });

      return { ok: true, status: 200, alreadyAcknowledged: false, alert: after } as const;
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    return NextResponse.json(
      {
        id,
        acknowledged: true,
        alreadyAcknowledged: result.alreadyAcknowledged,
        alert: result.alert,
      },
      { status: result.status }
    );
  } catch (err) {
    return authErrorToResponse(err);
  }
}
