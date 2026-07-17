import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getContractRoster } from "@/lib/staffing/roster";
import { renderRosterPdf } from "@/lib/staffing/roster-pdf";
import { getCertificateDoc, saveCertificateDoc } from "@/lib/contracts/certificate-storage";
import { deleteContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PDF_MIME = "application/pdf";

/*
 * 수행인력 명단 PDF 생성 → 계약별 S3 저장(roster_pdf). 다운로드 없음.
 * 환경부 실적보고 등 증명서 없이 명단+계약서만 제출하는 경우를 위한 저장본 —
 * '명단+계약서' 통합묶음(roster-bundle)이 이 저장본을 사용한다.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("certificate.issue", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { contractIds?: string[] };
    const contractIds = [...new Set((body.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (contractIds.length === 0) {
      return NextResponse.json({ error: "명단을 생성할 계약을 선택하세요." }, { status: 400 });
    }
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 생성할 수 있습니다." }, { status: 400 });
    }

    const saved: Record<string, { fileName: string }> = {};
    let skipped = 0;

    for (const contractId of contractIds) {
      const roster = await getContractRoster(contractId);
      if (!roster) {
        skipped += 1;
        continue;
      }
      const title = roster.serviceName || contractId;
      const fileName = `수행인력명단(${title}).pdf`;
      const bytes = await renderRosterPdf(roster);

      // 교체 전 기존 파일 키 확보(계약명 변경 등으로 키가 달라지면 S3 정리)
      const prior = await getCertificateDoc(contractId, "roster_pdf");
      const stored = await saveCertificateDoc({
        contractId,
        actorUserId: actor.userId,
        documentType: "roster_pdf",
        fileName,
        bytes,
        contentType: PDF_MIME,
      });
      if (prior?.storageKey && prior.storageKey !== stored.storageKey) {
        await deleteContractDocument(prior.storageKey);
      }
      saved[contractId] = { fileName: stored.displayName };
    }

    if (Object.keys(saved).length === 0) {
      return NextResponse.json(
        { error: "선택한 계약 중 수행인력 명단을 만들 수 있는 계약이 없습니다." },
        { status: 400 }
      );
    }

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "contract_documents",
      targetId: contractIds[0],
      after: { kind: "roster_pdf", count: Object.keys(saved).length, skipped },
    });

    return NextResponse.json({ saved, skipped });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
