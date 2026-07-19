import type { PackageData } from "@/lib/bid/package-data";

/*
 * form_profile 필드 키 → 값 리졸버(P3). docType×field 조합으로 단일 값·반복 행 값을 만든다.
 * null 반환 = 값 미제공(원본 유지 — 발주처 평가란(score)·custom 항목 등).
 */

export interface ResolvedValue {
  value: string;
  /** 셀 전체 교체가 아니라 셀 내 『…』 구간만 치환(동의서·서약서 본문 용역명). */
  mode?: "quoted";
  /** 서약서류 ': 값' 기입형 셀 — ': ' 접두 유지. */
  prefixColon?: boolean;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * 공고명 → 용역명 정제: '…용역'까지만 남기고 뒤의 '견적제출 안내공고' 등 공고성 꼬리를 제거.
 * '용역' 표기가 없으면 원문 유지. (동의서·서약서 본문 『용역명』 치환 공용)
 */
export function cleanServiceTitle(title: string): string {
  const t = s(title);
  const m = t.match(/^(.*?용역)(?:\s|$)/);
  return m ? m[1] : t;
}

/** 회사명 축약 표기: '주식회사 X' → '㈜X', '(주)X' → '㈜X' (서약서 등 좁은 셀 줄바꿈 방지). */
export function abbrevCompanyName(name: string): string {
  return s(name)
    .replace(/^주식회사\s*/, "㈜")
    .replace(/\(\s*주\s*\)\s*/g, "㈜")
    .replace(/^유한회사\s*/, "㈲");
}

function ymText(value: string): string {
  const m = value.match(/(\d{4})\D?(\d{1,2})/);
  return m ? `${m[1]} 년 ${Number(m[2])} 월` : value;
}

function yearsBetweenText(fromYm: string): string {
  const m = fromYm.match(/(\d{4})\D?(\d{1,2})/);
  if (!m) return "";
  const now = new Date();
  const months = (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]));
  if (months < 0) return "";
  return `${ymText(fromYm)} ～ ${now.getFullYear()} 년 ${now.getMonth() + 1} 월 ( ${Math.floor(months / 12)} 년 ${months % 12} 개월)`;
}

function dotDate(value: string): string {
  const m = value.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  return m ? `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}.` : value;
}

function ageOf(birth: string): string {
  const m = birth.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!m) return "";
  const now = new Date();
  let age = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) age -= 1;
  return String(age);
}

