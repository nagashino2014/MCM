// 부가세 보드 API (P2 F3)
// GET  : 기간 계정과목 집계 (?from&to&cardId) · ?format=xlsx 이면 회계 인수용 엑셀 다운로드
// POST : 분류 편집(단건/일괄) · 자동분류 재실행

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getVatSummary, buildVatWorkbook, updateCardClassification, bulkAssignCategory, runAutoClassify } from "@/lib/barobill/vat";
import { loadCategories } from "@/lib/barobill/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: "기간(from·to)은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    }
    if (sp.get("format") === "xlsx") {
      const buf = await buildVatWorkbook({ from, to });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="card-vat-${from}_${to}.xlsx"`,
        },
      });
    }
    const [summary, categories] = await Promise.all([
      getVatSummary({ from, to, cardId: sp.get("cardId") || undefined }),
      loadCategories(),
    ]);
    return NextResponse.json({
      summary,
      categories: categories.map((c) => ({ key: c.categoryKey, label: c.label, vatDeductibleDefault: c.vatDeductibleDefault })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action: "update" | "bulk-assign" | "auto-classify";
  cardTxnId?: string;
  cardTxnIds?: string[];
  categoryKey?: string | null;
  vatDeductible?: number | null;
  excluded?: boolean;
  memo?: string | null;
  from?: string;
  to?: string;
  all?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "update") {
      if (!body.cardTxnId) return NextResponse.json({ error: "cardTxnId 가 필요합니다." }, { status: 400 });
      await updateCardClassification(body.cardTxnId, {
        categoryKey: body.categoryKey,
        vatDeductible: body.vatDeductible,
        excluded: body.excluded,
        memo: body.memo,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "bulk-assign") {
      if (!body.cardTxnIds?.length || !body.categoryKey) {
        return NextResponse.json({ error: "대상 건과 계정과목이 필요합니다." }, { status: 400 });
      }
      const count = await bulkAssignCategory(body.cardTxnIds, body.categoryKey);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_card_meta_update",
        targetTable: "card_transactions",
        targetId: `bulk:${count}`,
        after: { categoryKey: body.categoryKey, count },
      });
      return NextResponse.json({ ok: true, count });
    }

    if (body.action === "auto-classify") {
      const result = await runAutoClassify({ from: body.from, to: body.to, all: body.all === true });
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "finance_card_meta_update",
        targetTable: "card_transactions",
        targetId: "auto-classify",
        after: result,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "알 수 없는 액션입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
