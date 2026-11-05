import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { listEmergencyContacts } from "@/lib/emergency-contacts";
import {
  createEmergencyContactsPdf,
  createEmergencyContactsWorkbook,
  emergencyContactsFileName,
} from "@/lib/emergency-contacts-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 비상 연락망 엑셀·PDF 다운로드 — 로그인 전원(2026-11-05 사용자 결정), 다운로드마다 접속기록(access_log export)을 남긴다. 숨긴 행은 넣지 않는다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
    const now = new Date();
    const rows = (await listEmergencyContacts()).filter((r) => !r.hidden);
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "export",
      targetKind: "emergency_contacts",
      detail: { format, count: rows.length },
    });
    const file = format === "pdf" ? await createEmergencyContactsPdf(rows, now) : await createEmergencyContactsWorkbook(rows, now);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type":
          format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(emergencyContactsFileName(format, now))}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
