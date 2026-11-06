/**
 * 아마란스10 연락처 내보내기(.xlsx) 파서 — 서버 전용.
 * 머리글이 2줄이다: 1행은 필드 키(companyName0 등, 일부는 묶음 이름), 2행은 한글 이름.
 * 같은 한글 이름이 두 번 나오므로 1행 키로 읽고, 키가 묶음 이름인 칸은 2행으로 찾는다.
 */
import * as XLSX from "xlsx";
import { formatPhone, isMobile } from "@scraper/lib/contact-import/rules";
import { normalizeHomepage } from "@/lib/sales/business-card-parser";

export interface ImportedContact {
  personName: string;
  title: string | null;
  department: string | null;
  companyName: string;
  mobilePhone: string | null;
  officePhone: string | null;
  faxNumber: string | null;
  email: string | null;
  address: string | null;
  homepage: string | null;
}

export interface ParsedContactFile {
  contacts: ImportedContact[];
  /** 파일의 연락처 줄 수(이름 없는 줄 포함). */
  totalRows: number;
  /** 이름이나 회사명이 없어 건너뛴 줄 수. */
  skippedRows: number;
}

const text = (value: unknown): string | null => {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s || null;
};

export function parseAmaranthContacts(buffer: Buffer): ParsedContactFile {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("엑셀에 시트가 없습니다.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null });
  const keys = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const labels = (rows[1] ?? []).map((c) => String(c ?? "").trim());
  const byKey = (key: string) => keys.indexOf(key);
  const byLabel = (label: string) => labels.indexOf(label);
  const nameAt = byKey("name");
  const companyAt = byKey("companyName0");
  const phoneAt = byKey("phone0");
  if (nameAt < 0 || companyAt < 0 || phoneAt < 0 || labels[companyAt] !== "회사명") {
    throw new Error("아마란스10 연락처 내보내기 파일이 아닙니다. 연락처 화면의 ‘엑셀 다운로드’로 받은 파일을 올려 주세요.");
  }
  const emailAt = byKey("email0");
  const divisionAt = byKey("divisionName0");
  const rankAt = byKey("rank0");
  const positionAt = byKey("position0");
  const addressAt = byKey("address0");
  const homepageAt = byKey("homepage0");
  const officeAt = byLabel("추가회사번호1");
  const faxAt = byLabel("추가팩스번호1");
  const compFaxAt = byKey("compFax0");
  const at = (row: unknown[], index: number) => (index >= 0 ? text(row[index]) : null);

  const contacts: ImportedContact[] = [];
  const data = rows.slice(2);
  let skippedRows = 0;
  for (const row of data) {
    const personName = at(row, nameAt);
    const companyName = at(row, companyAt);
    if (!personName || !companyName) {
      skippedRows += 1;
      continue;
    }
    // 휴대전화 칸에 유선 번호를 적은 연락처가 있다(실측 922건 중 71건) — 유선 칸으로 옮긴다.
    const phone = formatPhone(at(row, phoneAt));
    const office = formatPhone(at(row, officeAt));
    contacts.push({
      personName,
      companyName,
      title: at(row, rankAt) ?? at(row, positionAt),
      department: at(row, divisionAt),
      mobilePhone: isMobile(phone) ? phone : null,
      officePhone: office ?? (isMobile(phone) ? null : phone),
      faxNumber: formatPhone(at(row, faxAt) ?? at(row, compFaxAt)),
      email: at(row, emailAt)?.toLowerCase() ?? null,
      address: at(row, addressAt),
      homepage: normalizeHomepage(at(row, homepageAt)),
    });
  }
  return { contacts, totalRows: data.length, skippedRows };
}
