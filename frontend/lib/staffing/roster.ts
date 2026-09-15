import { getDb, rowsToObjects } from "@/lib/db";

export interface RosterRow {
  seq: number;
  name: string;
  birth: string;     // 생년월일 (YYYY.MM.DD)
  engGrade: string;  // 엔지니어링협회 기술등급
  specialty: string; // 전문분야
  task: string;      // 담당업무
  period: string;    // 수행기간 (YYYY.MM.DD ~ YYYY.MM.DD | 진행중)
}

export interface ContractRoster {
  contractId: string;
  serviceName: string;
  rows: RosterRow[];
}

/** 'YYYY-MM-DD' / Date 문자열 → 'YYYY.MM.DD'. 파싱 불가하면 원문 유지. */
function fmtDate(value: unknown): string {
  const s = value != null ? String(value).trim() : "";
  if (!s) return "";
  const m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (!m) return s;
  return `${m[1]}.${m[2].padStart(2, "0")}.${m[3].padStart(2, "0")}`;
}

function fmtPeriod(from: unknown, to: unknown): string {
  const f = fmtDate(from);
  if (!f) return "";
  const t = fmtDate(to);
  return `${f} ~ ${t || "진행중"}`;
}

/** 첫 번째 값이 있는 항목을 문자열로 (빈 문자열/null 은 건너뜀) */
function firstFilled(...values: unknown[]): string {
  for (const v of values) {
    const s = v != null ? String(v).trim() : "";
    if (s) return s;
  }
  return "";
}

/**
 * 계약의 수행인력 명단 데이터.
 * 관리자 → 직급 순으로 정렬. employee_profiles의 기술등급/전문분야/생년월일과
 * service_participants의 담당업무/수행기간을 조합한다. 참여인력이 없으면 rows=[].
 * 계약 자체가 없으면 null.
 */
export async function getContractRoster(contractId: string): Promise<ContractRoster | null> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT c.contract_title,
            c.started_at, c.contract_date, c.ended_at, c.permit_issued_at,
            lm.invoice_done_date,
            e.name, e.birth_date, e.eng_grade, e.specialty_field, e.job_duties,
            sp.task_label, sp.field_label, sp.participated_from, sp.participated_to, sp.role_label
       FROM contracts c
       LEFT JOIN (
         SELECT DISTINCT ON (contract_id) contract_id,
                CASE WHEN COALESCE(invoice_issued, 0) = 1
                     THEN SUBSTRING(invoice_issued_at, 1, 10)
                     ELSE NULL END AS invoice_done_date
           FROM contract_payment_milestones
          ORDER BY contract_id, stage_order DESC
       ) lm ON lm.contract_id = c.contract_id
       LEFT JOIN service_participants sp ON sp.contract_id = c.contract_id
       LEFT JOIN employee_profiles e ON e.employee_id = sp.employee_id
       LEFT JOIN positions p ON p.position_id = e.position_id
      WHERE c.contract_id = $1
      ORDER BY (sp.role_label = '관리자') DESC, p.rank_order DESC NULLS LAST, e.name ASC`,
    [contractId]
  );
  const rows = rowsToObjects(result);
  if (!rows.length) return null;

  const serviceName = String(rows[0].contract_title ?? "");
  // 계약 수행기간 폴백(2026-09-10) — 참여인력별 수행기간이 비어 있어도 계약 정보로 채운다.
  // ⚠종료일은 '완료 건'에서만 채운다: 완료 판정은 계약 트리·완료 현황과 동일하게
  //   허가일(permit_issued_at) 또는 최종 대금지급단위의 계산서 발행일 존재 여부로 본다.
  //   (미완료 계약의 ended_at 은 종료 '예정'일이라 그대로 쓰면 진행 중인데 끝난 것처럼 보인다.)
  const contractStart = firstFilled(rows[0].started_at, rows[0].contract_date);
  const permitDate = firstFilled(rows[0].permit_issued_at);
  const invoiceDoneDate = firstFilled(rows[0].invoice_done_date);
  const isCompleted = Boolean(permitDate || invoiceDoneDate);
  const contractEnd = isCompleted
    ? firstFilled(rows[0].ended_at, permitDate, invoiceDoneDate)
    : "";
  const list: RosterRow[] = [];
  for (const row of rows) {
    if (row.name == null) continue; // 참여인력 없는 계약(LEFT JOIN null)
    list.push({
      seq: list.length + 1,
      name: String(row.name),
      birth: fmtDate(row.birth_date),
      engGrade: row.eng_grade != null ? String(row.eng_grade) : "",
      specialty:
        row.specialty_field != null
          ? String(row.specialty_field)
          : row.field_label != null
            ? String(row.field_label)
            : "",
      task:
        row.task_label != null && String(row.task_label).trim()
          ? String(row.task_label)
          : row.job_duties != null
            ? String(row.job_duties)
            : "",
      period: fmtPeriod(
        firstFilled(row.participated_from, contractStart),
        firstFilled(row.participated_to, contractEnd)
      ),
    });
  }
  return { contractId, serviceName, rows: list };
}
