import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { createAsset, listAssets, type AssetKind } from "@/lib/assets/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseKind(v: string | null): AssetKind | undefined {
  return v === "vehicle" || v === "room" || v === "etc" ? v : undefined;
}

// GET ?kind=vehicle&activeOnly=1 : 자산 목록.
// 로그인만으로 조회 가능 — 출장신청서 asset_select 렌더러·예약 화면이 전 직원 공용으로 쓴다.
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const kind = parseKind(req.nextUrl.searchParams.get("kind"));
    const activeOnly = req.nextUrl.searchParams.get("activeOnly") === "1";
    return NextResponse.json({ assets: await listAssets({ kind, activeOnly }) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST : 자산 등록(asset.manage).
export async function POST(req: NextRequest) {
  try {
    await requirePermission("asset.manage");
    const body = (await req.json()) as {
      kind?: string;
      name?: string;
      description?: string | null;
      sortOrder?: number;
    };
    const kind = parseKind(body.kind ?? null);
    if (!kind) return NextResponse.json({ error: "자산 종류가 올바르지 않습니다." }, { status: 400 });
    const asset = await createAsset({
      kind,
      name: String(body.name ?? ""),
      description: body.description ?? null,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
    });
    return NextResponse.json({ ok: true, asset });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
