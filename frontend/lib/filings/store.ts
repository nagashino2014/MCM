/**
 * 대외 신고 대기열 DB 액세스 계층 — regulatory_filings / regulatory_filing_settings (마이그 213).
 *
 * 대기열은 MCM 데이터에서 **파생**한다(syncFilings): 직원·인사이벤트·계약·참여인력을 읽어 신고 사유가 있는 건을
 * dedup_key 로 멱등 upsert 하고, 사유가 사라진 pending(derived) 건은 지운다. 이미 제출·제외 처리된 건은 건드리지 않는다.
 * 등급 변경처럼 이력이 없는 사유는 저장 시점에 기록한다(source='event', recordGradeChangeFiling).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import type {
  FilingField,
  FilingKind,
  FilingPayload,
  FilingRow,
  FilingSettings,
  FilingStatus,
  FilingSummary,
} from "./types";
import { FILING_TRIGGER_LABEL } from "./types";

const SETTINGS_KEY = "config";

/** 환경부 등급 표시 라벨(lib/admin/employee-records.envGradeLabel 사본 — 순환 import 회피). */
function envGradeLabel(envGrade?: string | null, specialtyField?: string | null): string {
  const base = (envGrade ?? "").trim();
  if (!base) return "";
  return specialtyField === "대기관리" ? `${base}(대기)` : base;
}
const nowIso = () => new Date().toISOString();
const newId = () => `rf-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

/** 오늘(KST) YYYY-MM-DD */
export function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

const ymd = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

// ───────────────────────── 설정 ─────────────────────────

export const FILING_SETTINGS_DEFAULTS: FilingSettings = {
  cutoffOn: "2026-01-01",
  dueDays: { ieps_staff: 30, ieps_agency: 30, etis_career: 30 },
  notifyUserIds: [],
  remindBeforeDays: 7,
};

function normalizeSettings(patch: unknown): FilingSettings {
  const p = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const dd = (p.dueDays && typeof p.dueDays === "object" ? p.dueDays : {}) as Record<string, unknown>;
  const num = (v: unknown, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : fb;
  };
  return {
    cutoffOn: ymd(p.cutoffOn) ?? FILING_SETTINGS_DEFAULTS.cutoffOn,
    dueDays: {
      ieps_staff: num(dd.ieps_staff, 30),
      ieps_agency: num(dd.ieps_agency, 30),
      etis_career: num(dd.etis_career, 30),
    },
    notifyUserIds: Array.isArray(p.notifyUserIds) ? p.notifyUserIds.map(String).filter(Boolean) : [],
    remindBeforeDays: num(p.remindBeforeDays, 7),
  };
}

export async function loadFilingSettings(db?: PgDatabase): Promise<FilingSettings> {
  const conn = db ?? (await getDb());
  try {
    const rows = rowsToObjects(
      await conn.exec(`SELECT setting_json FROM regulatory_filing_settings WHERE setting_key = $1`, [SETTINGS_KEY])
    );
    if (!rows.length) return FILING_SETTINGS_DEFAULTS;
    return normalizeSettings(parseJson(rows[0].setting_json, {}));
  } catch {
    return FILING_SETTINGS_DEFAULTS;
  }
}

export async function saveFilingSettings(patch: unknown, updatedBy: string | null): Promise<FilingSettings> {
  return withDbWrite(async (db) => {
    const current = await loadFilingSettings(db);
    const merged = normalizeSettings({ ...current, ...(patch as Record<string, unknown>) });
    await db.run(
      `INSERT INTO regulatory_filing_settings (setting_key, setting_json, updated_at, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (setting_key) DO UPDATE
         SET setting_json = EXCLUDED.setting_json, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [SETTINGS_KEY, JSON.stringify(merged), nowIso(), updatedBy]
    );
    return merged;
  });
}

// ───────────────────────── 동기화(파생) ─────────────────────────

interface EmployeeRec {
  employeeId: string;
  name: string;
  status: string;
  hiredAt: string | null;
  mobilePhone: string;
  email: string;
  birthDate: string | null;
  engGrade: string;
  envGrade: string;
  specialty: string;
  agentRegisteredAt: string | null;
  etisMemberNo: string;
  positionName: string;
  certs: string[];
  degrees: string[];
}

