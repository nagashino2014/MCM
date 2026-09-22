import { type PgDatabase, rowsToObjects } from "@/lib/db";
import { CONTRACT_EMPLOYER, type ContractPdfInput } from "@/lib/payroll/contract-pdf";

export interface ContractRenderSnapshot {
  version: 1;
  fileName: string;
  input: ContractPdfInput;
}

function koDate(iso: unknown): string {
  if (!iso) return "";
  const value = String(iso);
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : value;
}

function fmt(value: unknown): string {
  return value == null ? "" : Math.round(Number(value)).toLocaleString("ko-KR");
}

/** 서명 호출자는 계약 행을 잠근 같은 트랜잭션을 전달한다. */
export async function captureContractRenderSnapshot(
  db: PgDatabase,
  contract: Record<string, unknown>,
  signatures: Record<string, string> = {},
  lockSources = false
): Promise<ContractRenderSnapshot> {
  const profile = rowsToObjects(await db.exec(
    `SELECT name, birth_date, mobile_phone, address, hired_at FROM employee_profiles
      WHERE employee_id = $1${lockSources ? " FOR SHARE" : ""}`,
    [contract.employee_id]
  ))[0];
  if (!profile) throw Object.assign(new Error("직원 정보를 찾을 수 없습니다."), { status: 404 });
  const template = rowsToObjects(await db.exec(
    `SELECT title, body FROM labor_contract_templates WHERE kind = 'regular' AND version = $1${lockSources ? " FOR SHARE" : ""}`,
    [Number(contract.template_version ?? 1)]
  ))[0];
  if (!template) throw new Error("조문 템플릿이 없습니다(159 마이그레이션 적용 필요).");

  const tokens: Record<string, string> = {
    name: String(profile.name ?? ""),
    firstHiredAt: String(contract.first_hired_at ?? profile.hired_at ?? ""),
    effectiveFromKo: koDate(contract.effective_from),
    effectiveToKo: koDate(contract.effective_to),
    duty: String(contract.duty ?? ""),
    position: String(contract.position_name ?? ""),
    probationPct: "90",
    annualSalary: fmt(contract.annual_salary),
    monthlySalary: fmt(contract.monthly_salary),
    workHours: (contract.work_hours as { summary?: string } | null)?.summary ??
      "시업 09:00 ~ 종업 18:00 (휴게시간은 식사시간을 포함하여 1.0시간으로 하며, 12:00 ~ 13:00 을 기본으로 한다)",
  };
  const articles = (template.body as ContractPdfInput["articles"]).map((a) => ({
    article: a.article,
    clauses: a.clauses.map((cl) => cl === "@WAGE_TABLE@" ? cl : cl.replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? "")),
  }));
  return {
    version: 1,
    fileName: `${profile.name} 근로계약서(${contract.contract_date ?? ""})${signatures.main ? "_서명본" : ""}.pdf`,
    input: {
      title: String(template.title ?? "연 봉 근 로 계 약 서"),
      employer: { ...CONTRACT_EMPLOYER },
      employee: {
        name: String(profile.name ?? ""),
        birthDate: profile.birth_date ? String(profile.birth_date) : null,
        phone: profile.mobile_phone ? String(profile.mobile_phone) : null,
        address: profile.address ? String(profile.address) : null,
      },
      articles,
      wageRows: Object.entries((contract.wage_components ?? {}) as Record<string, number>).filter(([, v]) => Number(v) > 0),
      monthlySalary: contract.monthly_salary == null ? null : Number(contract.monthly_salary),
      contractDateKo: koDate(contract.contract_date),
      signatures: Object.keys(signatures).length ? { ...signatures } : null,
    },
  };
}
