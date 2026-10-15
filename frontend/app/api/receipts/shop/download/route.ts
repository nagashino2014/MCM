/**
 * 쇼핑몰 전표 일괄 다운로드 — 목록에서 체크한 전표를 세무 대리인에게 보낼 묶음으로 만든다(2026-10-14 사용자 요청).
 *
 *   mode=merged : 고른 전표를 주문일 순으로 이어 붙인 PDF 한 개
 *   mode=zip    : 전표별 PDF 를 ZIP 한 개로(브라우저가 여러 파일 동시 다운로드를 막아 ZIP 으로 묶는다)
 *
 * 쿠팡 묶음처럼 여러 전표가 같은 파일을 가리키면 그 파일은 한 번만 넣는다. 파일이 없는 전표는 건너뛰고
 * 건수를 X-Skipped-Count 헤더로 알려 준다.
 */

import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse, mergePdfBytes, sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { loadShopReceiptFiles } from "@/lib/receipts/shop-receipt-store";
import { shopByKey } from "@/lib/receipts/shops";
import { isShopReceiptKey, readShopReceipt } from "@/lib/storage/shop-receipt-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RECEIPTS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("finance.view");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const body = (await req.json().catch(() => ({}))) as {
    receiptIds?: unknown;
    mode?: unknown;
    from?: unknown;
    to?: unknown;
  };
  const receiptIds = Array.isArray(body.receiptIds)
    ? [...new Set(body.receiptIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
    : [];
  const mode = body.mode === "zip" ? "zip" : "merged";
  if (receiptIds.length === 0) {
    return NextResponse.json({ error: "내려받을 전표를 골라 주세요." }, { status: 400 });
  }
  if (receiptIds.length > MAX_RECEIPTS) {
    return NextResponse.json({ error: `한 번에 ${MAX_RECEIPTS}건까지 내려받을 수 있습니다.` }, { status: 400 });
  }

  try {
    const receipts = await loadShopReceiptFiles(receiptIds);
    const seen = new Set<string>();
    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    let skipped = 0;

    for (const r of receipts) {
      if (!r.storageKey || !isShopReceiptKey(r.storageKey)) {
        skipped++;
        continue;
      }
      if (seen.has(r.storageKey)) continue;
      seen.add(r.storageKey);
      const bytes = await readShopReceipt(r.storageKey).catch(() => null);
      if (!bytes) {
        skipped++;
        continue;
      }
      // 파일명: 주문일_쇼핑몰_주문번호_금액원.pdf — 받는 쪽에서 원장과 대조하기 쉽게
      const shop = shopByKey(r.site)?.name ?? r.site;
      const amount = r.amount ? `_${r.amount.toLocaleString("ko-KR")}원` : "";
      files.push({
        name: sanitizeDownloadName(`${r.orderDate || "날짜없음"}_${shop}_${r.orderNo}${amount}.pdf`),
        bytes: new Uint8Array(bytes),
      });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "고른 전표에 내려받을 PDF 파일이 없습니다." }, { status: 404 });
    }

    const from = typeof body.from === "string" && DATE_RE.test(body.from) ? body.from : "";
    const to = typeof body.to === "string" && DATE_RE.test(body.to) ? body.to : "";
    const period = from && to ? `_${from}~${to}` : "";
    const stem = `쇼핑몰전표${period}_${files.length}건`;

    let res: NextResponse;
    if (mode === "merged") {
      res = binaryResponse(await mergePdfBytes(files.map((f) => f.bytes)), "application/pdf", `${stem}.pdf`);
    } else {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const f of files) {
        // 같은 날·같은 주문번호가 겹치는 일은 없지만 이름 충돌 시 덮어쓰지 않게 번호를 붙인다.
        let name = f.name;
        for (let i = 2; used.has(name); i++) name = f.name.replace(/\.pdf$/i, `(${i}).pdf`);
        used.add(name);
        zip.file(name, f.bytes);
      }
      res = binaryResponse(await zip.generateAsync({ type: "uint8array" }), "application/zip", `${stem}.zip`);
    }
    res.headers.set("X-Skipped-Count", String(skipped));
    res.headers.set("X-File-Count", String(files.length));
    return res;
  } catch (err) {
    return NextResponse.json({ error: "전표 묶음을 만들지 못했습니다: " + (err as Error).message }, { status: 500 });
  }
}
