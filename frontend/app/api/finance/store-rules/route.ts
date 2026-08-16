// 가맹점 계정과목 고정 규칙 API (마이그 173)
// GET    : 규칙 목록
// POST   : { action: "preview" } 영향 범위 미리보기 · { action: "save" } 규칙 저장 + 소급 적용
// DELETE : ?ruleId=... 규칙 삭제(이미 적용된 분류는 유지)

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listStoreRules, previewStoreRule, saveStoreRule, deleteStoreRule, StoreMatchType } from "@/lib/barobill/store-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("finance.view");
    return NextResponse.json({ rules: await listStoreRules() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action: "preview" | "save";
  cardTxnId?: string;
  matchType?: StoreMatchType;
  matchValue?: string;
  categoryKey?: string;
  storeName?: string | null;
  storeBizType?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const matchType: StoreMatchType = body.matchType === "store_name" ? "store_name" : "corp_num";

    if (body.action === "preview") {
      if (!body.cardTxnId) return NextResponse.json({ error: "cardTxnId 가 필요합니다." }, { status: 400 });
      return NextResponse.json(await previewStoreRule(body.cardTxnId, matchType));
    }

    if (body.action === "save") {
      if (!body.matchValue || !body.categoryKey) {
        return NextResponse.json({ error: "매칭 값과 계정과목이 필요합니다." }, { status: 400 });
      }
      const result = await saveStoreRule({
        matchType,
        matchValue: body.matchValue,
        categoryKey: body.categoryKey,
        storeName: body.storeName ?? null,
        storeBizType: body.storeBizType ?? null,
        actorUserId: actor.userId,
      });
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_card_meta_update",
        targetTable: "card_store_rules",
        targetId: result.ruleId,
        after: { matchType, matchValue: body.matchValue, categoryKey: body.categoryKey, applied: result.applied },
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "알 수 없는 액션입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const ruleId = req.nextUrl.searchParams.get("ruleId") || "";
    if (!ruleId) return NextResponse.json({ error: "ruleId 가 필요합니다." }, { status: 400 });
    await deleteStoreRule(ruleId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "finance_card_meta_update",
      targetTable: "card_store_rules",
      targetId: ruleId,
      after: { deleted: true },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
