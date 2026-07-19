import { PDFDocument } from "pdf-lib";
import { getEmployeeDetail, type EmployeeDetail } from "@/lib/admin/employee-records";
import { readStorageObject } from "@/lib/contracts/document-bundle";

/*
 * 입찰 증빙서류 패키지 P3-2 — 수행인력 인력별 첨부 병합.
 * 인력별 배치 규칙(확정, docs/bid-package-blueprint.md §1-4):
 *   ① 엔지니어링 기술자 경력확인서(기타 증빙 탭 '기술자 경력확인서' 업로드본, 있으면 맨 앞)
 *   ② 졸업증명서 — 학위 행별 연결 문서, 박사 → 석사 → 학사 순
 *   ③ 자격증 사본 — 자격증 행별 연결 문서, 기술사(대기관리→수질관리) → 기사(지정 순) 순
 * PDF 는 페이지 병합, 이미지는 A4 페이지에 맞춰 삽입. 문서 없는 항목은 건너뛰고 경고.
 */

const CERT_ORDER = [
  "대기관리기술사",
  "수질관리기술사",
  "대기환경기사",
  "수질환경기사",
  "온실가스관리기사",
  "폐기물처리기사",
  "화공기사",
  "토양환경기사",
  "소음진동기사",
];

const DEGREE_CODE_ORDER = ["doctor", "master", "bachelor"];

const A4 = { w: 595.28, h: 841.89 };

interface DocRef {
  label: string;
  storageKey: string;
  contentType: string | null;
  fileName: string;
}

function certOrderIndex(name: string): number {
  const idx = CERT_ORDER.findIndex((c) => name.includes(c) || c.includes(name));
  return idx === -1 ? CERT_ORDER.length : idx;
}

/** 인력 1명의 첨부 문서 목록(배치 순서대로). */
function collectPersonDocs(detail: EmployeeDetail, warnings: string[]): DocRef[] {
  const docs: DocRef[] = [];
  const push = (label: string, row?: { storageKey: string; contentType: string | null; originalFilename: string | null; displayName: string }) => {
    if (!row) {
      warnings.push(`${detail.name}: ${label} 문서 없음`);
      return;
    }
    docs.push({ label, storageKey: row.storageKey, contentType: row.contentType, fileName: row.originalFilename || row.displayName });
  };

  // ① 기술자 경력확인서(협회 발급본 첨부) — 최신 1건
  const career = detail.documents.find((d) => d.documentType === "기술자 경력확인서");
  if (career) push("기술자 경력확인서", career);

  // ② 졸업증명서 — 박사 → 석사 → 학사
  const educations = [...detail.educations].sort(
    (a, b) => DEGREE_CODE_ORDER.indexOf(String(a.degreeLevel)) - DEGREE_CODE_ORDER.indexOf(String(b.degreeLevel))
  );
  for (const e of educations) {
    const doc = detail.documents.find((d) => d.targetTable === "employee_educations" && d.targetId === e.educationId);
    push(`졸업증명서(${e.schoolName})`, doc);
  }

  // ③ 자격증 사본 — 지정 순서
  const certs = [...detail.certifications].sort(
    (a, b) => certOrderIndex(String(a.certificationName)) - certOrderIndex(String(b.certificationName))
  );
  for (const c of certs) {
    const doc = detail.documents.find((d) => d.targetTable === "employee_certifications" && d.targetId === c.certificationId);
    push(`자격증 사본(${c.certificationName})`, doc);
  }
  return docs;
}

async function appendDoc(merged: PDFDocument, ref: DocRef, warnings: string[]): Promise<void> {
  let bytes: Uint8Array;
  try {
    bytes = await readStorageObject(ref.storageKey);
  } catch {
    warnings.push(`${ref.label}: 파일을 읽지 못함(${ref.fileName})`);
    return;
  }
  const type = (ref.contentType ?? "").toLowerCase();
  const name = ref.fileName.toLowerCase();
  try {
    if (type.includes("pdf") || name.endsWith(".pdf")) {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) merged.addPage(page);
      return;
    }
    // 이미지(jpg/png) — A4 페이지에 비율 유지로 배치
    const image = type.includes("png") || name.endsWith(".png")
      ? await merged.embedPng(bytes)
      : await merged.embedJpg(bytes);
    const margin = 40;
    const maxW = A4.w - margin * 2;
    const maxH = A4.h - margin * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    const page = merged.addPage([A4.w, A4.h]);
    page.drawImage(image, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  } catch {
    warnings.push(`${ref.label}: 병합 실패(${ref.fileName}) — PDF/JPG/PNG 만 지원`);
  }
}

export interface PersonAttachment {
  employeeId: string;
  name: string;
  pdf: Uint8Array;
  docCount: number;
}

/** 확정 인력별 첨부 병합 PDF 생성(문서 없는 인력은 제외 + 경고). */
export async function buildPersonAttachments(
  employeeIds: string[],
  warnings: string[]
): Promise<PersonAttachment[]> {
  const out: PersonAttachment[] = [];
  for (const employeeId of employeeIds) {
    const detail = await getEmployeeDetail(employeeId);
    if (!detail) continue;
    const docs = collectPersonDocs(detail, warnings);
    if (docs.length === 0) {
      warnings.push(`${detail.name}: 첨부할 증빙 문서가 없어 제외`);
      continue;
    }
    const merged = await PDFDocument.create();
    for (const ref of docs) await appendDoc(merged, ref, warnings);
    if (merged.getPageCount() === 0) {
      warnings.push(`${detail.name}: 병합 가능한 문서가 없어 제외`);
      continue;
    }
    out.push({ employeeId, name: detail.name, pdf: await merged.save(), docCount: docs.length });
  }
  return out;
}
