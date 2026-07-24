import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { withDbWrite } from "@/lib/db";
import { parseAttendanceWorkbook } from "@/lib/adt/excel";
import { upsertRawRecords } from "@/lib/adt/source";
import { ingestStaging } from "@/lib/adt/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST(multipart): 근태 조회 엑셀(.xls/.xlsx) 업로드 → 파싱 → 스테이징 upsert → 정규화·산정.
// 본사·지사 파일을 함께 올릴 수 있다(files 여러 개). admin 전용.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "업로드할 엑셀 파일이 없습니다." }, { status: 400 });

    const perFile: Array<{ name: string; records: number; skipped: number; error?: string }> = [];
    const result = await withDbWrite(async (db) => {
      let collected = 0;
      for (const file of files) {
        try {
          const buf = Buffer.from(await file.arrayBuffer());
          const parsed = parseAttendanceWorkbook(buf);
          collected += await upsertRawRecords(db, parsed.records, "file");
          perFile.push({ name: file.name, records: parsed.records.length, skipped: parsed.skipped });
        } catch (err) {
          perFile.push({ name: file.name, records: 0, skipped: 0, error: (err as Error).message });
        }
      }
      const ing = await ingestStaging(db, {});
      return { ...ing, collected };
    });

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "adt_attendance_upload",
      targetTable: "attendance_daily",
      targetId: "excel-upload",
      after: { files: perFile.map((f) => f.name), collected: result.collected, matched: result.matched, unmatched: result.unmatched },
    });

    const hardErrors = perFile.filter((f) => f.error);
    if (hardErrors.length && result.collected === 0) {
      return NextResponse.json({ error: `파싱 실패: ${hardErrors.map((f) => `${f.name}(${f.error})`).join(", ")}`, perFile }, { status: 400 });
    }
    return NextResponse.json({ ok: true, perFile, ...result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
