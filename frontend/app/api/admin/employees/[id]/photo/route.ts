import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getEmployeeDocument, putEmployeeDocument } from "@/lib/storage/employee-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 증명사진 조회 — 아바타로 여러 화면에서 쓰이므로 인증 사용자면 열람 가능.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { id } = await ctx.params;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec("SELECT photo_storage_key FROM employee_profiles WHERE employee_id = $1 LIMIT 1", [id])
    );
    const key = rows[0]?.photo_storage_key;
    if (!key) return new NextResponse(null, { status: 404 });
    const obj = await getEmployeeDocument(String(key));
    if (!obj.body) return new NextResponse(null, { status: 404 });
    return new NextResponse(obj.body as unknown as ReadableStream, {
      headers: {
        "content-type": obj.contentType ?? "image/jpeg",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 증명사진 업로드
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("staffing.edit", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "이미지 파일을 첨부하세요." }, { status: 400 });
    }
    if (!(file.type || "").startsWith("image/")) {
      return NextResponse.json({ error: "이미지 형식만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "사진은 8MB 이하만 가능합니다." }, { status: 400 });
    }
    const db = await getDb();
    const emp = rowsToObjects(
      await db.exec("SELECT employee_id FROM employee_profiles WHERE employee_id = $1 LIMIT 1", [id])
    );
    if (!emp.length) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const storageKey = `employees/photos/${id}/${Date.now()}.${ext}`;
    const stored = await putEmployeeDocument(storageKey, buf, file.type || "image/jpeg");
    const now = new Date().toISOString();
    const publicPath = `/api/admin/employees/${id}/photo`;
    await withDbWrite(async (dbw) => {
      await dbw.run(
        `UPDATE employee_profiles
            SET photo_storage_provider = $2, photo_storage_bucket = $3, photo_storage_key = $4,
                photo_public_path = $5, photo_updated_at = $6, updated_at = $6
          WHERE employee_id = $1`,
        [id, stored.storageProvider, stored.storageBucket, stored.storageKey, publicPath, now]
      );
    });
    return NextResponse.json({ photoPath: publicPath, updatedAt: now });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
