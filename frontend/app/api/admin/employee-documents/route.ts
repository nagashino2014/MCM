import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getEmployeeDetail, recordEmployeeDocument } from "@/lib/admin/employee-records";
import {
  buildEmployeeDocumentStorageKey,
  putEmployeeDocument,
} from "@/lib/storage/employee-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/haansofthwp",
  "application/x-hwp",
  "application/octet-stream",
]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("staffing.documents.manage", { fallbackRoles: ["admin"] });
    const form = await req.formData();
    const file = form.get("file");
    const employeeId = String(form.get("employeeId") ?? "");
    const documentType = String(form.get("documentType") ?? "document");
    const targetTable = String(form.get("targetTable") ?? "employee_profiles");
    const targetId = String(form.get("targetId") ?? "") || null;
    const displayName = String(form.get("displayName") ?? "") || documentType;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    }
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId가 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "증빙 파일은 20MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.type && !ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "허용되지 않는 파일 형식입니다." }, { status: 400 });
    }
    const employee = await getEmployeeDetail(employeeId);
    if (!employee) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const { storageKey, fileName } = buildEmployeeDocumentStorageKey({
      employeeId,
      employeeName: employee.name,
      documentType,
      originalFilename: file.name || "document",
    });
    const stored = await putEmployeeDocument(
      storageKey,
      buffer,
      file.type || "application/octet-stream"
    );
    const document = await recordEmployeeDocument({
      actorUserId: actor.userId,
      employeeId,
      targetTable,
      targetId,
      documentType,
      displayName,
      originalFilename: file.name || fileName,
      contentType: file.type || "application/octet-stream",
      byteSize: file.size,
      sha256,
      ...stored,
    });
    return NextResponse.json({ document });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
