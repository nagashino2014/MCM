import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { normalizePaidAt, normalizeReceiptImage, type ReceiptFields } from "@/lib/finance/receipt-parser";
import { findDuplicateReceipts, listMyReceipts, saveReceipt, type ReceiptScope } from "@/lib/finance/receipts";
import { classifyMany, loadCategories } from "@/lib/barobill/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES: ReceiptScope[] = ["unused", "used", "excluded", "all"];

// GET: 내 영수증 목록.
//  - scope=unused|used|excluded|all (모바일 보관함 탭). unusedOnly=1 은 기안 피커의 종전 규약(=unused).
//  - 기간(from/to)은 선택 — 없으면 전 기간에서 최근 순으로 준다.
//  - formId 를 주면 그 양식의 분류 select 옵션 문자열(formOption)까지 매핑해 준다(card-picker 규약).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const scopeRaw = sp.get("scope") as ReceiptScope | null;
    const scope: ReceiptScope =
      scopeRaw && SCOPES.includes(scopeRaw) ? scopeRaw : sp.get("unusedOnly") === "1" ? "unused" : "all";
    const receipts = await listMyReceipts({
      ownerUserId: ctx.userId,
      scope,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
      limit: Number(sp.get("limit") ?? 100) || 100,
    });

    // 피커용 — 저장 시점 분류가 비어 있으면 재분류하고, 양식 select 옵션 문자열로 매핑(card-picker 규약).
    const formId = sp.get("formId") || "";
    const categories = await loadCategories();
    const byKey = new Map(categories.map((c) => [c.categoryKey, c]));
    // 개인카드 영수증만 사업자번호 학습으로 분류를 물려받는다(사용자 확정 2026-08-20).
    // 쿠팡·네이버페이 같은 전자상거래는 같은 매입처라도 건마다 계정이 갈리므로 자동 지정에서 뺀다.
    const reclassed = await classifyMany(
      receipts.map((r) => ({ storeCorpNum: r.storeCorpNum, storeBizType: null, storeName: r.storeName })),
      { skipEcommerce: true },
    );
    const items = receipts.map((r, i) => {
      const categoryKey = r.categoryKey ?? reclassed[i]?.categoryKey ?? null;
      const cat = categoryKey ? byKey.get(categoryKey) : undefined;
      return {
        receiptId: r.receiptId,
        paidAt: r.paidAt,
        paidDate: r.paidAt ? r.paidAt.slice(0, 10) : null,
        storeName: r.storeName,
        storeCorpNum: r.storeCorpNum,
        totalAmount: r.totalAmount,
        cardLast4: r.cardLast4,
        items: r.items,
        memo: r.memo,
        docId: r.docId,
        docTitle: r.docTitle,
        docNo: r.docNo,
        docStatus: r.docStatus,
        excluded: r.excluded,
        createdAt: r.createdAt,
        pdfKey: r.pdfKey,
        pdfName: `영수증_${(r.storeName ?? "미상").slice(0, 30)}_${r.paidAt?.slice(0, 10) ?? ""}.pdf`,
        categoryKey,
        categoryLabel: cat?.label ?? null,
        categorySource: r.categorySource ?? reclassed[i]?.source ?? null,
        formOption: formId && cat ? cat.formOptionMap[formId] ?? null : null,
      };
    });
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 촬영 확정 저장 — multipart(file=이미지, fields=확인·수정된 JSON, parsed=LLM 원본 JSON, memo).
// 중복 의심(승인번호 일치 또는 ±1일 동일 금액) 시 force=1 없이는 409 + 목록 반환(사용자 확인 후 재요청).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
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
    let fields: ReceiptFields;
    try {
      fields = JSON.parse(String(form.get("fields") ?? "")) as ReceiptFields;
    } catch {
      return NextResponse.json({ error: "fields JSON 이 올바르지 않습니다." }, { status: 400 });
    }
    if (fields.totalAmount == null || !(Number(fields.totalAmount) > 0)) {
      return NextResponse.json({ error: "결제 금액을 입력하세요." }, { status: 400 });
    }
    // 사용일시는 저장 계약(YYYY-MM-DD HH:MM)으로 맞춰서 넣는다 — 확인 폼에서 자유 입력된 표기가
    // 그대로 들어가면 목록의 기간 필터(문자열 비교) 밖으로 떨어진다. 해석 불가면 null(=날짜 미상).
    fields.paidAt = normalizePaidAt(fields.paidAt ?? null);

    if (String(form.get("force") ?? "") !== "1") {
      const duplicates = await findDuplicateReceipts(ctx.userId, {
        approvalNum: fields.approvalNum ?? null,
        paidAt: fields.paidAt ?? null,
        totalAmount: fields.totalAmount,
      });
      if (duplicates.length) {
        return NextResponse.json(
          {
            error: "같은 영수증이 이미 저장돼 있을 수 있습니다.",
            duplicates: duplicates.map((d) => ({
              receiptId: d.receiptId,
              paidAt: d.paidAt,
              storeName: d.storeName,
              totalAmount: d.totalAmount,
            })),
          },
          { status: 409 },
        );
      }
    }

    let parsed: unknown = null;
    const parsedRaw = String(form.get("parsed") ?? "");
    if (parsedRaw) {
      try {
        parsed = JSON.parse(parsedRaw);
      } catch {
        parsed = null;
      }
    }
    const image = await normalizeReceiptImage(Buffer.from(await file.arrayBuffer()));
    const receipt = await saveReceipt({
      ownerUserId: ctx.userId,
      ownerLabel: ctx.email || ctx.userId,
      fields,
      parsed,
      image,
      memo: String(form.get("memo") ?? "") || null,
    });
    return NextResponse.json({ receipt });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
