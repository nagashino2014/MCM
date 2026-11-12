import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import JSZip from "jszip";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMessageAttachmentsForUser } from "@/lib/mail/messages";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 첨부 전체 저장(직원 요청 10, 2026-11-12) — 메일 한 통의 일반 첨부를 ZIP 하나로 묶어 내려준다.
// 단일 첨부 다운로드(../route.ts)와 같은 소유권 검증(이 유저 mailbox 의 메시지만), 인라인(cid) 이미지는 뺀다.
// 본문 속 대용량 첨부 링크(261, /api/mail/large/<token>)는 mail_attachments 에 없는 외부 링크라 포함하지 않는다.

/** 묶을 수 있는 첨부 총량 — 메모리에서 압축하므로 상한을 둔다(일반 첨부는 발송 한도 25MB 라 보통 훨씬 작다). */
const ZIP_MAX_BYTES = 200 * 1024 * 1024;

/** ZIP 안 파일 이름 — 경로 구분자·제어문자를 빼고, 같은 이름은 "이름 (2).확장자" 로 번호를 붙인다. */
function uniqueEntryName(raw: string, used: Set<string>): string {
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 180) || "첨부";
  const dot = cleaned.lastIndexOf(".");
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  let name = cleaned;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} (${n})${ext}`;
  used.add(name.toLowerCase());
  return name;
}

// GET ?messageId=<id> : 그 메일의 일반 첨부 전부를 ZIP 으로.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const messageId = String(req.nextUrl.searchParams.get("messageId") ?? "");
    if (!messageId) return NextResponse.json({ error: "messageId 가 필요합니다." }, { status: 400 });
    const found = await listMessageAttachmentsForUser(ctx.userId, messageId);
    if (!found) return NextResponse.json({ error: "메일을 찾을 수 없습니다." }, { status: 404 });
    if (!found.files.length) return NextResponse.json({ error: "첨부가 없습니다." }, { status: 404 });
    const known = found.files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
    if (known > ZIP_MAX_BYTES) {
      return NextResponse.json({ error: "첨부가 너무 커서 한 번에 묶을 수 없습니다. 파일을 하나씩 내려받아 주세요." }, { status: 413 });
    }

    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
    const s3 = getS3Client();
    const zip = new JSZip();
    const used = new Set<string>();
    for (const f of found.files) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: f.s3Key }));
      if (!out.Body) continue;
      const bytes = await out.Body.transformToByteArray();
      // JSZip 은 비 ASCII 이름에 UTF-8 플래그(general purpose bit 11)를 켠다 — 윈도 탐색기·반디집에서 한글 이름 유지.
      zip.file(uniqueEntryName(f.filename, used), bytes, { binary: true, date: new Date() });
    }
    // 첨부(PDF·한글·오피스·이미지)는 대개 이미 압축돼 있어 낮은 압축 수준으로 빨리 묶는다.
    const zipped = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });

    const base = (found.subject || "메일").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "메일";
    const zipName = `${base}_첨부.zip`;
    return new NextResponse(zipped, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
        "Content-Length": String(zipped.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
