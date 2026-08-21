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
  /** 실제로 접근해 본 결과 — true 유효 / false 만료 / null 아직 확인 안 함 */
  sessionOk: boolean | null;
  sessionCheckedAt: string | null;
  sessionReason: string | null;
  collected: number;
  lastCollectedAt: string | null;
  ledgerPath: string | null;
}

/**
 * 세션 판정 결과 — 수집기(scraper)가 실제 접근 결과를 남긴 파일.
 * 쿠키 파일 존재만으로는 로그인이 살아 있는지 알 수 없어 이 값을 함께 보여 준다.
 */
function readSessionCheck(dir: string): { ok: boolean; checkedAt: string; reason?: string } | null {
  const file = path.join(dir, "session-check.json");
  if (!fs.existsSync(file)) return null;

  try {
    const body = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (typeof body?.ok !== "boolean" || typeof body?.checkedAt !== "string") return null;
    return { ok: body.ok, checkedAt: body.checkedAt, reason: body.reason };
  } catch {
    return null;
  }
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
    const check = readSessionCheck(dir);

    return {
      key: shop.key,
      name: shop.name,
      mode: shop.mode,
      hint: shop.hint,
      loggedIn: hasCookies,
      sessionAt: hasCookies ? fs.statSync(cookies).mtime.toISOString() : null,
      sessionOk: check ? check.ok : null,
      sessionCheckedAt: check ? check.checkedAt : null,
      sessionReason: check?.reason ?? null,
      collected: ledger.rows,
      lastCollectedAt: ledger.lastAt,
      ledgerPath: ledger.rows > 0 ? path.join(dir, "ledger.csv") : null,
    };
  });

  return NextResponse.json({ shops, receiptsDir: receiptsDir() });
}
