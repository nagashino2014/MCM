import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/**
 * 근로계약 전자서명 (PL-P3, 블루프린트 §5-4)
 * - 서명 문자열은 서버에서 생성: `성명(사번) · ISO시각` (leave-promotion 관례 — 클라이언트 입력 불신).
 * - 동의 문구 판은 CONSENT_VERSION 으로 고정(overtime-consent 관례) — 개정 시 버전 증가.
 * - 서명 5종(본서명 + 부속 4종) 전부 동의해야 체결. 확정본 PDF 는 signatures 기반 온디맨드 렌더.
 */

export const CONTRACT_CONSENT_VERSION = "lc-v1";

/** 서명 시 동의 문구(모달·법적 근거 표시 공용) — 전자서명법 §3(서면 서명과 동일 효력) */
export const CONTRACT_CONSENT_SECTIONS = [
  { key: "main", label: "근로계약 체결", text: "본 근로계약서의 조문 전체(제1조~제13조)와 임금 지급액을 확인하였으며, 이에 동의하고 계약을 체결합니다." },
  { key: "receipt", label: "근로계약서 교부 확인", text: "근로기준법 제17조에 따라 본 근로계약서 1부(전자문서)를 교부받았음을 확인합니다." },
  { key: "overtime", label: "시간외근로 동의", text: "제4조 제3항·제4항의 연장·야간·휴일 근로 승인 절차 및 사업장 밖 근로 취급에 동의합니다." },
  { key: "rules", label: "취업규칙 열람 확인", text: "회사의 취업규칙을 열람하였음을 확인합니다." },
  { key: "privacy", label: "개인정보 수집·이용 동의", text: "제12조에 따른 인사노무관리 목적의 개인정보 수집·이용에 동의합니다." },
] as const;

export interface MyContract {
  contractId: string;
  contractDate: string | null;
  positionName: string | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string; // sent | signed
  signedAt: string | null;
  tag: string | null;
}

export async function resolveEmployeeId(userId: string): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(u.employee_id, e2.employee_id) AS employee_id
         FROM users u
         LEFT JOIN employee_profiles e2 ON e2.user_id = u.user_id
        WHERE u.user_id = $1 LIMIT 1`,
      [userId]
    )
  );
  return rows[0]?.employee_id ? String(rows[0].employee_id) : null;
}

/** 본인 수신 계약(발송됨·서명완료) — 홈 수신함 카드 */
export async function listMyContracts(userId: string): Promise<{ rows: MyContract[]; linked: boolean }> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) return { rows: [], linked: false };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT contract_id, contract_date, position_name, annual_salary, monthly_salary,
              effective_from, effective_to, status, signed_at, tag
         FROM labor_contracts
        WHERE employee_id = $1 AND status IN ('sent','signed')
        ORDER BY contract_date DESC NULLS LAST LIMIT 10`,
      [employeeId]
    )
  );
  return {
    linked: true,
    rows: rows.map((r) => ({
      contractId: String(r.contract_id),
      contractDate: r.contract_date ? String(r.contract_date) : null,
      positionName: r.position_name ? String(r.position_name) : null,
      annualSalary: r.annual_salary == null ? null : Number(r.annual_salary),
      monthlySalary: r.monthly_salary == null ? null : Number(r.monthly_salary),
      effectiveFrom: r.effective_from ? String(r.effective_from) : null,
      effectiveTo: r.effective_to ? String(r.effective_to) : null,
      status: String(r.status),
      signedAt: r.signed_at ? String(r.signed_at) : null,
      tag: r.tag ? String(r.tag) : null,
    })),
  };
}

/** 본인 계약인지 확인 후 계약 반환(파일 스트림·서명 공용 가드) */
export async function assertOwnContract(
  userId: string,
  contractId: string
): Promise<{ employeeId: string; status: string; name: string; employeeNo: string | null }> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) throw Object.assign(new Error("직원 연결이 없는 계정입니다."), { status: 403 });
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.status, p.name, p.employee_no
         FROM labor_contracts c
         JOIN employee_profiles p ON p.employee_id = c.employee_id
        WHERE c.contract_id = $1 AND c.employee_id = $2`,
      [contractId, employeeId]
    )
  );
  if (!rows.length) throw Object.assign(new Error("본인 계약만 열람·서명할 수 있습니다."), { status: 403 });
  return {
    employeeId,
    status: String(rows[0].status),
    name: String(rows[0].name),
    employeeNo: rows[0].employee_no ? String(rows[0].employee_no) : null,
  };
}

/** 전자서명 — 5종 전부 동의 필수. 서명 문자열은 서버 생성. */
export async function signContract(
  userId: string,
  contractId: string,
  consents: Record<string, boolean>
): Promise<{ signedAt: string }> {
  const own = await assertOwnContract(userId, contractId);
  if (own.status === "signed") throw Object.assign(new Error("이미 서명이 완료된 계약입니다."), { status: 400 });
  if (own.status !== "sent") throw Object.assign(new Error("발송된 계약만 서명할 수 있습니다."), { status: 400 });
  for (const s of CONTRACT_CONSENT_SECTIONS) {
    if (!consents[s.key]) {
      throw Object.assign(new Error(`'${s.label}' 항목에 동의해야 서명할 수 있습니다.`), { status: 400 });
    }
  }
  const now = new Date().toISOString();
  const sig = `${own.name}(${own.employeeNo ?? own.employeeId}) · ${now}`;
  const signatures = Object.fromEntries(CONTRACT_CONSENT_SECTIONS.map((s) => [s.key, sig]));
  await withDbWrite(async (txn) => {
    await txn.exec(
      `UPDATE labor_contracts
          SET status = 'signed', signed_at = $2, signatures = $3::jsonb, consent_version = $4, updated_at = $2
        WHERE contract_id = $1 AND status = 'sent'`,
      [contractId, now, JSON.stringify(signatures), CONTRACT_CONSENT_VERSION]
    );
  });
  return { signedAt: now };
}
