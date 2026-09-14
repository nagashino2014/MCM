import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getDb, rowsToObjects } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getFacilityBusinessCertificate } from "@/lib/storage/facility-business-certificate-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("facility.view");
    const key = req.nextUrl.searchParams.get("key")?.trim();
    if (!key || key.includes("..") || key.startsWith("/") || key.startsWith("\\")) {
      return NextResponse.json({ error: "문서 키가 올바르지 않습니다." }, { status: 400 });
    }

    const db = await getDb();
    const certificate = rowsToObjects(await db.exec(
      `SELECT c.certificate_id FROM facility_business_certificates c
        JOIN facilities f ON f.facility_id = c.facility_id
        WHERE c.storage_key = $1 AND c.parsed_json->>'deletedAt' IS NULL AND f.deleted_at IS NULL`, [key]
    ))[0];
    if (!certificate) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });

    const localRoot = process.env.FACILITY_DOCUMENT_STORAGE_ROOT?.trim();
    if (localRoot) {
      const root = path.resolve(localRoot);
      const target = path.resolve(root, key);
      if (!target.startsWith(root + path.sep)) {
        return NextResponse.json({ error: "문서 키가 올바르지 않습니다." }, { status: 400 });
      }
      const info = await stat(target);
      const body = await readFile(target);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(info.size),
          "Cache-Control": "private, no-store",
        },
      });
    }

    const obj = await getFacilityBusinessCertificate(key);
    if (!obj.body) return NextResponse.json({ error: "문서를 읽을 수 없습니다." }, { status: 404 });
    return new NextResponse(obj.body, {
      headers: {
        "Content-Type": obj.contentType,
        "Content-Length": obj.contentLength != null ? String(obj.contentLength) : "",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
