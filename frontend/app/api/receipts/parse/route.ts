import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { buildReceiptWarnings, parseReceipt } from "@/lib/finance/receipt-parser";
import { isValidCorpNum, lookupStoreByCorpNum } from "@/lib/finance/store-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영수증 이미지 → 필드 파싱(저장 없음). 결과는 확인 폼 프리필용 — 확정 저장은 /api/receipts POST.
// 권한: approval.view — 기안자 전원이 본인 경비 영수증을 찍는다(명함 parse 라우트 패턴).
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "영수증 이미지 파일을 첨부하세요." }, { status: 400 });
    }
    if (!/^image\//.test(file.type)) {
      return NextResponse.json({ error: "이미지 파일만 지원합니다." }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "이미지가 너무 큽니다(15MB 이하)." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseReceipt(buffer);
    if (!parsed) {
      return NextResponse.json({
        fields: null,
        warning: "영수증 분석 키(ANTHROPIC_API_KEY)가 설정되지 않아 자동 추출을 건너뛰었습니다. 수동 입력해 주세요.",
      });
    }
    const fields = parsed.fields;
    const warnings = buildReceiptWarnings(fields);
    const notices: string[] = [];

    // 상호 보정 — 지류 영수증의 한글 상호는 인쇄 품질 탓에 오인식이 잦다. 사업자번호(숫자·체크섬)가
    // 훨씬 안정적으로 읽히므로, 번호가 유효하면 내부 실데이터(법인카드 매입내역·세금계산서 등)에서
    // 찾은 상호로 덮어쓴다. 사용자는 확인 폼에서 그대로 고칠 수 있다.
    if (isValidCorpNum(fields.storeCorpNum)) {
      const info = await lookupStoreByCorpNum(fields.storeCorpNum);
      if (info?.storeName && info.storeName !== fields.storeName) {
        const before = fields.storeName;
        fields.storeName = info.storeName;
        notices.push(
          before
            ? `상호를 사업자번호로 찾은 "${info.storeName}"(으)로 맞췄습니다 — 인식값은 "${before}" 였습니다.`
            : `상호를 사업자번호로 찾아 "${info.storeName}"(으)로 채웠습니다.`,
        );
      }
    }

    return NextResponse.json({ fields, model: parsed.model, warnings, notices });
  } catch (err) {
    if (err instanceof Error && /영수증 분석/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
