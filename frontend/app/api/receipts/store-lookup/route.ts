import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { formatCorpNum, isValidCorpNum, lookupStoreByCorpNum, normalizeCorpNum } from "@/lib/finance/store-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?corpNum=1234567890 — 사업자번호로 상호를 찾는다(영수증 확인 폼의 "상호 찾기").
// 소스는 내부 실데이터뿐이다(법인카드 매입내역·세금계산서·분류 학습 사전·과거 영수증) — 외부 조회 없음.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const raw = req.nextUrl.searchParams.get("corpNum") ?? "";
    const corpNum = normalizeCorpNum(raw);
    if (!corpNum) {
      return NextResponse.json({ error: "사업자번호 10자리를 입력하세요." }, { status: 400 });
    }
    if (!isValidCorpNum(corpNum)) {
      return NextResponse.json(
        { corpNum, formatted: formatCorpNum(corpNum), valid: false, store: null, message: "사업자번호 형식이 맞지 않습니다 — 자릿수를 다시 확인해 주세요." },
        { status: 200 },
      );
    }
    const store = await lookupStoreByCorpNum(corpNum);
    return NextResponse.json({
      corpNum,
      formatted: formatCorpNum(corpNum),
      valid: true,
      store,
      message: store?.storeName ? null : "등록된 거래 이력에서 상호를 찾지 못했습니다 — 직접 입력해 주세요.",
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
