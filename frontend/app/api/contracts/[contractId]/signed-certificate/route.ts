import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { getCertificateDoc, saveCertificateDoc } from "@/lib/contracts/certificate-storage";
import { deleteContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const MAX_BYTES = 20 * 1024 * 1024;
const PDF_MIME = "application/pdf";

// 서명(직인) 증명서 PDF 첨부 여부 조회
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { contractId } = await ctx.params;
    const doc = await getCertificateDoc(contractId, "certificate_signed");
    return NextResponse.json({ attached: !!doc, fileName: doc?.displayName ?? null });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 서명(직인) 증명서 PDF 첨부/교체 — S3에 저장(같은 계약은 기존 파일 교체)
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "증명서 PDF 파일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "증명서 PDF는 20MB 이하만 첨부할 수 있습니다." }, { status: 400 });
    }
    if (file.type && file.type !== PDF_MIME) {
      return NextResponse.json({ error: "PDF 파일만 첨부할 수 있습니다." }, { status: 400 });
    }

    // 계약명 기반 고정 파일명 — 재첨부 시 동일 키로 덮어써 교체된다.
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec("SELECT contract_title FROM contracts WHERE contract_id = $1", [contractId])
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    const title = String(rows[0]?.contract_title ?? contractId).trim() || contractId;
    const fileName = `${title} 서명증명서.pdf`;

    // 교체 전 기존 파일 키 확보(키가 달라지면 S3 정리)
    const prior = await getCertificateDoc(contractId, "certificate_signed");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await saveCertificateDoc({
      contractId,
      actorUserId: actor.userId,
      documentType: "certificate_signed",
      fileName,
      bytes,
      contentType: PDF_MIME,
    });

    if (prior?.storageKey && prior.storageKey !== saved.storageKey) {
      await deleteContractDocument(prior.storageKey);
    }

    return NextResponse.json({ attached: true, fileName: saved.displayName });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
