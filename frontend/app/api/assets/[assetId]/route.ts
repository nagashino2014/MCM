import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteAsset, updateAsset, type AssetKind, type VehicleDetailInput } from "@/lib/assets/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseKind(v: unknown): AssetKind | undefined {
  return v === "vehicle" || v === "room" || v === "etc" ? v : undefined;
}

// PATCH : 자산 수정(asset.manage).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    await requirePermission("asset.manage");
    const { assetId } = await params;
    const body = (await req.json()) as {
      kind?: string;
      name?: string;
      description?: string | null;
      active?: boolean;
      sortOrder?: number;
      vehicle?: VehicleDetailInput;
    };
    await updateAsset(assetId, {
      kind: parseKind(body.kind),
      name: typeof body.name === "string" ? body.name : undefined,
      description: body.description !== undefined ? body.description : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      vehicle: body.vehicle,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}

// DELETE : 자산 삭제(asset.manage). 예약 이력이 있으면 비활성화로 대체된다.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    await requirePermission("asset.manage");
    const { assetId } = await params;
    const result = await deleteAsset(assetId);
    return NextResponse.json({ ok: true, deactivated: result.deactivated });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
