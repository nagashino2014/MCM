// 기안 화면 "법인카드 내역 불러오기" API (블루프린트 P1 F1/F2)
// 미사용(결의서 미귀속)·미제외·승인 건 목록 + 자동 분류(3단) 결과를 양식 옵션 문자열로 내려준다.
// 권한: approval.view — 법인카드는 공용 운영이라 기안자 전원이 선택 가능(이중 기입은 doc_id 귀속으로 차단).

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listCardTransactions } from "@/lib/barobill/queries";
import { classifyMany, loadCategories } from "@/lib/barobill/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const formId = sp.get("formId") || "";
    const from = sp.get("from") || undefined;
    const to = sp.get("to") || undefined;

    const [{ rows }, categories] = await Promise.all([
      listCardTransactions({ from, to, unusedOnly: true, limit: 200 }),
      loadCategories(),
    ]);

    const results = await classifyMany(
      rows.map((r) => ({ storeCorpNum: r.storeCorpNum, storeBizType: r.storeBizType, storeName: r.storeName })),
    );

    const byKey = new Map(categories.map((c) => [c.categoryKey, c]));
    const items = rows.map((r, i) => {
      const cls = results[i];
      const cat = cls ? byKey.get(cls.categoryKey) : undefined;
      return {
        cardTxnId: r.cardTxnId,
        cardLabel: r.cardLabel,
        approvedAt: r.approvedAt,
        useDate: r.approvedAt.slice(0, 10), // 실측: 사용일시는 ApprovalDT 기준(롯데 UseDate 없음)
        amountTotal: r.amountTotal,
        storeName: r.storeName,
        storeBizType: r.storeBizType,
        isPurchased: r.isPurchased,
        categoryKey: cls?.categoryKey ?? null,
        categoryLabel: cat?.label ?? null,
        categorySource: cls?.source ?? null,
        // 대상 양식의 분류 select 옵션 문자열(없으면 null → 사용자가 직접 선택)
        formOption: cat ? cat.formOptionMap[formId] ?? null : null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
