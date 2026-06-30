import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getCertificateData } from "@/lib/contracts/certificate";
import { fillHwpx, buildCertTokens, buildRosterTokens } from "@/lib/contracts/hwpx";
import { saveCertificateDoc } from "@/lib/contracts/certificate-storage";
import { getContractRoster } from "@/lib/staffing/roster";
import { binaryResponse, sanitizeDownloadName } from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HWPX_MIME = "application/octet-stream";

interface CertRequestBody {
  contractIds?: string[];
  option?: 1 | 2 | 3; // 1=증명서만, 2=증명서+명단, 3=명단만
  submittedTo?: string;
  purpose?: string;
  contactByContract?: Record<string, string>;
}

// 증명서(+명단) HWPX 생성 → 계약별 S3 저장 + 다운로드
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("certificate.issue", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as CertRequestBody;
    const contractIds = [...new Set((body.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    const option = body.option === 2 ? 2 : body.option === 3 ? 3 : 1;
    const submittedTo = String(body.submittedTo ?? "");
    const purpose = String(body.purpose ?? "");
    const contactByContract = body.contactByContract ?? {};

    if (contractIds.length === 0) {
      return NextResponse.json({ error: "증명서를 생성할 계약을 선택하세요." }, { status: 400 });
    }
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 생성할 수 있습니다." }, { status: 400 });
    }

    const results: { title: string; files: { name: string; bytes: Uint8Array }[] }[] = [];
    let skipped = 0;

    for (const contractId of contractIds) {
      // 명단만 생성(option 3) — 증명서 없이 수행인력 명단 hwpx만 생성
      if (option === 3) {
        const roster = await getContractRoster(contractId);
        if (!roster) {
          skipped += 1;
          continue;
        }
        const title = roster.serviceName || contractId;
        const rosterName = `수행인력명단(${title}).hwpx`;
        const rosterBytes = await fillHwpx("roster.hwpx", buildRosterTokens(roster));
        await saveCertificateDoc({
          contractId,
          actorUserId: actor.userId,
          documentType: "roster_hwpx",
          fileName: rosterName,
          bytes: rosterBytes,
          contentType: HWPX_MIME,
        });
        results.push({ title, files: [{ name: rosterName, bytes: rosterBytes }] });
        continue;
      }

      const data = await getCertificateData(contractId, {
        submittedTo,
        purpose,
        contactPersonId: contactByContract[contractId],
      });
      if (!data) {
        skipped += 1;
        continue;
      }
      const title = data.serviceName || contractId;
      const certName = `용역수행실적증명서(${title}).hwpx`;
      const certBytes = await fillHwpx("certificate.hwpx", buildCertTokens(data));
      await saveCertificateDoc({
        contractId,
        actorUserId: actor.userId,
        documentType: "certificate_hwpx",
        fileName: certName,
        bytes: certBytes,
        contentType: HWPX_MIME,
      });
      const files: { name: string; bytes: Uint8Array }[] = [{ name: certName, bytes: certBytes }];

      if (option === 2) {
        const roster = await getContractRoster(contractId);
        if (roster) {
          const rosterName = `수행인력명단(${title}).hwpx`;
          const rosterBytes = await fillHwpx("roster.hwpx", buildRosterTokens(roster));
          await saveCertificateDoc({
            contractId,
            actorUserId: actor.userId,
            documentType: "roster_hwpx",
            fileName: rosterName,
            bytes: rosterBytes,
            contentType: HWPX_MIME,
          });
          files.push({ name: rosterName, bytes: rosterBytes });
        }
      }
      results.push({ title, files });
    }

    if (results.length === 0) {
      return NextResponse.json(
        {
          error:
            option === 3
              ? "선택한 계약 중 수행인력 명단을 만들 수 있는 계약이 없습니다."
              : "선택한 계약 중 통합허가 용역이 없어 증명서를 생성할 수 없습니다.",
        },
        { status: 400 }
      );
    }

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "contract_documents",
      targetId: contractIds[0],
      after: { kind: "certificate_hwpx", option, count: results.length, skipped },
    });

    // 1계약·1파일 → 단일 hwpx, 그 외 → zip
    const allFiles = results.flatMap((r) => r.files);
    if (results.length === 1 && allFiles.length === 1) {
      return binaryResponse(allFiles[0].bytes, HWPX_MIME, allFiles[0].name);
    }
    const zip = new JSZip();
    const multi = results.length > 1;
    for (const r of results) {
      const folder = multi ? zip.folder(sanitizeDownloadName(r.title)) : zip;
      for (const f of r.files) folder?.file(sanitizeDownloadName(f.name), f.bytes);
    }
    const zipped = await zip.generateAsync({ type: "uint8array" });
    return binaryResponse(zipped, "application/zip", `용역수행실적증명서_${new Date().toISOString().slice(0, 10)}.zip`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