function monthsToYearMonth(months: string): string {
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${Math.floor(n / 12)}년 ${n % 12}개월`;
}

export function personCount(data: PackageData): number {
  return data.persons.length;
}

/** 단일 필드 값. personIndex 는 인당 문서(staff_career)에서 사용. */
export function resolveSingleValue(
  docType: string,
  field: string,
  data: PackageData,
  personIndex: number | null
): ResolvedValue | null {
  if (field === "score" || field.startsWith("custom:")) return null;
  const { profile, staff, history, credentials } = data.company;
  const lead = data.persons[0] ?? null;
  const person = personIndex != null ? data.persons[personIndex] ?? null : null;

  if (docType === "company_profile") {
    switch (field) {
      case "companyName": return { value: profile.companyName };
      case "ceoName": return { value: profile.ceoName };
      case "bizRegNo": return { value: profile.bizRegNo };
      case "bizField": return { value: profile.bizField };
      case "address": return { value: profile.address };
      case "phone": return { value: profile.phone };
      case "fax": return { value: profile.fax };
      case "foundedYm": return { value: ymText(profile.foundedYm) };
      case "industryYears": return { value: yearsBetweenText(profile.foundedYm) };
      case "licenseList":
        return {
          value: credentials
            .filter((c) => c.kind === "license")
            .map((c) => `${c.name}${c.credentialNo ? ` (${c.credentialNo})` : ""}`)
            .join("\n"),
        };
      case "staffComposition": {
        const parts = staff.rows.map((r) => `${r.grade} ${r.count}`);
        return { value: `계 ${staff.total} (${parts.join(", ")})` };
      }
      case "financeSummary": {
        const latest = [...profile.finance].sort((a, b) => b.year.localeCompare(a.year))[0];
        if (!latest) return { value: "" };
        const fmt = (v: string) => (v ? Number(v).toLocaleString("ko-KR") : "");
        return { value: `자본금 : ${fmt(latest.capital)}   매출액 : ${fmt(latest.revenue)}   (${latest.year}년, 원)` };
      }
      case "historyList":
        return {
          value: history
            .map((h) => `${h.eventYm.replace("-", ". ")}.   ${h.content}`)
            .join("\n"),
        };
      case "mainBusiness": return { value: profile.mainBusiness };
    }
    return null;
  }

  if (docType === "credit_rating") {
    // 신용평가 등급 페이지는 등급서 스캔 이미지를 그대로 두는 서식 — 텍스트 주입하지 않는다
    // (등급 표시부 이미지 삽입은 후속 구현 예정, docs/bid-package-blueprint.md).
    return null;
  }

  if (docType === "performance_summary") {
    switch (field) {
      case "companyName": return { value: `ㅇ 제안 업체명 : ${profile.companyName}` };
      case "totalAmount": return { value: data.totalAmountMillion };
    }
    return null;
  }

  if (docType === "staff_career") {
    const p = person ?? lead;
    if (!p) return null;
    switch (field) {
      case "name": return { value: p.name };
      case "company": return { value: profile.companyName };
      case "engGrade": return { value: p.engGrade };
      case "position": return { value: p.positionName };
      case "birthDate": return { value: dotDate(p.birthDate) };
      case "age": return { value: ageOf(p.birthDate) };
      case "tenure": return { value: p.tenureText };
      case "education": return { value: p.educationText };
      case "licenses": return { value: p.licensesText };
      case "careerTotal": return { value: monthsToYearMonth(p.careerMonthsTotal) };
      case "assignedRole": return null; // 본 사업 참여임무 — 수기
    }
    return null;
  }

  if (docType === "privacy_consent") {
    switch (field) {
      case "serviceName": return { value: cleanServiceTitle(data.bid.title), mode: "quoted" };
      case "signerName": return null; // 본문 내 서명란 — 셀 교체 시 본문이 훼손되므로 원본 유지(수기)
    }
    return null;
  }

  if (docType === "security_pledge") {
    const now = new Date();
    switch (field) {
      case "pledgeDate": return { value: `${now.getFullYear()} 년 ${now.getMonth() + 1} 월 ${now.getDate()} 일` };
      case "serviceName": return { value: cleanServiceTitle(data.bid.title), mode: "quoted" };
      case "companyName": return { value: abbrevCompanyName(profile.companyName), prefixColon: true };
      case "position": return lead ? { value: lead.positionName, prefixColon: true } : null;
      case "name": return lead ? { value: lead.name, prefixColon: true } : null;
      case "birthDate": return lead ? { value: dotDate(lead.birthDate), prefixColon: true } : null;
      case "issuerOrg": return { value: data.bid.orgName, prefixColon: true };
    }
    return null;
  }

  return null;
}

/** 반복 행 값 목록. 각 행은 field 키 → 표시 문자열. */
export function resolveRepeatRows(
  docType: string,
  data: PackageData,
  personIndex: number | null
): Record<string, string>[] {
  if (docType === "performance_summary") {
    return data.contracts.map((c, i) => ({
      no: String(i + 1),
      year: c.year ? `${c.year.slice(2)}년` : "",
      category: c.category,
      serviceName: c.serviceName,
      overview: c.overview,
      amount: c.amountMillion,
      period: c.periodText,
      staffCount: c.staffCountText,
      clientName: c.clientName,
      clientPhone: c.clientPhone,
      score: "",
    }));
  }
  if (docType === "staff_summary") {
    return data.persons.map((p) => ({
      role: "",
      name: p.name,
      grade: p.envGrade || p.engGrade,
      degree: p.degreeTop,
      careerMonthsTotal: p.careerMonthsTotal,
      careerMonthsCompany: p.careerMonthsCompany,
      perfCount: p.perfCount,
      participateMonths: "",
      score: "",
    }));
  }
  if (docType === "staff_career") {
    const p = personIndex != null ? data.persons[personIndex] : data.persons[0];
    if (!p) return [];
    return p.projects.map((pr) => ({
      client: pr.client,
      projectName: pr.projectName,
      task: pr.task,
      amount: pr.amountEok,
      period: pr.periodText,
      thenCompany: pr.thenCompany,
      thenPosition: p.positionName,
    }));
  }
  return [];
}
