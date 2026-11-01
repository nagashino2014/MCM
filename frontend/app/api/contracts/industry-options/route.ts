import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  INTEGRATED_PERMIT_OPTION_SUFFIX,
  activePermitIndustries,
  permitIndustryFromLabel,
} from "@/lib/ieps/integrated-permit-industries";
import { loadPermitIndustries } from "@/lib/ieps/permit-industries-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMIT_MANAGED_ERROR = "통합허가 업종은 관리 › 통합허가 업종에서 관리합니다.";

/**
 * 계약 업종 옵션 = 통합허가 대상 업종(permit_industries 사용 중, '이름(통합허가)') + 그 밖의 옵션(contract_industry_options).
 * contract_industry_options 의 '(통합허가)' 행(082 시드)은 더 이상 읽지 않는다 — 단일 원천은 permit_industries(325).
 */
export async function GET() {
  try {
    await requireAuthenticated();
    const db = await getDb();
    const permitOptions = activePermitIndustries(await loadPermitIndustries(db)).map(
      (item) => `${item.label}${INTEGRATED_PERMIT_OPTION_SUFFIX}`
    );
    const rows = rowsToObjects(
      await db.exec(
        "SELECT option_name FROM contract_industry_options ORDER BY sort_order ASC, option_name ASC"
      )
    );
    const extraOptions = rows
      .map((row) => String(row.option_name ?? ""))
      .filter((option) => option && !option.endsWith(INTEGRATED_PERMIT_OPTION_SUFFIX));
    return NextResponse.json({ options: [...permitOptions, ...extraOptions], permitOptions, extraOptions });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 통합허가 업종 이름·옛 이름이거나 '(통합허가)' 접미면 true — 이 화면에서 추가·삭제하지 않는다. */
async function isPermitManaged(optionName: string): Promise<boolean> {
  if (optionName.endsWith(INTEGRATED_PERMIT_OPTION_SUFFIX)) return true;
  return permitIndustryFromLabel(optionName, await loadPermitIndustries()) !== null;
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("contract.edit");
    const body = await req.json();
    const optionName = String(body?.optionName ?? "").trim();
    if (!optionName) return NextResponse.json({ error: "업종명을 입력하세요." }, { status: 400 });
    if (await isPermitManaged(optionName)) return NextResponse.json({ error: PERMIT_MANAGED_ERROR }, { status: 400 });
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
    if (optionName.endsWith(INTEGRATED_PERMIT_OPTION_SUFFIX)) return NextResponse.json({ error: PERMIT_MANAGED_ERROR }, { status: 400 });
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
