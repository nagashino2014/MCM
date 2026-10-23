import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { listStudioVersions, snapshotStudioDoc } from "@/lib/catalog/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const docIdOf = (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get("doc") || MASTER_DOC_ID;
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : MASTER_DOC_ID;
};

// GET: 버전 목록(최근 50) — 판 번호·메모·저장 시각·저장한 사람
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.manage");
    return NextResponse.json({ versions: await listStudioVersions(docIdOf(req)) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 버전 저장 { note } — 지금 저장된 상태를 스냅샷으로 남긴다(catalog_versions, 판 번호 +1)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const docId = docIdOf(req);
    const body = (await req.json().catch(() => ({}))) as { note?: unknown };
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
    const out = await snapshotStudioDoc(docId, note, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_versions",
      targetId: `${docId}:${out.version}`,
      after: { version: out.version, note },
    });
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
