import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { assertOwnContract } from "@/lib/payroll/sign";
import { buildContractPdfById } from "@/lib/payroll/contract-render";
import { getContractFile } from "@/lib/payroll/contracts";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인 계약서 PDF — generated 계약을 온디맨드 렌더(서명 완료 시 서명 각인 확정본). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> }
) {
  try {
    const ctx = await requireSession();
    const { contractId } = await params;
    await assertOwnContract(ctx.userId, contractId);
    const file = await getContractFile(contractId);
    if (file) {
      const out = await getS3Client().send(new GetObjectCommand({ Bucket: file.bucket, Key: file.key }));
      const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
      if (!body) return NextResponse.json({ error: "파일 본문을 읽지 못했습니다." }, { status: 500 });
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
          "Cache-Control": "no-store",
        },
      });
    }
    const built = await buildContractPdfById(contractId);
    if (!built) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(Buffer.from(built.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
