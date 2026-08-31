import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 계약명 중복 확인(2026-08-24) — 신규 계약 입력 모달의 '중복확인' 버튼이 호출.
 * 정확 일치(트림 후) 기준, 휴지통(soft delete) 건은 제외한다.
 * 자동 수정(연도·N차 부여)은 클라이언트가 이 API 를 반복 호출하며 수행한다.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const title = (req.nextUrl.searchParams.get("title") ?? "").trim();
    if (!title) return NextResponse.json({ error: "계약명이 필요합니다." }, { status: 400 });
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT COUNT(*)::int AS n FROM contracts
          WHERE TRIM(contract_title) = $1 AND deleted_at IS NULL`,
        [title]
      )
    );
    return NextResponse.json({ duplicate: Number(rows[0]?.n ?? 0) > 0 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