interface ContractRec {
  contractId: string;
  title: string;
  serviceSubtype: string;
  status: string;
  contractDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  amount: number | null;
  currentAmount: number | null;
  permitNo: string;
  permitIssuedAt: string | null;
  awardRate: number | null;
  preconsultNotifiedAt: string | null;
  counterpartyName: string;
  counterpartyPhone: string;
  facilityName: string;
  facilityAddress: string;
}

interface Company {
  name: string;
  phone: string;
  agencyRegNo: string;
}

interface Candidate {
  dedupKey: string;
  kind: FilingKind;
  trigger: string;
  employeeId: string | null;
  contractId: string | null;
  title: string;
  subtitle: string | null;
  occurredOn: string;
  payload: FilingPayload;
}

const toMillion = (won: number | null): string => {
  if (won == null || !Number.isFinite(won)) return "";
  const m = won / 1_000_000;
  return Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/\.?0+$/, "");
};
const period = (from: string | null, to: string | null) => (from || to ? `${from ?? ""} ~ ${to ?? ""}` : "");

/** IEPS 통합허가구분 라디오 — 용역세분류 매핑 */
function permitCategory(subtype: string): string {
  const s = subtype.trim();
  if (s === "최초허가") return "통합허가";
  if (s === "변경허가") return "변경허가";
  if (s === "변경신고") return "변경신고";
  if (s === "재검토") return "허가재검토";
  return s;
}

/** ETIS 엔지니어링사업종류 — 전문분야 매핑(스샷 기준 대기관리=대기오염물질 배출시설) */
function etisBusinessKind(specialty: string): string {
  if (specialty === "대기관리") return "대기오염물질 배출시설";
  if (specialty === "수질관리") return "수질오염물질 배출시설";
  return "";
}

function staffFields(e: EmployeeRec): FilingField[] {
  return [
    { label: "성명", value: e.name },
    { label: "연락처", value: e.mobilePhone, hint: "010-0000-0000 형식" },
    { label: "생년월일", value: e.birthDate ?? "" },
    { label: "인력등급", value: envGradeLabel(e.envGrade, e.specialty) },
    { label: "자격현황", value: e.certs.join(", ") },
    { label: "종빙서류", value: [...e.certs.map((c) => `${c} 자격증`), ...e.degrees].join(", ") },
    { label: "대기분야 해당여부", value: e.specialty === "대기관리" ? "대기분야" : "" },
  ];
}

function agencyFields(c: ContractRec, co: Company, opts: { changedOn?: string; amendDetail?: string; complete?: boolean }): FilingField[] {
  const amount = opts.changedOn ? (c.currentAmount ?? c.amount) : (c.amount ?? c.currentAmount);
  return [
    { label: "대행사업장 명칭", value: c.facilityName || c.counterpartyName, hint: "사업장 검색으로 선택" },
    { label: "사업장 소재지", value: c.facilityAddress },
    { label: "통합허가구분", value: permitCategory(c.serviceSubtype) },
    { label: "허가번호", value: c.permitNo },
    { label: "대행업무 기간", value: period(c.startedAt, c.endedAt) },
    { label: "대행업무의 개요", value: c.title },
    { label: "발주자(기관)", value: c.counterpartyName },
    { label: "전화번호", value: c.counterpartyPhone },
    { label: "주 계약자", value: co.name },
    { label: "통합허가대행업 등록번호", value: co.agencyRegNo },
    { label: "지분금액(백만원)", value: toMillion(amount) },
    { label: "지분율(%)", value: "100", hint: "단독계약 기준" },
    { label: "(변경)계약일자", value: opts.changedOn ?? c.contractDate ?? "" },
    { label: "(변경)계약기간", value: period(c.startedAt, c.endedAt) },
    { label: "(변경)계약금액(백만원)", value: toMillion(amount) },
    { label: "(변경)낙찰률(%)", value: c.awardRate != null ? String(c.awardRate) : "" },
    { label: "사전협의 통보일자", value: c.preconsultNotifiedAt ?? "" },
    { label: "준공일자", value: opts.complete ? (c.permitIssuedAt ?? "") : "", hint: "완료일(허가일) 기준" },
    ...(opts.amendDetail ? [{ label: "변경 내용", value: opts.amendDetail }] : []),
  ];
}

