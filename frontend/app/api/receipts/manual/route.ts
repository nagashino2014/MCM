import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { normalizeReceiptImage } from "@/lib/finance/receipt-parser";
import { saveManualReceipt } from "@/lib/finance/receipts";
import { loadCategories } from "@/lib/barobill/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ManualEntry {
  storeName?: string;
  paidAt?: string;
  totalAmount?: number | string;
  payMethod?: string;
  purpose?: string;
  /** files[] 안의 인덱스 */
  fileIndex?: number;
}

/**
 * POST: 영수증 직접 첨부(2026-09-15) — multipart `files[]` + `entries`(JSON 배열, 건별 내역·fileIndex).
 * 계좌이체 확인증·수기 전표 등 모바일 촬영 밖의 증빙을 웹 기안 화면에서 여러 건 한 번에 올린다.
 * 응답은 기안 피커(ReceiptPickerItem) 형태 — 저장 즉시 표 행·첨부로 담을 수 있게.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    let entries: ManualEntry[];
    try {
      entries = JSON.parse(String(form.get("entries") ?? "[]")) as ManualEntry[];
    } catch {
      return NextResponse.json({ error: "entries JSON 이 올바르지 않습니다." }, { status: 400 });
    }
    if (!Array.isArray(entries) || !entries.length) return NextResponse.json({ error: "입력된 내역이 없습니다." }, { status: 400 });
    const formId = String(form.get("formId") ?? "");
    const categories = await loadCategories();

    const items = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] ?? {};
      const storeName = String(e.storeName ?? "").trim();
      const amount = Number(String(e.totalAmount ?? "").replace(/[^\d.-]/g, ""));
      const paidAt = String(e.paidAt ?? "").trim();
      const file = typeof e.fileIndex === "number" ? files[e.fileIndex] : undefined;
      if (!storeName) return NextResponse.json({ error: `${i + 1}행: 상호를 입력하세요.` }, { status: 400 });
      if (!(amount > 0)) return NextResponse.json({ error: `${i + 1}행: 금액을 입력하세요.` }, { status: 400 });
      if (paidAt && !DATE_RE.test(paidAt)) return NextResponse.json({ error: `${i + 1}행: 사용일은 YYYY-MM-DD 형식이어야 합니다.` }, { status: 400 });
      if (!file) return NextResponse.json({ error: `${i + 1}행: 증빙 파일(이미지 또는 PDF)을 첨부하세요.` }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: `${i + 1}행: 파일이 너무 큽니다(20MB 이하).` }, { status: 400 });
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (!isPdf && !/^image\//.test(file.type)) {
        return NextResponse.json({ error: `${i + 1}행: 이미지 또는 PDF 파일만 첨부할 수 있습니다.` }, { status: 400 });
      }
      const raw = Buffer.from(await file.arrayBuffer());
      const buffer = isPdf ? raw : await normalizeReceiptImage(raw);
      const r = await saveManualReceipt({
        ownerUserId: ctx.userId,
        ownerLabel: ctx.email || ctx.userId,
        storeName,
        paidAt: paidAt || null,
        totalAmount: amount,
        payMethod: String(e.payMethod ?? "").trim() || null,
        purpose: String(e.purpose ?? "").trim() || null,
        file: { buffer, isPdf, originalName: file.name },
      });
      // 피커 규약(GET /api/receipts 와 동일 shape) — 분류는 없음(사용자가 표에서 확인).
      const cat = r.categoryKey ? categories.find((c) => c.categoryKey === r.categoryKey) : undefined;
      items.push({
        receiptId: r.receiptId,
        paidAt: r.paidAt,
        paidDate: r.paidAt ? r.paidAt.slice(0, 10) : null,
        storeName: r.storeName,
        totalAmount: r.totalAmount,
        cardLast4: null,
        items: [],
        memo: r.memo,
        docId: null,
        createdAt: r.createdAt,
        pdfKey: r.pdfKey,
        pdfName: `증빙_${(r.storeName ?? "미상").slice(0, 30)}_${r.paidAt?.slice(0, 10) ?? ""}.pdf`,
        categoryKey: r.categoryKey,
        categoryLabel: cat?.label ?? null,
        categorySource: r.categorySource,
        formOption: formId && cat ? cat.formOptionMap[formId] ?? null : null,
        source: "manual" as const,
        payMethod: r.payMethod,
        purpose: r.purpose,
        hasImage: !!r.imageKey,
      });
    }
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
