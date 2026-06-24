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
            e.name, e.birth_date, e.eng_grade, e.specialty_field, e.job_duties,
            sp.task_label, sp.field_label, sp.participated_from, sp.participated_to, sp.role_label
       FROM contracts c
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
      period: fmtPeriod(row.participated_from, row.participated_to),
    });
  }
  return { contractId, serviceName, rows: list };
}