function careerFields(e: EmployeeRec, c: ContractRec, from: string | null, to: string | null): FilingField[] {
  return [
    { label: "회원번호", value: e.etisMemberNo, hint: "기술자 선택 키" },
    { label: "이름", value: e.name },
    { label: "기간", value: period(from, to) },
    { label: "참여사업명", value: c.title },
    { label: "발주자", value: c.counterpartyName },
    { label: "기술부문", value: "환경" },
    { label: "전문분야", value: e.specialty },
    { label: "엔지니어링사업종류", value: etisBusinessKind(e.specialty) },
    { label: "엔지니어링활동종류", value: "연구" },
    { label: "직위", value: e.positionName },
  ];
}

async function loadEmployees(db: PgDatabase): Promise<Map<string, EmployeeRec>> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.status, e.hired_at, e.mobile_phone, e.email, e.birth_date,
              e.eng_grade, e.env_grade, e.specialty_field, e.agent_registered_at, e.etis_member_no,
              p.position_name
         FROM employee_profiles e
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE COALESCE(e.env_grade, '') <> '' OR COALESCE(e.eng_grade, '') <> ''`
    )
  );
  const map = new Map<string, EmployeeRec>();
  for (const r of rows) {
    map.set(String(r.employee_id), {
      employeeId: String(r.employee_id),
      name: str(r.name),
      status: str(r.status),
      hiredAt: ymd(r.hired_at),
      mobilePhone: str(r.mobile_phone),
      email: str(r.email),
      birthDate: ymd(r.birth_date),
      engGrade: str(r.eng_grade).trim(),
      envGrade: str(r.env_grade).trim(),
      specialty: str(r.specialty_field).trim(),
      agentRegisteredAt: ymd(r.agent_registered_at),
      etisMemberNo: str(r.etis_member_no),
      positionName: str(r.position_name),
      certs: [],
      degrees: [],
    });
  }
  if (map.size === 0) return map;
  const ids = [...map.keys()];
  const certs = rowsToObjects(
    await db.exec(
      `SELECT employee_id, certification_name FROM employee_certifications
        WHERE employee_id = ANY($1::text[]) ORDER BY display_order ASC`,
      [ids]
    )
  );
  for (const r of certs) map.get(String(r.employee_id))?.certs.push(str(r.certification_name));
  const edus = rowsToObjects(
    await db.exec(
      `SELECT employee_id, degree_level FROM employee_educations
        WHERE employee_id = ANY($1::text[]) ORDER BY display_order ASC`,
      [ids]
    )
  );
  const degreeLabel: Record<string, string> = { bachelor: "학사 학위증", master: "석사 학위증", doctor: "박사 학위증" };
  for (const r of edus) {
    const label = degreeLabel[str(r.degree_level)];
    if (label) map.get(String(r.employee_id))?.degrees.push(label);
  }
  return map;
}

async function loadContracts(db: PgDatabase): Promise<Map<string, ContractRec>> {
  // 통합허가 계열·매출(sales)·삭제 안 됨·초안 제외. 대행사업장은 facility_id → contract_facilities(대상사업장) 순으로 폴백.
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.service_subtype, c.contract_status,
              c.contract_date, c.started_at, c.ended_at, c.contract_amount, c.current_amount,
              c.permit_no, c.permit_issued_at, c.award_rate, c.preconsult_notified_at,
              cp.company_name AS counterparty_name, cp.phone_number AS counterparty_phone,
              COALESCE(f.company_name, tf.company_name) AS facility_name,
              COALESCE(f.site_address, tf.site_address) AS facility_address
         FROM contracts c
         JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities f ON f.facility_id = c.facility_id
         LEFT JOIN LATERAL (
           SELECT x.company_name, x.site_address
             FROM contract_facilities cf JOIN facilities x ON x.facility_id = cf.facility_id
            WHERE cf.contract_id = c.contract_id AND cf.relation_type = 'integrated_permit_target'
            ORDER BY cf.created_at ASC LIMIT 1
         ) tf ON true
        WHERE c.deleted_at IS NULL
          AND COALESCE(c.contract_direction, 'sales') = 'sales'
          AND COALESCE(c.service_type, '') LIKE '%통합%'
          AND c.contract_status <> 'draft'`
    )
  );
  const map = new Map<string, ContractRec>();
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  for (const r of rows) {
    map.set(String(r.contract_id), {
      contractId: String(r.contract_id),
      title: str(r.contract_title),
      serviceSubtype: str(r.service_subtype),
      status: str(r.contract_status),
      contractDate: ymd(r.contract_date),
      startedAt: ymd(r.started_at),
      endedAt: ymd(r.ended_at),
      amount: num(r.contract_amount),
      currentAmount: num(r.current_amount),
      permitNo: str(r.permit_no),
      permitIssuedAt: ymd(r.permit_issued_at),
      awardRate: num(r.award_rate),
      preconsultNotifiedAt: ymd(r.preconsult_notified_at),
      counterpartyName: str(r.counterparty_name),
      counterpartyPhone: str(r.counterparty_phone),
      facilityName: str(r.facility_name),
      facilityAddress: str(r.facility_address),
    });
  }
  return map;
}

