import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 사진 1장 상한 — 문서 삽입용이라 크게 잡을 이유가 없다(스마트폰 원본 수준). */
const MAX_FILE_BYTES = 30 * 1024 * 1024;

// POST: 성과품 사진 업로드(multipart files[]) — 용역결과보고서 별첨 페이지용(2026-08-19).
// S3 deliverables/photos/{YYYYMM}/ 에 적재하고 {name,key,size} 목록을 반환한다.
// 렌더러(pdf-lib·HWPX BinData)가 다루는 PNG·JPEG 만 받는다.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "files 가 필요합니다." }, { status: 400 });

    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    const items: { name: string; key: string; size: number }[] = [];
    for (const file of files) {
      const name = sanitizeFilename(file.name || "사진");
      if (!/\.(png|jpe?g)$/i.test(name)) {
        return NextResponse.json({ error: `${name}: PNG·JPG 사진만 첨부할 수 있습니다.` }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${name}: 파일이 30MB 를 초과합니다.` }, { status: 400 });
      }
      const key = `deliverables/photos/${ym}/${crypto.randomUUID().slice(0, 8)}_${name}`;
      await putContractDocument(key, Buffer.from(await file.arrayBuffer()), /\.png$/i.test(name) ? "image/png" : "image/jpeg");
      items.push({ name, key, size: file.size });
    }
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
