// 은행·카드사 로고 등록/교체 — 연결 관리 "은행·카드사 로고 등록" 카드에서 업로드(F0).
// base64 JSON 바디(≤1MB 원본). 표시 크기 조정은 클라이언트 object-contain 이 담당하므로 서버 리사이즈 없음.

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[A-Z_]{2,24}$/;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_BYTES = 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const actor = await requirePermission("finance.manage");
    const { code } = await params;
    if (!CODE_RE.test(code)) return NextResponse.json({ error: "코드 형식이 올바르지 않습니다." }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { mime?: string; dataBase64?: string };
    if (!body.mime || !ALLOWED_MIME.has(body.mime)) {
      return NextResponse.json({ error: "PNG·JPG·WebP·SVG 이미지만 등록할 수 있습니다." }, { status: 400 });
    }
    const base64 = String(body.dataBase64 ?? "").replace(/^data:[^,]+,/, "");
    if (!base64) return NextResponse.json({ error: "이미지 데이터가 비어 있습니다." }, { status: 400 });
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: "이미지는 1MB 이하여야 합니다." }, { status: 400 });
    }
    const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO finance_logos (logo_code, mime, data_base64, uploaded_by, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (logo_code) DO UPDATE SET
           mime = EXCLUDED.mime, data_base64 = EXCLUDED.data_base64,
           uploaded_by = EXCLUDED.uploaded_by, updated_at = EXCLUDED.updated_at`,
        [code, body.mime, bytes.toString("base64"), actor.userId, now],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