async function loadCompany(db: PgDatabase): Promise<Company> {
  const co: Company = { name: "", phone: "", agencyRegNo: "" };
  try {
    const rows = rowsToObjects(
      await db.exec(`SELECT company_name, phone FROM company_profile WHERE profile_id = 'default' LIMIT 1`)
    );
    if (rows[0]) {
      co.name = str(rows[0].company_name);
      co.phone = str(rows[0].phone);
    }
    const cred = rowsToObjects(
      await db.exec(
        `SELECT credential_no FROM company_credentials
          WHERE kind = 'license' AND (name LIKE '%통합%대행%' OR name LIKE '%대행업%')
          ORDER BY display_order ASC LIMIT 1`
      )
    );
    if (cred[0]) co.agencyRegNo = str(cred[0].credential_no);
  } catch {
    // 회사 프로필 미설정이면 빈값 — 사용자가 사이트에서 직접 입력
  }
  return co;
}

/** 후보 계산 — 순수 파생. */
async function buildCandidates(db: PgDatabase, settings: FilingSettings): Promise<Candidate[]> {
  const cutoff = settings.cutoffOn;
  const [employees, contracts, company] = await Promise.all([loadEmployees(db), loadContracts(db), loadCompany(db)]);
  const out: Candidate[] = [];

  // 퇴사 이벤트(직원별 최신 1건 이상 — 재입사 대비 일자별 dedup)
  const resignations = rowsToObjects(
    await db.exec(
      `SELECT employee_id, event_date FROM employee_hr_events
        WHERE event_type = 'resignation' AND event_date >= $1`,
      [cutoff]
    )
  );

  for (const e of employees.values()) {
    const isIeps = e.envGrade !== "";
    const isEtis = e.engGrade !== "";
    // IEPS 선임: 활성 + 대행인력등록일 미기입 + 기준일 이후 입사
    if (isIeps && e.status === "active" && !e.agentRegisteredAt && e.hiredAt && e.hiredAt >= cutoff) {
      out.push({
        dedupKey: `ieps_staff:appoint:${e.employeeId}`,
        kind: "ieps_staff",
        trigger: "appoint",
        employeeId: e.employeeId,
        contractId: null,
        title: `${e.name} — 선임`,
        subtitle: envGradeLabel(e.envGrade, e.specialty) || null,
        occurredOn: e.hiredAt,
        payload: {
          site: "ieps",
          screen: "대행업 변경신고 › 기술인력보유현황 (+행추가)",
          fields: [...staffFields(e), { label: "선임일자", value: e.hiredAt, hint: "입사일 기준 — 다르면 수정" }],
        },
      });
    }
    // ETIS 입사
    if (isEtis && e.status === "active" && e.hiredAt && e.hiredAt >= cutoff) {
      out.push({
        dedupKey: `etis_career:join:${e.employeeId}`,
        kind: "etis_career",
        trigger: "join",
        employeeId: e.employeeId,
        contractId: null,
        title: `${e.name} — 입사`,
        subtitle: e.engGrade || null,
        occurredOn: e.hiredAt,
        payload: {
          site: "etis",
          screen: "변경신고 › 입/퇴사, 경력추가 › 근무처정보",
          fields: [
            { label: "회원번호", value: e.etisMemberNo, hint: "기술자 선택 키" },
            { label: "이름", value: e.name },
            { label: "입사일", value: e.hiredAt },
            { label: "휴대폰번호", value: e.mobilePhone },
            { label: "이메일", value: e.email },
            { label: "회사명", value: company.name },
          ],
        },
      });
    }
  }

  for (const r of resignations) {
    const e = employees.get(String(r.employee_id));
    const on = ymd(r.event_date);
    if (!e || !on) continue;
    if (e.envGrade !== "") {
      out.push({
        dedupKey: `ieps_staff:dismiss:${e.employeeId}:${on}`,
        kind: "ieps_staff",
        trigger: "dismiss",
        employeeId: e.employeeId,
        contractId: null,
        title: `${e.name} — 해임`,
        subtitle: envGradeLabel(e.envGrade, e.specialty) || null,
        occurredOn: on,
        payload: {
          site: "ieps",
          screen: "대행업 변경신고 › 기술인력보유현황",
          fields: [
            { label: "성명", value: e.name },
            { label: "해임일자", value: on, hint: "행삭제 하지 말고 해임일자만 입력" },
          ],
        },
      });
    }
    if (e.engGrade !== "") {
      out.push({
        dedupKey: `etis_career:leave:${e.employeeId}:${on}`,
        kind: "etis_career",
        trigger: "leave",
        employeeId: e.employeeId,
        contractId: null,
        title: `${e.name} — 퇴사`,
        subtitle: e.engGrade || null,
        occurredOn: on,
        payload: {
          site: "etis",
          screen: "변경신고 › 입/퇴사, 경력추가 › 협회에 신고한 근무이력",
          fields: [
            { label: "회원번호", value: e.etisMemberNo },
            { label: "이름", value: e.name },
            { label: "퇴사일", value: on },
            { label: "진행중인 경력 종료일", value: on, hint: "진행 중 경력이 있으면 같은 날짜로 종료" },
          ],
        },
      });
    }
  }

  // 계약 — 체결·변경·이행
  const changes = rowsToObjects(
    await db.exec(
      `SELECT change_id, contract_id, changed_at, created_at, previous_amount, delta_amount, detail
         FROM contract_change_events
        WHERE COALESCE(NULLIF(changed_at, ''), created_at) >= $1`,
      [cutoff]
    )
  );
  for (const c of contracts.values()) {
    const subtitle = c.facilityName || c.counterpartyName || null;
    if (c.contractDate && c.contractDate >= cutoff) {
      out.push({
        dedupKey: `ieps_agency:conclude:${c.contractId}`,
        kind: "ieps_agency",
        trigger: "conclude",
        employeeId: null,
        contractId: c.contractId,
        title: `${c.title} — 체결 보고`,
        subtitle,
        occurredOn: c.contractDate,
        payload: { site: "ieps", screen: "대행 실적 보고 (체결)", fields: agencyFields(c, company, {}) },
      });
    }
    if (c.permitIssuedAt && c.permitIssuedAt >= cutoff) {
      out.push({
        dedupKey: `ieps_agency:complete:${c.contractId}`,
        kind: "ieps_agency",
        trigger: "complete",
        employeeId: null,
        contractId: c.contractId,
        title: `${c.title} — 이행 보고`,
        subtitle,
        occurredOn: c.permitIssuedAt,
        payload: { site: "ieps", screen: "대행 실적 보고 (이행)", fields: agencyFields(c, company, { complete: true }) },
      });
    }
  }
  for (const ch of changes) {
    const c = contracts.get(String(ch.contract_id));
    const on = ymd(ch.changed_at) ?? ymd(ch.created_at);
    if (!c || !on) continue;
    const prev = ch.previous_amount != null ? Number(ch.previous_amount) : null;
    const delta = ch.delta_amount != null ? Number(ch.delta_amount) : null;
    const detailParts = [
      str(ch.detail),
      prev != null && delta != null ? `금액 ${prev.toLocaleString("ko-KR")} → ${(prev + delta).toLocaleString("ko-KR")}원` : "",
    ].filter(Boolean);
    out.push({
      dedupKey: `ieps_agency:amend:${c.contractId}:${String(ch.change_id)}`,
      kind: "ieps_agency",
      trigger: "amend",
      employeeId: null,
      contractId: c.contractId,
      title: `${c.title} — 변경 보고`,
      subtitle: c.facilityName || c.counterpartyName || null,
      occurredOn: on,
      payload: {
        site: "ieps",
        screen: "대행 실적 보고 (변경)",
        fields: agencyFields(c, company, { changedOn: on, amendDetail: detailParts.join(" / ") }),
      },
    });
  }

  // 참여인력 — ETIS 경력 추가·종료 (직원×계약 단위, 역할이 여러 개면 가장 이른 시작·가장 늦은 종료)
  const parts = rowsToObjects(
    await db.exec(
      `SELECT sp.employee_id, sp.contract_id,
              MIN(COALESCE(NULLIF(sp.participated_from, ''), c.started_at, c.contract_date)) AS from_on,
              MAX(NULLIF(sp.participated_to, '')) AS to_on,
              BOOL_AND(sp.participated_to IS NOT NULL AND sp.participated_to <> '') AS all_ended
         FROM service_participants sp
         JOIN contracts c ON c.contract_id = sp.contract_id
        GROUP BY sp.employee_id, sp.contract_id`
    )
  );
  for (const p of parts) {
    const e = employees.get(String(p.employee_id));
    const c = contracts.get(String(p.contract_id));
    if (!e || !c || e.engGrade === "") continue;
    const from = ymd(p.from_on);
    const to = ymd(p.to_on);
    // 종료일: 참여 종료일이 모두 기입되면 그 값, 아니면 계약 완료일(허가일)
    const endOn = p.all_ended === true ? to : c.permitIssuedAt;
    if (from && from >= cutoff) {
      out.push({
        dedupKey: `etis_career:career_add:${e.employeeId}:${c.contractId}`,
        kind: "etis_career",
        trigger: "career_add",
        employeeId: e.employeeId,
        contractId: c.contractId,
        title: `${e.name} — 경력 추가`,
        subtitle: c.title,
        occurredOn: from,
        payload: {
          site: "etis",
          screen: "변경신고 › 입/퇴사, 경력추가 › 경력추가신고 (+)",
          fields: careerFields(e, c, from, endOn),
        },
      });
    }
    if (endOn && endOn >= cutoff) {
      out.push({
        dedupKey: `etis_career:career_end:${e.employeeId}:${c.contractId}`,
        kind: "etis_career",
        trigger: "career_end",
        employeeId: e.employeeId,
        contractId: c.contractId,
        title: `${e.name} — 경력 종료`,
        subtitle: c.title,
        occurredOn: endOn,
        payload: {
          site: "etis",
          screen: "변경신고 › 입/퇴사, 경력추가 › 진행중인경력 (종료일 입력)",
          fields: [
            { label: "회원번호", value: e.etisMemberNo },
            { label: "이름", value: e.name },
            { label: "참여사업명", value: c.title },
            { label: "종료일", value: endOn, hint: p.all_ended === true ? "참여 종료일" : "완료일(허가일) 기준" },
          ],
        },
      });
    }
  }

  return out;
}

