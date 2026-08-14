import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { getS3Client } from "@/lib/storage/logo-storage";
import { getContractFile } from "@/lib/payroll/contracts";
import { buildContractPdfById } from "@/lib/payroll/contract-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 계약서 PDF 스트림 — imported 는 S3 원본, generated 는 온디맨드 렌더(서명 시 확정본). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> }
) {
  try {
    await requireAdmin();
    const { contractId } = await params;
    const file = await getContractFile(contractId);
    if (!file) {
      // 스캔 원본이 없는 계약(generated) — 템플릿 기반 렌더
      const built = await buildContractPdfById(contractId);
      if (!built) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
      return new NextResponse(Buffer.from(built.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
          "Cache-Control": "no-store",
        },
      });
    }
    const out = await getS3Client().send(
      new GetObjectCommand({ Bucket: file.bucket, Key: file.key })
    );
    const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
    if (!body) {
      return NextResponse.json({ error: "파일 본문을 읽지 못했습니다." }, { status: 500 });
    }
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
