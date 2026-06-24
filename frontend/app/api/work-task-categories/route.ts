import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listTaskCategories, saveTaskCategory } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 업무분류 목록.
export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ categories: await listTaskCategories() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 업무분류 추가/수정.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as { categoryId?: string; categoryName?: string; presetId?: string | null; displayOrder?: number | null };
    const categoryId = await saveTaskCategory({
      categoryId: body.categoryId,
      categoryName: body.categoryName ?? "새 업무분류",
      presetId: body.presetId ?? null,
      displayOrder: body.displayOrder ?? null,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: body.categoryId ? "contract_update" : "contract_create",
      targetTable: "work_task_categories",
      targetId: categoryId,
      after: { categoryName: body.categoryName },
    });
    return NextResponse.json({ categoryId, categories: await listTaskCategories() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