/**
 * 대기열 동기화 — 파생 후보를 upsert 하고, 사유가 사라진 pending(derived) 건을 정리한다.
 * 목록·요약 API 가 호출 시점마다 실행한다(데이터 규모가 작아 수십 ms).
 */
export async function syncFilings(): Promise<{ upserted: number; removed: number }> {
  return withDbWrite(async (db) => {
    const settings = await loadFilingSettings(db);
    const candidates = await buildCandidates(db, settings);
    const now = nowIso();
    let upserted = 0;
    for (const cnd of candidates) {
      const dueOn = addDays(cnd.occurredOn, settings.dueDays[cnd.kind]);
      await db.run(
        `INSERT INTO regulatory_filings
           (filing_id, filing_kind, trigger_kind, dedup_key, source, employee_id, contract_id,
            title, subtitle, occurred_on, due_on, status, payload_json, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'derived', $5, $6, $7, $8, $9, $10, 'pending', $11::jsonb, $12, $12)
         ON CONFLICT (dedup_key) DO UPDATE SET
           title = EXCLUDED.title,
           subtitle = EXCLUDED.subtitle,
           occurred_on = EXCLUDED.occurred_on,
           due_on = EXCLUDED.due_on,
           payload_json = EXCLUDED.payload_json,
           updated_at = EXCLUDED.updated_at
         WHERE regulatory_filings.status = 'pending'`,
        [
          newId(),
          cnd.kind,
          cnd.trigger,
          cnd.dedupKey,
          cnd.employeeId,
          cnd.contractId,
          cnd.title,
          cnd.subtitle,
          cnd.occurredOn,
          dueOn,
          JSON.stringify(cnd.payload),
          now,
        ]
      );
      upserted += 1;
    }
    const keys = candidates.map((c) => c.dedupKey);
    const removed = rowsToObjects(
      await db.exec(
        `DELETE FROM regulatory_filings
          WHERE status = 'pending' AND source = 'derived' AND NOT (dedup_key = ANY($1::text[]))
          RETURNING filing_id`,
        [keys]
      )
    ).length;
    return { upserted, removed };
  });
}

