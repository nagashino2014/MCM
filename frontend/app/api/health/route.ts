import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb, getDbPath } from "@/lib/db";
import { ensureAdminSeeded } from "@/lib/auth/seed";
import { countAdmins } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // 기본(=ALB liveness): DB 를 전혀 건드리지 않는다.
  // 이 라우트는 ALB 타겟그룹 헬스체크(30초 주기)가 호출하는데, DB 를 건드리면
  // Aurora Serverless v2 가 매번 깨어나 auto-pause(유휴 300초) 가 영원히 발동하지 못한다.
  // DB·시드·관리자 수까지 보는 심층 점검은 ?deep=1 로 명시할 때만 수행한다.
  if (req.nextUrl.searchParams.get("deep") !== "1") {
    return NextResponse.json({ ok: true, live: true });
  }

  const dbPath = getDbPath();
  let dbExists = false;
  let dbError: string | null = null;
  try {
    const db = await getDb();
    await db.exec("SELECT 1");
    dbExists = true;
  } catch (err) {
    dbError = (err as Error)?.message ?? String(err);
    dbExists = false;
  }
  const scraperRoot = path.resolve(process.cwd(), "..", "scraper");
  const cliPath = path.join(scraperRoot, "scripts", "cli-collect.ts");
  const cliExists = fs.existsSync(cliPath);

  let adminCount = 0;
  let seedTried = false;
  let seedError: string | null = null;
  if (dbExists) {
    try {
      await ensureAdminSeeded();
      seedTried = true;
    } catch (err) {
      seedError = (err as Error).message;
    }
    try {
      adminCount = await countAdmins();
    } catch {
      adminCount = 0;
    }
  }

  return NextResponse.json({
    ok: true,
    dbPath,
    dbExists,
    dbError,
    scraperRoot,
    cliExists,
    cwd: process.cwd(),
    users: {
      adminCount,
      seedTried,
      seedError,
    },
  });
}
