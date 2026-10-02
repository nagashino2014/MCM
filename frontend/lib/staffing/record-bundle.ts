import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { getEmployeeDetail } from "@/lib/admin/employee-records";
import { getCompanyProfile } from "@/lib/company/profile";
import { listSignedCertificates } from "@/lib/contracts/certificate-storage";
import { loadBundles, readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { getContractRoster } from "@/lib/staffing/roster";
import { renderRosterPdf } from "@/lib/staffing/roster-pdf";
import { renderRecordHistoryPdf, type RecordHistoryData } from "@/lib/staffing/record-pdf";
import type { StaffRecordDetail, StaffRecordRow } from "@/lib/staffing/records";

/*
 * 수행인력 실적 증빙 묶음 — 선택한 용역만 대상으로
 *   ① 수행인력 개별 이력사항(인력 1부)
 *   ② 계약별 [계약서(+변경계약서) + 세금계산서]
 *   ③ 계약별 [용역수행 실적증명서(직인 날인본) + 수행인력 명단]
 * 을 옵션대로 만들고, 일괄 병합 / 계약 건별 1파일 / 항목별 분리(계약 건별 폴더)로 내보낸다.
 * 실적증명서는 날인본 PDF 가 첨부된 계약만 들어간다(없으면 명단으로 대체 — 2026-10-02 사용자 확정).
 */

export interface RecordBundleInclude {
  history: boolean;
  contract: boolean;
  invoice: boolean;
  certificate: boolean;
  roster: boolean;
}

/** merged=전부 1개 PDF / perContract=계약 건별 1개 PDF(zip) / split=항목별 분리·계약 건별 폴더(zip) */
export type RecordBundlePackaging = "merged" | "perContract" | "split";

export interface RecordBundleSummary {
  contracts: number;
  missingContractDoc: number;
  missingInvoice: number;
  missingCertificate: number;
  missingRoster: number;
  unreadable: number;
}

export interface RecordBundleResult {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  summary: RecordBundleSummary;
}

const DEGREE_LABELS: Record<string, string> = { bachelor: "학사", master: "석사", doctor: "박사" };
const dot = (ymd: string | null | undefined): string => (ymd ? String(ymd).slice(0, 10).replace(/-/g, ".") : "");

function periodText(row: StaffRecordRow): string {
  if (!row.periodFrom) return "";
  return `${dot(row.periodFrom)} ~ ${row.ongoing ? "진행중" : dot(row.periodTo)}`;
}

function tenureText(months: number | null): string {
  if (months == null) return "";
  return `${Math.floor(months / 12)}년 ${months % 12}개월`;
}

/** 이력사항 PDF 데이터 — 인적사항은 인사카드, 참여당시 소속·직위는 자사·현 직위(입찰 서류와 동일 규칙). */
export async function buildRecordHistoryData(detail: StaffRecordDetail, rows: StaffRecordRow[]): Promise<RecordHistoryData> {
  const [employee, company] = await Promise.all([getEmployeeDetail(detail.profile.employeeId), getCompanyProfile()]);
  const p = detail.profile;
  const hired = dot(p.hiredAt);
  return {
    name: p.name,
    company: [company.companyName, p.deptName].filter(Boolean).join(" "),
    position: p.positionName,
    engGrade: employee?.engGrade ?? "",
    birthDate: dot(employee?.birthDate),
    tenure: hired ? `${hired} ~ ${p.resignedAt ? dot(p.resignedAt) : "현재"} (${tenureText(p.tenureMonths)})` : "",
    education: (employee?.educations ?? []).map((e) => {
      const year = String(e.graduationDate ?? "").slice(0, 4);
      return [e.schoolName, e.major, DEGREE_LABELS[String(e.degreeLevel)] ?? String(e.degreeLevel ?? ""), year ? `(${year})` : ""]
        .filter(Boolean)
        .join(" ");
    }),
    licenses: (employee?.certifications ?? []).map((c) => {
      const d = dot(c.passedAt || c.issuedAt);
      return `${c.certificationName}${d ? ` (${d})` : ""}`;
    }),
    projects: rows.map((r) => ({
      client: r.clientName,
      projectName: r.contractTitle,
      task: r.taskLabel || r.roleLabel,
      amountEok: r.amount ? String(Math.round((r.amount / 100_000_000) * 100) / 100) : "",
      period: periodText(r),
      thenCompany: company.companyName,
      thenPosition: p.positionName,
    })),
  };
}

/** 읽을 수 없는 조각(암호화·손상 PDF, 비 PDF 첨부)은 건너뛰고 개수만 센다 — 한 건 때문에 전체가 실패하지 않게. */
async function mergeParts(parts: Uint8Array[], onUnreadable: () => void): Promise<Uint8Array | null> {
  const merged = await PDFDocument.create();
  for (const part of parts) {
    try {
      const source = await PDFDocument.load(part, { ignoreEncryption: true });
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch {
      onUnreadable();
    }
  }
  return merged.getPageCount() > 0 ? merged.save() : null;
}

export async function buildRecordBundle(params: {
  detail: StaffRecordDetail;
  contractIds: string[];
  include: RecordBundleInclude;
  packaging: RecordBundlePackaging;
}): Promise<RecordBundleResult> {
  const { detail, include, packaging } = params;
  const picked = new Set(params.contractIds);
  // 화면 리스트와 같은 순서(수행 시작일 오름차순)로 묶는다
  const rows = detail.rows.filter((r) => picked.has(r.contractId));
  if (rows.length === 0) throw Object.assign(new Error("증빙으로 내보낼 용역을 선택하세요."), { status: 400 });

  const summary: RecordBundleSummary = {
    contracts: rows.length,
    missingContractDoc: 0,
    missingInvoice: 0,
    missingCertificate: 0,
    missingRoster: 0,
    unreadable: 0,
  };
  const onUnreadable = () => {
    summary.unreadable += 1;
  };
  const ids = rows.map((r) => r.contractId);
  const wantDocs = include.contract || include.invoice;
  const [bundles, signed] = await Promise.all([
    wantDocs ? loadBundles(ids, { kind: "all" }) : Promise.resolve([]),
    include.certificate ? listSignedCertificates(ids) : Promise.resolve({} as Awaited<ReturnType<typeof listSignedCertificates>>),
  ]);

  const history = include.history
    ? await renderRecordHistoryPdf(await buildRecordHistoryData(detail, rows))
    : null;

  const perContract: { title: string; docs: Uint8Array | null; proof: Uint8Array | null }[] = [];
  for (const row of rows) {
    const docParts: Uint8Array[] = [];
    if (wantDocs) {
      const files = bundles.find((b) => b.contractId === row.contractId)?.files ?? [];
      const contractFiles = files.filter((f) => f.documentType !== "invoice");
      const invoiceFiles = files.filter((f) => f.documentType === "invoice");
      if (include.contract && contractFiles.length === 0) summary.missingContractDoc += 1;
      if (include.invoice && invoiceFiles.length === 0) summary.missingInvoice += 1;
      for (const file of [...(include.contract ? contractFiles : []), ...(include.invoice ? invoiceFiles : [])]) {
        try {
          docParts.push(await readStorageObject(file.storageKey));
        } catch {
          onUnreadable();
        }
      }
    }

    const proofParts: Uint8Array[] = [];
    if (include.certificate) {
      const cert = signed[row.contractId];
      if (cert?.storageKey) {
        try {
          proofParts.push(await readStorageObject(cert.storageKey));
        } catch {
          onUnreadable();
        }
      } else {
        summary.missingCertificate += 1;
      }
    }
    if (include.roster) {
      const roster = await getContractRoster(row.contractId);
      if (roster && roster.rows.length > 0) proofParts.push(await renderRosterPdf(roster));
      else summary.missingRoster += 1;
    }

    perContract.push({
      title: row.contractTitle || row.contractId,
      docs: docParts.length ? await mergeParts(docParts, onUnreadable) : null,
      proof: proofParts.length ? await mergeParts(proofParts, onUnreadable) : null,
    });
  }

  const baseName = `수행실적 증빙(${detail.profile.name})`;
  const historyName = `수행인력 개별 이력사항(${detail.profile.name}).pdf`;
  const hasAny = Boolean(history) || perContract.some((c) => c.docs || c.proof);
  if (!hasAny) {
    throw Object.assign(new Error("선택한 옵션으로 만들 수 있는 서류가 없습니다. 포함 서류를 확인하세요."), { status: 400 });
  }

  if (packaging === "merged") {
    const parts: Uint8Array[] = [];
    if (history) parts.push(history);
    for (const c of perContract) {
      if (c.docs) parts.push(c.docs);
      if (c.proof) parts.push(c.proof);
    }
    const merged = await mergeParts(parts, onUnreadable);
    if (!merged) throw new Error("병합할 서류를 읽지 못했습니다.");
    return { bytes: merged, contentType: "application/pdf", fileName: `${baseName}.pdf`, summary };
  }

  const zip = new JSZip();
  if (history) zip.file(sanitizeDownloadName(historyName), history);
  const pad = String(perContract.length).length;
  for (const [i, c] of perContract.entries()) {
    const label = sanitizeDownloadName(`${String(i + 1).padStart(pad, "0")}_${c.title}`).slice(0, 120);
    if (packaging === "perContract") {
      const merged = await mergeParts([c.docs, c.proof].filter((b): b is Uint8Array => Boolean(b)), onUnreadable);
      if (merged) zip.file(`${label}.pdf`, merged);
    } else {
      if (c.docs) zip.file(`${label}/${docsFileName(include)}`, c.docs);
      if (c.proof) zip.file(`${label}/${proofFileName(include)}`, c.proof);
    }
  }
  const zipped = await zip.generateAsync({ type: "uint8array" });
  return { bytes: zipped, contentType: "application/zip", fileName: `${baseName}.zip`, summary };
}

function docsFileName(include: RecordBundleInclude): string {
  return `${[include.contract ? "계약서" : "", include.invoice ? "세금계산서" : ""].filter(Boolean).join("·")}.pdf`;
}

function proofFileName(include: RecordBundleInclude): string {
  return `${[include.certificate ? "실적증명서" : "", include.roster ? "수행인력 명단" : ""].filter(Boolean).join("·")}.pdf`;
}