/**
 * 등급·전문분야 변경(이력 없음) — 직원 저장 시 호출(source='event'). 같은 날 여러 번 저장해도 1건.
 * 저장 트랜잭션 안에서 실행되므로 db 를 받는다. 실패해도 저장을 막지 않도록 호출부에서 try/catch.
 */
export async function recordGradeChangeFiling(
  db: PgDatabase,
  input: {
    employeeId: string;
    name: string;
    beforeGrade: string | null;
    beforeSpecialty: string | null;
    afterGrade: string | null;
    afterSpecialty: string | null;
  }
): Promise<boolean> {
  const before = envGradeLabel(input.beforeGrade, input.beforeSpecialty);
  const after = envGradeLabel(input.afterGrade, input.afterSpecialty);
  if (!before || !after || before === after) return false; // 신규 부여·해제는 선임/해임으로 다룬다
  const settings = await loadFilingSettings(db);
  const on = todayKst();
  if (on < settings.cutoffOn) return false;
  const now = nowIso();
  await db.run(
    `INSERT INTO regulatory_filings
       (filing_id, filing_kind, trigger_kind, dedup_key, source, employee_id, contract_id,
        title, subtitle, occurred_on, due_on, status, payload_json, created_at, updated_at)
     VALUES ($1, 'ieps_staff', 'grade_change', $2, 'event', $3, NULL, $4, $5, $6, $7, 'pending', $8::jsonb, $9, $9)
     ON CONFLICT (dedup_key) DO UPDATE SET
       subtitle = EXCLUDED.subtitle, payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at
     WHERE regulatory_filings.status = 'pending'`,
    [
      newId(),
      `ieps_staff:grade_change:${input.employeeId}:${on}`,
      input.employeeId,
      `${input.name} — 등급 변경`,
      `${before} → ${after}`,
      on,
      addDays(on, settings.dueDays.ieps_staff),
      JSON.stringify({
        site: "ieps",
        screen: "대행업 변경신고 › 기술인력보유현황 (해당 행 수정)",
        fields: [
          { label: "성명", value: input.name },
          { label: "변경 전 인력등급", value: before },
          { label: "변경 후 인력등급", value: after },
          { label: "변경일", value: on },
        ],
      } satisfies FilingPayload),
      now,
    ]
  );
  return true;
}

