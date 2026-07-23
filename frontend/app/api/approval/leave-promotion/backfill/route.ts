import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { backfillPaperNotice, type NoticeAttachmentMeta } from "@/lib/approval/leave-promotion";
import { buildNoticeAttachmentKey, putNoticeAttachment } from "@/lib/storage/leave-notice-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/octet-stream",
]);
const MAX_BYTES = 20 * 1024 * 1024;

// POST(multipart): 서면 통지 1차 고지 사후 등록(admin).
// fields: employeeId, year, round(=1), noticeDate(YYYY-MM-DD), plan(JSON 배열), files(스캔본 다건)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const form = await req.formData();
    const employeeId = String(form.get("employeeId") ?? "");
    const year = String(form.get("year") ?? new Date().getFullYear());
    const round = Number(form.get("round") ?? 1);
    const noticeDate = String(form.get("noticeDate") ?? "");
    if (!employeeId) return NextResponse.json({ error: "employeeId가 필요합니다." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) return NextResponse.json({ error: "통지일(YYYY-MM-DD)이 필요합니다." }, { status: 400 });

    let plan: string[] = [];
    try {
      const raw = String(form.get("plan") ?? "[]");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) plan = parsed.map((d) => String(d)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    } catch {
      plan = [];
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    const attachments: NoticeAttachmentMeta[] = [];
    for (const file of files) {
      if (file.size === 0) continue;
      if (file.size > MAX_BYTES) return NextResponse.json({ error: "스캔본은 20MB 이하만 업로드할 수 있습니다." }, { status: 400 });
      if (file.type && !ALLOWED.has(file.type)) return NextResponse.json({ error: `허용되지 않는 파일 형식입니다: ${file.type}` }, { status: 400 });
      const buffer = Buffer.from(await file.arrayBuffer());
      const { storageKey } = buildNoticeAttachmentKey({ employeeId, year, round, originalFilename: file.name || "사용계획서" });
      const stored = await putNoticeAttachment(storageKey, buffer, file.type || "application/octet-stream");
      attachments.push({ key: stored.storageKey, name: file.name || "사용계획서", size: file.size, contentType: file.type || "application/octet-stream" });
    }

    const res = await backfillPaperNotice({ year, employeeId, round, noticeDate, plan, attachments, actorUserId: actor.userId });
    if (!res.ok) return NextResponse.json({ error: res.error ?? "사후 등록에 실패했습니다." }, { status: 400 });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_leave_notice_submit",
      targetTable: "leave_notices",
      targetId: `${year}-${round}-${employeeId}`,
      after: { paper: true, planDays: plan.length, files: attachments.length },
    });
    return NextResponse.json({ ok: true, attachments: attachments.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
