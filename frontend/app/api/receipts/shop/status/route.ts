/**
 * 쇼핑몰 전표 수집 — 사이트별 상태
 *
 * 로그인 흔적(cookies.json)과 대장(ledger.csv)을 읽어 화면에 보여줄 요약을 만든다.
 * 로컬에서 띄운 앱에서만 동작한다(세션과 브라우저가 이 PC 에 있기 때문).
 */

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { SHOPS, shopDir, localToolsEnabled, receiptsDir } from "@/lib/receipts/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ShopStatus {
  key: string;
  name: string;
  mode: string;
  hint?: string;
  loggedIn: boolean;
  /** 로그인 흔적이 마지막으로 갱신된 시각 */
  sessionAt: string | null;
  collected: number;
  lastCollectedAt: string | null;
  ledgerPath: string | null;
}

function countLedger(dir: string): { rows: number; lastAt: string | null } {
  const file = path.join(dir, "ledger.csv");
  if (!fs.existsSync(file)) return { rows: 0, lastAt: null };

  try {
    const lines = fs.readFileSync(file, "utf-8").replace(/^﻿/, "").trim().split(/\r?\n/);
    const body = lines.slice(1).filter((l: string) => l.trim());
    // collectedAt 은 마지막 열이다.
    const last = body[body.length - 1] || "";
    const at = last.split(",").pop()?.replace(/^"|"$/g, "") ?? null;
    return { rows: body.length, lastAt: at && /^\d{4}-/.test(at) ? at : null };
  } catch {
    return { rows: 0, lastAt: null };
  }
}

export async function GET() {
  try {
    await requirePermission("finance.view");
  } catch (err) {
    return authErrorToResponse(err);
  }

  if (!localToolsEnabled()) {
    return NextResponse.json(
      { error: "이 기능은 로컬에서 실행한 앱에서만 쓸 수 있습니다.", localOnly: true },
      { status: 403 }
    );
  }

  const shops: ShopStatus[] = SHOPS.map((shop) => {
    const dir = shopDir(shop.key);
    const cookies = path.join(dir, "cookies.json");
    const hasCookies = fs.existsSync(cookies);
    const ledger = countLedger(dir);

    return {
      key: shop.key,
      name: shop.name,
      mode: shop.mode,
      hint: shop.hint,
      loggedIn: hasCookies,
      sessionAt: hasCookies ? fs.statSync(cookies).mtime.toISOString() : null,
      collected: ledger.rows,
      lastCollectedAt: ledger.lastAt,
      ledgerPath: ledger.rows > 0 ? path.join(dir, "ledger.csv") : null,
    };
  });

  return NextResponse.json({ shops, receiptsDir: receiptsDir() });
}