// ───────────────────────── 조회·상태 변경 ─────────────────────────

function rowToFiling(r: Record<string, unknown>, today: string): FilingRow {
  const dueOn = ymd(r.due_on);
  return {
    filingId: String(r.filing_id),
    filingKind: String(r.filing_kind) as FilingKind,
    triggerKind: String(r.trigger_kind),
    source: (String(r.source) === "event" ? "event" : "derived"),
    employeeId: r.employee_id != null ? String(r.employee_id) : null,
    contractId: r.contract_id != null ? String(r.contract_id) : null,
    title: str(r.title),
    subtitle: r.subtitle != null ? String(r.subtitle) : null,
    occurredOn: str(r.occurred_on),
    dueOn,
    status: String(r.status) as FilingStatus,
    payload: parseJson<FilingPayload>(r.payload_json, { site: "ieps", screen: "", fields: [] }),
    submittedAt: r.submitted_at != null ? String(r.submitted_at) : null,
    submittedBy: r.submitted_by != null ? String(r.submitted_by) : null,
    submittedByName: r.submitted_by_name != null ? String(r.submitted_by_name) : null,
    receiptNo: r.receipt_no != null ? String(r.receipt_no) : null,
    note: r.note != null ? String(r.note) : null,
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    daysLeft: dueOn ? diffDays(today, dueOn) : null,
  };
}

