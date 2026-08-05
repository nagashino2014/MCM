import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { insertImportedLetter } from "@/lib/letter/store";
import type { LetterRecipient } from "@/lib/letter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ImportMeta {
  letterNo: string;
  title: string;
  letterKind?: "general" | "proof";
  recipients?: LetterRecipient[];
  ccRefs?: LetterRecipient[];
  drafterName?: string | null;
  issueDate?: string | null;
}

// POST: 과거 발송 공문 백필(scripts/import_letters.py) — multipart/form-data.
//   meta:  ImportMeta JSON 문자열
//   hwp:   공문 hwp 원본(선택) / pdf: 공문 pdf(선택) / attach: 동봉 첨부(복수, 선택)
// letter_no UNIQUE 충돌 시 skipped 응답(재실행 멱등). 파일은 S3 letters/{연도}/{번호}/ 에 적재.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const form = await req.formData();
    const metaRaw = form.get("meta");
    if (typeof metaRaw !== "string") return NextResponse.json({ error: "meta(JSON) 가 필요합니다." }, { status: 400 });
    let meta: ImportMeta;
    try {
      meta = JSON.parse(metaRaw) as ImportMeta;
    } catch {
      return NextResponse.json({ error: "meta JSON 파싱 실패" }, { status: 400 });
    }
    if (!meta.letterNo?.trim() || !meta.title?.trim()) {
      return NextResponse.json({ error: "letterNo·title 은 필수입니다." }, { status: 400 });
    }
    const letterNo = meta.letterNo.trim();
    const year = /^(\d{4})/.exec(letterNo)?.[1] ?? "0000";
    const prefix = `letters/${year}/${sanitizeFilename(letterNo)}`;

    const putFile = async (file: File, role: string): Promise<{ name: string; key: string }> => {
      const name = sanitizeFilename(file.name || `${letterNo}-${role}`);
      const key = `${prefix}/${name}`;
      await putContractDocument(key, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
      return { name, key };
    };

    const hwpFile = form.get("hwp");
    const pdfFile = form.get("pdf");
    const attachFiles = form.getAll("attach").filter((f): f is File => f instanceof File);

    const hwp = hwpFile instanceof File ? await putFile(hwpFile, "hwp") : null;
    const pdf = pdfFile instanceof File ? await putFile(pdfFile, "pdf") : null;
    const attachKeys: { name: string; key: string }[] = [];
    for (const f of attachFiles) attachKeys.push(await putFile(f, "attach"));

    const result = await insertImportedLetter({
      letterNo,
      title: meta.title.trim(),
      letterKind: meta.letterKind,
      recipients: meta.recipients ?? [],
      ccRefs: meta.ccRefs ?? [],
      drafterName: meta.drafterName ?? null,
      issueDate: meta.issueDate ?? null,
      pdfKey: pdf?.key ?? null,
      hwpKey: hwp?.key ?? null,
      attachKeys,
    });
    if (!result.inserted) {
      return NextResponse.json({ ok: true, skipped: true, reason: "동일 공문번호가 이미 등록되어 있습니다.", letterNo });
    }
    return NextResponse.json({ ok: true, skipped: false, letterId: result.letterId, letterNo, files: { hwp: hwp?.key ?? null, pdf: pdf?.key ?? null, attachCount: attachKeys.length } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
