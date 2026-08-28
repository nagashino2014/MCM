/**
 * 쇼핑몰 전표 PDF 내려받기 — 스토리지 키로 원본을 돌려준다.
 * 키는 shop-receipts/ 프리픽스에 갇혀 있어야 한다(다른 문서를 이 창구로 꺼낼 수 없게).
 */

import { NextRequest } from "next/server";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { isShopReceiptKey, readShopReceipt } from "@/lib/storage/shop-receipt-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key || !isShopReceiptKey(key)) {
    return new Response(JSON.stringify({ error: "잘못된 파일 키입니다." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const body = await readShopReceipt(key).catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: "파일을 찾지 못했습니다." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const fileName = key.split("/").pop() || "receipt.pdf";
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, max-age=3600",
    },
  });
}
