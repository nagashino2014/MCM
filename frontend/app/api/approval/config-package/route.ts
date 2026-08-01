import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { exportConfigPackage, importConfigPackage, type ConfigPackage } from "@/lib/analytics/config-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 설정 패키지(양식+의미 사전+지표) 내보내기/가져오기 — SW-P4 SaaS 채비(§9). admin 전용.
export async function GET() {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const pkg = await exportConfigPackage();
    return new NextResponse(JSON.stringify(pkg, null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="mcm-config-package-${pkg.exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 패키지 적용(upsert — 삭제 없음). body = ConfigPackage JSON.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const pkg = (await req.json().catch(() => null)) as ConfigPackage | null;
    if (!pkg || pkg.packageVersion !== 1) {
      return NextResponse.json({ error: "올바른 설정 패키지 JSON 이 아닙니다(packageVersion 1)." }, { status: 400 });
    }
    const summary = await importConfigPackage(pkg, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_semantic_update",
      targetTable: "config_package",
      targetId: "import",
      after: { folders: summary.folders, forms: summary.forms, concepts: summary.concepts, metrics: summary.metrics, errors: summary.errors.length },
    });
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
