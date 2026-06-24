import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { type CertificateData } from "./certificate";
import type { ContractRoster } from "@/lib/staffing/roster";

/** 회사명 표기 정규화: '(주)' → '㈜' 등. */
function normalizeCompanySuffix(value: string): string {
  return String(value ?? "")
    .replace(/\(\s*주\s*\)/g, "㈜")
    .replace(/\(\s*유\s*\)/g, "㈲");
}

/*
 * 원본 hwpx 양식 템플릿의 {{토큰}}을 값으로 치환해 hwpx(zip) 바이트를 만든다.
 * 템플릿은 public/hwpx/ 에 있고(런타임 fs 접근), 토큰은 Contents/section0.xml 에 단일 런으로 존재.
 */

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
// 누름틀(CLICK_HERE) 필드 ctrl — 생성본에서는 제거해 일반 텍스트로 만든다(줄바꿈 정상화 + 필드 해제).
const FIELD_BEGIN_RE = /<hp:ctrl><hp:fieldBegin\b[\s\S]*?<\/hp:fieldBegin><\/hp:ctrl>/g;
const FIELD_END_RE = /<hp:ctrl><hp:fieldEnd\b[^>]*\/><\/hp:ctrl>/g;
// 캐시된 줄 레이아웃 — 제거하면 한글이 새 텍스트로 재계산(긴 값 자동 줄바꿈).
const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
// charPr 블록 (header.xml)
const CHARPR_RE = /<hh:charPr\b[^>]*>[\s\S]*?<\/hh:charPr>/g;

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 누름틀 placeholder 스타일(빨강 #FF0000 + 기울임)을 일반 텍스트(검정·비기울임)로 정규화. 글자 크기는 원본 유지. */
function normalizeHeaderXml(xml: string): string {
  return xml.replace(CHARPR_RE, (block) => {
    if (!block.includes('textColor="#FF0000"')) return block;
    return block.replace('textColor="#FF0000"', 'textColor="#000000"').replace(/<hh:italic\/>/g, "");
  });
}

const templateCache = new Map<string, Buffer>();
async function loadTemplate(file: string): Promise<Buffer> {
  const cached = templateCache.get(file);
  if (cached) return cached;
  const bytes = await readFile(path.join(process.cwd(), "public", "hwpx", file));
  templateCache.set(file, bytes);
  return bytes;
}

/**
 * 템플릿 hwpx의 {{토큰}}을 치환해 hwpx 바이트 반환.
 * 생성본은 누름틀을 해제(CLICK_HERE 필드 제거 + placeholder 빨강·기울임 스타일 정규화)해
 * 일반 텍스트로 출력되게 한다. opts.valueHeightDelta 로 값 글자 높이를 미세 조절(긴 값 대응).
 */
export async function fillHwpx(
  templateFile: string,
  tokens: Record<string, string>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await loadTemplate(templateFile));

  // 1) 본문: 누름틀 필드 제거 + 캐시 줄 레이아웃 제거(자동 줄바꿈) + 토큰 치환
  const sectionPath = "Contents/section0.xml";
  const section = zip.file(sectionPath);
  if (!section) throw new Error(`템플릿에 ${sectionPath} 가 없습니다: ${templateFile}`);
  let xml = await section.async("string");
  xml = xml.replace(FIELD_BEGIN_RE, "").replace(FIELD_END_RE, "").replace(LINESEG_RE, "");
  xml = xml.replace(TOKEN_RE, (_, key) => escapeXml(tokens[String(key).trim()] ?? ""));
  zip.file(sectionPath, xml);

  // 2) 헤더: placeholder 스타일(빨강·기울임) 정규화 (글자 크기 원본 유지)
  const headerPath = "Contents/header.xml";
  const header = zip.file(headerPath);
  if (header) {
    zip.file(headerPath, normalizeHeaderXml(await header.async("string")));
  }

  // OPC 규약상 mimetype 은 무압축 보관 (있을 때만)
  const mimetype = zip.file("mimetype");
  if (mimetype) {
    zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 증명서 토큰 맵. 발급기관(기관명·전화·주소·팩스·부서·담당자)은 발주처(통합허가 대상 사업장) 정보. */
export function buildCertTokens(data: CertificateData): Record<string, string> {
  return {
    "용역 범위": data.scopeText,
    "용역명": data.serviceName,
    "용역 개요": data.scopeText,
    "계약일자": data.contractDate,
    "계약기간": data.contractPeriod,
    "계약금액": data.amountText,
    "이행실적": data.perfText,
    "년": data.year,
    "월": data.month,
    "일": data.day,
    // 발급기관 = 발주처(사업장)
    "업체명": normalizeCompanySuffix(data.siteName),
    "전화번호": data.facilityPhone,
    "주소": data.facilityAddress,
    "팩스번호": data.issueFax,
    "담당부서": data.issueDept,
    "담당자": data.issuePerson,
    "제출처": normalizeCompanySuffix(data.submittedTo),
    "증명서용도": data.purpose,
  };
}

/** 명단 토큰 맵 (참여자 6명 cap, 관리자 우선 — roster.rows 정렬을 따른다). */
export function buildRosterTokens(roster: ContractRoster): Record<string, string> {
  const tokens: Record<string, string> = { "용역명": roster.serviceName };
  for (let i = 1; i <= 6; i++) {
    const r = roster.rows[i - 1];
    tokens[`참여자${i}`] = r?.name ?? "";
    tokens[`생년월일${i}`] = r?.birth ?? "";
    tokens[`등급${i}`] = r?.engGrade ?? "";
    tokens[`분야${i}`] = r?.specialty ?? "";
    tokens[`담당업무${i}`] = r?.task ?? "";
    tokens[`수행기간${i}`] = r?.period ?? "";
  }
  return tokens;
}
