// 은행·카드사 로고 서빙 — DB 업로드본 우선, 없으면 번들 정적 파일(public/finance/logos)로 폴백.
// 로그인 화면 밖에서도 이미지 로드가 가능해야 하므로 인증 없이 공개(로고는 민감정보 아님).

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[A-Z_]{2,24}$/;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!CODE_RE.test(code)) return new NextResponse(null, { status: 400 });
  try {
    const db = await getDb();
    const rows = rowsToObjects(await db.exec(`SELECT mime, data_base64 FROM finance_logos WHERE logo_code = $1`, [code]));
    if (rows.length) {
      return new NextResponse(Buffer.from(String(rows[0].data_base64), "base64"), {
        headers: {
          "Content-Type": String(rows[0].mime),
          // 교체 직후 다른 화면(원장 태그)에도 빨리 반영되도록 짧게 캐시한다.
          "Cache-Control": "public, max-age=30",
        },
      });
    }
  } catch {
    // DB 미가용 시 정적 폴백으로 진행
  }
  try {
    const file = await fs.readFile(path.join(process.cwd(), "public", "finance", "logos", `${code}.png`));
    return new NextResponse(file, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
