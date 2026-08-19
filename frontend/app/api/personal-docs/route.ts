import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import {
  deletePersonalDocs,
  listPersonalDocs,
  uploadPersonalDoc,
  PERSONAL_DOC_MAX_FILE_BYTES,
} from "@/lib/files/personal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/personal-docs — 내 문서 목록 + 사용량/할당 용량.
export async function GET() {
  try {
    const ctx = await requireSession();
    const result = await listPersonalDocs(ctx.userId);
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST /api/personal-docs — 업로드(멀티파트 files[], 파일당 200MB·할당 용량 내).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
    }
    const uploaded = [];
    for (const file of files) {
      if (file.size > PERSONAL_DOC_MAX_FILE_BYTES) {
        return NextResponse.json({ error: `'${file.name}' — 파일당 최대 200MB 까지 업로드할 수 있습니다.` }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      uploaded.push(
        await uploadPersonalDoc(ctx.userId, {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          buffer,
        })
      );
    }
    return NextResponse.json({ uploaded });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE /api/personal-docs — 내 문서 선택 삭제. body: { ids: string[] }
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
    const ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : [];
    if (!ids.length) {
      return NextResponse.json({ error: "삭제할 파일을 선택해 주세요." }, { status: 400 });
    }
    const deleted = await deletePersonalDocs(ctx.userId, ids);
    return NextResponse.json({ deleted });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
