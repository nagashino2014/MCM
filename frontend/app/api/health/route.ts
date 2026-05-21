import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDb, getDbPath } from "@/lib/db";
import { ensureAdminSeeded } from "@/lib/auth/seed";
import { countAdmins } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
