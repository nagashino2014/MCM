import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        "SELECT option_name FROM contract_industry_options ORDER BY sort_order ASC, option_name ASC"
      )
    );
    return NextResponse.json({ options: rows.map((row) => String(row.option_name ?? "")).filter(Boolean) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("contract.edit");
    const body = await req.json();
    const optionName = String(body?.optionName ?? "").trim();
    if (!optionName) return NextResponse.json({ error: "업종명을 입력하세요." }, { status: 400 });
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO contract_industry_options (option_name, sort_order, created_at, updated_at)
         VALUES (
           $1,
           COALESCE((SELECT MAX(sort_order) + 1 FROM contract_industry_options), 1),
           $2,
           $2
         )
         ON CONFLICT (option_name) DO NOTHING`,
        [optionName, now]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission("contract.edit");
    const { searchParams } = new URL(req.url);
    const optionName = String(searchParams.get("optionName") ?? "").trim();
    if (!optionName) return NextResponse.json({ error: "업종명을 지정하세요." }, { status: 400 });
    const db = await getDb();
    const usedRows = rowsToObjects(
      await db.exec(
        "SELECT COUNT(*) AS count FROM contracts WHERE deleted_at IS NULL AND industry_category = $1",
        [optionName]
      )
    );
    if (Number(usedRows[0]?.count ?? 0) > 0) {
      return NextResponse.json({ error: "이미 계약에 사용 중인 업종은 삭제할 수 없습니다." }, { status: 409 });
    }
    await withDbWrite(async (writeDb) => {
      await writeDb.run("DELETE FROM contract_industry_options WHERE option_name = $1", [optionName]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
