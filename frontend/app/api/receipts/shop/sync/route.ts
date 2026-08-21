/**
 * 쇼핑몰 전표 — 개인 PC 의 수집 결과를 스테이징으로 올린다
 *
 * 수집은 로그인 세션·브라우저가 있는 개인 PC 에서만 되고, 신고는 스테이징에서 한다.
 * 그 사이를 잇는 것이 이 라우트다 — 대장(ledger.csv) 행을 DB 에 올리고 전표 PDF 를 스토리지에 넣는다.
 * 로컬에서 띄운 앱에서만 동작한다(읽을 파일이 그 PC 에만 있다).
 *
 * 진행 상황은 run 라우트와 같은 모양의 SSE 로 흘려보낸다(화면이 같은 로그창을 쓴다).
 */

import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { SHOPS, shopByKey, shopDir, localToolsEnabled } from "@/lib/receipts/shops";
import { parseLedgerCsv, pdfPathOf } from "@/lib/receipts/ledger-csv";
import { putShopReceipt, shopReceiptStorageKey } from "@/lib/storage/shop-receipt-storage";
import {
  loadUploadedKeys,
  parseAmount,
  upsertShopReceipts,
  type ShopReceiptInput,
} from "@/lib/receipts/shop-receipt-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let userId: string | null = null;
  try {
    const ctx = await requirePermission("finance.manage");
    userId = ctx.userId;
  } catch (err) {
    return authErrorToResponse(err);
  }

  if (!localToolsEnabled()) {
    return new Response(
      JSON.stringify({ error: "이 기능은 로컬에서 실행한 앱에서만 쓸 수 있습니다.", localOnly: true }),
      { status: 403, headers: { "content-type": "application/json" } }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { sites?: string[] };
  const targets = (body.sites?.length ? body.sites : SHOPS.map((s) => s.key)).filter((key) => shopByKey(key));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const log = (line: string) => send("log", { line });

      send("start", { sites: targets });

      let rowCount = 0;
      let fileCount = 0;

      try {
        for (const site of targets) {
          const dir = shopDir(site);
          const ledger = path.join(dir, "ledger.csv");

          if (!fs.existsSync(ledger)) {
            log(`— ${site}: 대장이 없어 건너뜁니다.`);
            continue;
          }

          const rows = parseLedgerCsv(fs.readFileSync(ledger, "utf-8"));
          if (rows.length === 0) {
            log(`— ${site}: 대장이 비어 있습니다.`);
            continue;
          }

          const uploaded = await loadUploadedKeys(site);
          const pending: ShopReceiptInput[] = [];
          const sentThisRun = new Set<string>();

          for (const row of rows) {
            const relative = pdfPathOf(row);
            let storageKey: string | null = null;
            let fileName: string | null = null;

            if (relative) {
              storageKey = shopReceiptStorageKey(site, relative);
              fileName = path.basename(relative);

              // 쿠팡 묶음 전표처럼 여러 행이 같은 파일을 가리키므로 파일은 한 번만 올린다.
              if (!uploaded.has(storageKey) && !sentThisRun.has(storageKey)) {
                const source = path.join(dir, relative);
                if (fs.existsSync(source)) {
                  await putShopReceipt(storageKey, fs.readFileSync(source));
                  sentThisRun.add(storageKey);
                  fileCount++;
                  log(`  ↑ ${fileName}`);
                } else {
                  log(`  ⚠ 파일이 없습니다: ${relative}`);
                  storageKey = null;
                  fileName = null;
                }
              }
            }

            pending.push({
              site,
              orderNo: row.orderNo,
              orderDate: row.orderDate,
              title: row.title,
              amount: parseAmount(row.amount),
              receiptType: row.receiptType,
              method: row.method,
              storageKey,
              fileName,
              collectedAt: row.collectedAt,
            });
          }

          await upsertShopReceipts(pending, userId);
          rowCount += pending.length;
          log(`✅ ${site}: 전표 ${pending.length}건 / 새 파일 ${sentThisRun.size}개`);
        }

        log(`● 올리기 완료 — 전표 ${rowCount}건, 파일 ${fileCount}개`);
        send("done", { code: 0, rows: rowCount, files: fileCount });
      } catch (err) {
        log(`✖ ${(err as Error).message}`);
        send("done", { code: 1 });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" },
  });
}