const SELECT_FILING = `
  SELECT f.*, u.name AS submitted_by_name
    FROM regulatory_filings f
    LEFT JOIN users u ON u.user_id = f.submitted_by`;

export interface FilingListFilter {
  status?: FilingStatus | "all";
  kind?: FilingKind | "all";
}

export async function listFilings(filter: FilingListFilter = {}): Promise<FilingRow[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status && filter.status !== "all") {
    params.push(filter.status);
    where.push(`f.status = $${params.length}`);
  }
  if (filter.kind && filter.kind !== "all") {
    params.push(filter.kind);
    where.push(`f.filing_kind = $${params.length}`);
  }
  const rows = rowsToObjects(
    await db.exec(
      `${SELECT_FILING}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY CASE f.status WHEN 'pending' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END,
                f.due_on ASC NULLS LAST, f.occurred_on ASC, f.title ASC`,
      params
    )
  );
  const today = todayKst();
  return rows.map((r) => rowToFiling(r, today));
}

export async function getFiling(filingId: string): Promise<FilingRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${SELECT_FILING} WHERE f.filing_id = $1 LIMIT 1`, [filingId]));
  return rows[0] ? rowToFiling(rows[0], todayKst()) : null;
}

export interface FilingStatusInput {
  status: FilingStatus;
  receiptNo?: string | null;
  note?: string | null;
  submittedAt?: string | null;
  /** 선임 신고 제출 시 대행인력등록일(agent_registered_at) 확정값 — 비우면 갱신 안 함 */
  agentRegisteredAt?: string | null;
}

export async function updateFilingStatus(
  filingId: string,
  actorUserId: string,
  input: FilingStatusInput
): Promise<FilingRow> {
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(await db.exec(`SELECT * FROM regulatory_filings WHERE filing_id = $1`, [filingId]));
    const cur = rows[0];
    if (!cur) throw Object.assign(new Error("신고 항목을 찾을 수 없습니다."), { status: 404 });
    const now = nowIso();
    const submitted = input.status === "submitted";
    await db.run(
      `UPDATE regulatory_filings
          SET status = $2,
              submitted_at = $3,
              submitted_by = $4,
              receipt_no = $5,
              note = $6,
              updated_at = $7
        WHERE filing_id = $1`,
      [
        filingId,
        input.status,
        submitted ? (ymd(input.submittedAt) ?? todayKst()) : null,
        submitted ? actorUserId : null,
        submitted ? (input.receiptNo?.trim() || null) : null,
        input.note?.trim() || null,
        now,
      ]
    );
    // 선임 신고 완료 → 대행인력등록일 확정(비어 있던 값만). 이후 동기화에서 선임 후보에서 빠진다.
    if (
      submitted &&
      String(cur.filing_kind) === "ieps_staff" &&
      String(cur.trigger_kind) === "appoint" &&
      cur.employee_id != null
    ) {
      const on = ymd(input.agentRegisteredAt) ?? ymd(input.submittedAt) ?? todayKst();
      await db.run(
        `UPDATE employee_profiles SET agent_registered_at = $2, updated_at = $3
          WHERE employee_id = $1 AND COALESCE(agent_registered_at, '') = ''`,
        [String(cur.employee_id), on, now]
      );
    }
  });
  const row = await getFiling(filingId);
  if (!row) throw Object.assign(new Error("신고 항목을 찾을 수 없습니다."), { status: 404 });
  return row;
}

export async function getFilingSummary(limit = 6): Promise<FilingSummary> {
  const settings = await loadFilingSettings();
  const pendingRows = await listFilings({ status: "pending" });
  const byKind: Record<FilingKind, number> = { ieps_staff: 0, ieps_agency: 0, etis_career: 0 };
  let overdue = 0;
  let dueSoon = 0;
  for (const f of pendingRows) {
    byKind[f.filingKind] += 1;
    if (f.daysLeft != null && f.daysLeft < 0) overdue += 1;
    else if (f.daysLeft != null && f.daysLeft <= settings.remindBeforeDays) dueSoon += 1;
  }
  return { pending: pendingRows.length, overdue, dueSoon, byKind, items: pendingRows.slice(0, limit) };
}

/** 사유 라벨(제목 옆 배지용) */
export function triggerLabel(trigger: string): string {
  return FILING_TRIGGER_LABEL[trigger] ?? trigger;
}
