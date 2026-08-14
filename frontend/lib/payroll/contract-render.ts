import { getDb, rowsToObjects } from "@/lib/db";
import { renderContractPdf } from "@/lib/payroll/contract-pdf";

/**
 * 계약 ID → 조문 템플릿 치환 → PDF 빌드 (PL-P3 §5-1)
 * - generated 계약의 열람·발송·확정본은 모두 이 온디맨드 렌더를 쓴다(서명 문자열이 DB 에 있어
 *   언제든 동일 확정본을 재현 가능 — 별도 파일 저장 없음).
 */

function koDate(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

function fmt(v: number | null): string {
  return v == null ? "" : Math.round(v).toLocaleString("ko-KR");
}

export async function buildContractPdfById(contractId: string): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.*, p.name AS emp_name, p.birth_date, p.mobile_phone, p.address, p.hired_at
         FROM labor_contracts c
         JOIN employee_profiles p ON p.employee_id = c.employee_id
        WHERE c.contract_id = $1`,
      [contractId]
    )
  );
  const c = rows[0];
  if (!c) return null;

  const tplRows = rowsToObjects(
    await db.exec(
      `SELECT title, body FROM labor_contract_templates
        WHERE kind = 'regular' AND version = $1`,
      [Number(c.template_version ?? 1)]
    )
  );
  const tpl = tplRows[0];
  if (!tpl) throw new Error("조문 템플릿이 없습니다(159 마이그레이션 적용 필요).");

  const wage = (c.wage_components ?? {}) as Record<string, number>;
  const workHoursSummary =
    (c.work_hours as { summary?: string } | null)?.summary ??
    "시업 09:00 ~ 종업 18:00 (휴게시간은 식사시간을 포함하여 1.0시간으로 하며, 12:00 ~ 13:00 을 기본으로 한다)";

  const tokens: Record<string, string> = {
    name: String(c.emp_name ?? ""),
    firstHiredAt: String(c.first_hired_at ?? c.hired_at ?? ""),
    effectiveFromKo: koDate(c.effective_from ? String(c.effective_from) : null),
    effectiveToKo: koDate(c.effective_to ? String(c.effective_to) : null),
    duty: String(c.duty ?? ""),
    position: String(c.position_name ?? ""),
    probationPct: "90",
    annualSalary: fmt(c.annual_salary == null ? null : Number(c.annual_salary)),
    monthlySalary: fmt(c.monthly_salary == null ? null : Number(c.monthly_salary)),
    workHours: workHoursSummary,
  };

  const articles = ((tpl.body ?? []) as Array<{ article: string; clauses: string[] }>).map((a) => ({
    article: a.article,
    clauses: a.clauses.map((cl) =>
      cl === "@WAGE_TABLE@" ? cl : cl.replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? "")
    ),
  }));

  const signatures = (c.signatures ?? {}) as Record<string, string>;
  const bytes = await renderContractPdf({
    title: String(tpl.title ?? "연 봉 근 로 계 약 서"),
    employee: {
      name: String(c.emp_name ?? ""),
      birthDate: c.birth_date ? String(c.birth_date) : null,
      phone: c.mobile_phone ? String(c.mobile_phone) : null,
      address: c.address ? String(c.address) : null,
    },
    articles,
    wageRows: Object.entries(wage).filter(([, v]) => Number(v) > 0) as Array<[string, number]>,
    monthlySalary: c.monthly_salary == null ? null : Number(c.monthly_salary),
    contractDateKo: koDate(c.contract_date ? String(c.contract_date) : null),
    signatures: Object.keys(signatures).length
      ? {
          main: signatures.main,
          receipt: signatures.receipt,
          overtime: signatures.overtime,
          rules: signatures.rules,
          privacy: signatures.privacy,
        }
      : null,
  });

  return {
    bytes,
    fileName: `${c.emp_name} 근로계약서(${c.contract_date ?? ""})${signatures.main ? "_서명본" : ""}.pdf`,
  };
}
