import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { getEmployeeDetail } from "@/lib/admin/employee-records";
import { convertHwpxToPdf } from "@/lib/agreement/convert";
import { getCompanyProfile } from "@/lib/company/profile";
import { listSignedCertificates } from "@/lib/contracts/certificate-storage";
import { loadBundles, readStorageObject, sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { getContractRoster } from "@/lib/staffing/roster";
import { renderRosterPdf } from "@/lib/staffing/roster-pdf";
import { fillRecordHistoryHwpx, type RecordHwpxData } from "@/lib/staffing/record-hwpx";
import { renderRecordHistoryPdf, type RecordHistoryData } from "@/lib/staffing/record-pdf";
import type { StaffRecordDetail, StaffRecordRow } from "@/lib/staffing/records";

/*
 * 수행인력 실적 증빙 묶음 — 선택한 용역만 대상으로
 *   ① 수행인력 개별 이력사항(인력 1부) — 회사 표준 HWPX 양식을 채운 뒤 converter 로 PDF 변환.
 *      변환기를 쓸 수 없으면 pdf-lib 자체 양식으로 대체하고 그 사실을 집계에 남긴다.
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
  /** 이력사항을 표준 HWPX 양식으로 변환하지 못해 자체 PDF 양식으로 대체했는가 */
  historyFallback: boolean;
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

/** 'YYYY-MM-DD' → ‘YY.MM. (양식의 학력 연도 표기) */
function shortYm(ymd: string | null | undefined): string {
  const m = /(\d{4})\D?(\d{1,2})/.exec(String(ymd ?? ""));
  return m ? `‘${m[1].slice(2)}.${m[2].padStart(2, "0")}.` : "";
}

function monthsBetween(from: string | null | undefined, to: string | null | undefined): number {
  const f = /(\d{4})\D?(\d{1,2})/.exec(String(from ?? ""));
  const t = /(\d{4})\D?(\d{1,2})/.exec(String(to ?? ""));
  if (!f || !t) return 0;
  return Math.max(0, (Number(t[1]) - Number(f[1])) * 12 + (Number(t[2]) - Number(f[2])));
}

/** 회사명 표기를 양식과 맞춘다: '(주)' → '㈜'. */
const companyMark = (name: string): string => name.replace(/\(\s*주\s*\)/g, "㈜").replace(/주식회사\s*/g, "㈜");

/**
 * 표준 HWPX 양식 데이터. 해당분야 근무경력 = 타사 경력 + 자사 재직(입찰 서류의 관련분야 경력과 같은 산식).
 * 경력 표 제목은 양식 문구(통합환경허가 취득용역)를 쓰되, 다른 종류 용역이 섞이면 '용역 수행실적'으로 바꾼다.
 */
export async function buildRecordHwpxData(detail: StaffRecordDetail, rows: StaffRecordRow[]): Promise<RecordHwpxData> {
  const [employee, company] = await Promise.all([getEmployeeDetail(detail.profile.employeeId), getCompanyProfile()]);
  const p = detail.profile;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  let careerMonths = p.tenureMonths ?? 0;
  for (const c of employee?.careers ?? []) careerMonths += monthsBetween(c.workedFrom, c.workedTo || today);
  const years = Math.floor(careerMonths / 12);
  const rest = careerMonths % 12;
  return {
    name: p.name,
    position: p.positionName,
    affiliation: [companyMark(company.companyName), p.deptName].filter(Boolean).join("  "),
    address: company.address,
    educations: (employee?.educations ?? []).map((e) => ({
      years: [shortYm(e.admissionDate), shortYm(e.graduationDate)].some(Boolean)
        ? `${shortYm(e.admissionDate)}∼${shortYm(e.graduationDate)}`
        : "",
      school: e.schoolName ?? "",
      major: e.major ?? "",
      degree: e.degreeName || DEGREE_LABELS[String(e.degreeLevel)] || "",
    })),
    career: careerMonths > 0 ? (rest ? `${years}년 ${rest}개월` : `${years}년`) : "",
    licenses: (employee?.certifications ?? []).map((c) => c.certificationName).filter(Boolean),
    projectScope: rows.every((r) => r.category === "통합허가") ? "통합환경허가 취득용역" : "용역 수행실적",
    projects: rows.map((r) => ({
      name: r.contractTitle,
      from: r.periodFrom ? `${dot(r.periodFrom)}.` : "",
      to: r.periodFrom ? (r.ongoing ? "용역수행중" : `${dot(r.periodTo)}.`) : "",
      task: r.taskLabel || r.roleLabel,
      client: companyMark(r.clientName),
      note: "",
    })),
  };
}

/** 자체 PDF 양식(변환기 폴백) 데이터 — 인적사항은 인사카드, 참여당시 소속·직위는 자사·현 직위(입찰 서류와 동일 규칙). */
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
    historyFallback: false,
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

  let history: Uint8Array | null = null;
  if (include.history) {
    const hwpx = await fillRecordHistoryHwpx(await buildRecordHwpxData(detail, rows));
    history = await convertHwpxToPdf(hwpx, `수행인력 개별 이력사항(${detail.profile.name}).hwpx`);
    if (!history) {
      summary.historyFallback = true;
      history = await renderRecordHistoryPdf(await buildRecordHistoryData(detail, rows));
    }
  }

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
