import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getEmployeeDocument, putEmployeeDocument } from "@/lib/storage/employee-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DOC_TYPES = new Set(["integrated_plan", "media_permit", "factory_reg"]);

// 시설 자료 다운로드 (?docType=)
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    const docType = req.nextUrl.searchParams.get("docType") ?? "";
    if (!DOC_TYPES.has(docType)) return NextResponse.json({ error: "invalid docType" }, { status: 400 });
    const db = await getDb();
    const row = rowsToObjects(
      await db.exec("SELECT storage_key, content_type, original_filename FROM facility_facility_documents WHERE facility_id = $1 AND doc_type = $2 LIMIT 1", [id, docType])
    )[0];
    if (!row?.storage_key) return new NextResponse(null, { status: 404 });
    const obj = await getEmployeeDocument(String(row.storage_key));
    if (!obj.body) return new NextResponse(null, { status: 404 });
    const fname = encodeURIComponent(String(row.original_filename ?? `${docType}`));
    return new NextResponse(obj.body as unknown as ReadableStream, {
      headers: {
        "content-type": obj.contentType ?? String(row.content_type ?? "application/octet-stream"),
        "content-disposition": `attachment; filename*=UTF-8''${fname}`,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 시설 자료 업로드 (form: file, docType)
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const docType = String(form.get("docType") ?? "");
    if (!DOC_TYPES.has(docType)) return NextResponse.json({ error: "invalid docType" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "파일을 첨부하세요." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "파일은 20MB 이하만 가능합니다." }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const storageKey = `facilities/${id}/facility-docs/${docType}-${Date.now()}.${ext}`;
    const stored = await putEmployeeDocument(storageKey, buf, file.type || "application/octet-stream");
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_facility_documents
           (facility_id, doc_type, display_name, original_filename, content_type, byte_size,
            storage_provider, storage_bucket, storage_key, uploaded_at, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (facility_id, doc_type) DO UPDATE SET
           display_name = EXCLUDED.display_name, original_filename = EXCLUDED.original_filename,
           content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size,
           storage_provider = EXCLUDED.storage_provider, storage_bucket = EXCLUDED.storage_bucket,
           storage_key = EXCLUDED.storage_key, uploaded_at = EXCLUDED.uploaded_at, uploaded_by = EXCLUDED.uploaded_by`,
        [
          id, docType, file.name, file.name, file.type || null, file.size,
          stored.storageProvider, stored.storageBucket, stored.storageKey, now, actor.userId || null,
        ]
      );
    });
    return NextResponse.json({ ok: true, uploadedAt: now });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
