import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/**
 * 근로계약 서버 쿼리 (PL-P2, docs/payroll-labor-contract-blueprint.md §4-2)
 * - 데이터는 scripts/labor_contract_import 로 적재된 labor_contracts(source='imported')
 *   + 이후 앱에서 생성(generated)되는 계약.
 * - 트리(부서→재직자)와 직원별 계약 카드 목록, 검수 수정.
 */

export interface ContractTreeEmployee {
  employeeId: string;
  name: string;
  positionName: string | null;
  contractCount: number;
}

export interface ContractTreeDept {
  deptId: string;
  deptName: string;
  employees: ContractTreeEmployee[];
}

export interface LaborContractCard {
  contractId: string;
  employeeId: string;
  kind: string;
  tag: string | null;
  contractDate: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  positionName: string | null;
  duty: string | null;
  firstHiredAt: string | null;
  annualSalary: number | null;
  monthlySalary: number | null;
  wageComponents: Record<string, number>;
  probation: boolean;
  source: string;
  status: string;
  note: string | null;
  confidence: string | null;
  hasFile: boolean;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 좌측 트리 — 부서별 재직자 + 계약 보유 수. 퇴사자 노드는 계약 가진 inactive 직원만. */
export async function getContractTree(): Promise<{ depts: ContractTreeDept[]; resigned: ContractTreeEmployee[] }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.employee_id, p.name, p.status, p.dept_id, d.dept_name, d.display_order,
              pos.position_name, count(c.contract_id) AS contract_count
         FROM employee_profiles p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
         LEFT JOIN labor_contracts c ON c.employee_id = p.employee_id AND c.status <> 'void'
        WHERE p.status = 'active' OR EXISTS
              (SELECT 1 FROM labor_contracts c2 WHERE c2.employee_id = p.employee_id)
        GROUP BY p.employee_id, p.name, p.status, p.dept_id, d.dept_name, d.display_order, pos.position_name, pos.rank_order
        ORDER BY d.display_order NULLS LAST, pos.rank_order DESC NULLS LAST, p.name`
    )
  );
  const deptMap = new Map<string, ContractTreeDept>();
  const resigned: ContractTreeEmployee[] = [];
  for (const r of rows) {
    const emp: ContractTreeEmployee = {
      employeeId: String(r.employee_id),
      name: String(r.name),
      positionName: r.position_name ? String(r.position_name) : null,
      contractCount: Number(r.contract_count ?? 0),
    };
    if (r.status !== "active") {
      resigned.push(emp);
      continue;
    }
    const deptId = String(r.dept_id ?? "none");
    const dept = deptMap.get(deptId) ?? {
      deptId,
      deptName: r.dept_name ? String(r.dept_name) : "부서 미지정",
      employees: [],
    };
    dept.employees.push(emp);
    deptMap.set(deptId, dept);
  }
  return { depts: [...deptMap.values()], resigned };
}

/** 직원별 계약 카드 목록(시간 역순) */
export async function listContracts(employeeId: string): Promise<LaborContractCard[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT contract_id, employee_id, kind, tag, contract_date, effective_from, effective_to,
              position_name, duty, first_hired_at, annual_salary, monthly_salary,
              wage_components, probation, source, status, note,
              extraction_meta->>'confidence' AS confidence,
              (file_storage_key IS NOT NULL)::int AS has_file
         FROM labor_contracts
        WHERE employee_id = $1 AND status <> 'void'
        ORDER BY contract_date DESC NULLS LAST, created_at DESC`,
      [employeeId]
    )
  );
  return rows.map((r) => ({
    contractId: String(r.contract_id),
    employeeId: String(r.employee_id),
    kind: String(r.kind),
    tag: r.tag ? String(r.tag) : null,
    contractDate: r.contract_date ? String(r.contract_date) : null,
    effectiveFrom: r.effective_from ? String(r.effective_from) : null,
    effectiveTo: r.effective_to ? String(r.effective_to) : null,
    positionName: r.position_name ? String(r.position_name) : null,
    duty: r.duty ? String(r.duty) : null,
    firstHiredAt: r.first_hired_at ? String(r.first_hired_at) : null,
    annualSalary: toNum(r.annual_salary),
    monthlySalary: toNum(r.monthly_salary),
    wageComponents: (r.wage_components ?? {}) as Record<string, number>,
    probation: Number(r.probation ?? 0) === 1,
    source: String(r.source),
    status: String(r.status),
    note: r.note ? String(r.note) : null,
    confidence: r.confidence ? String(r.confidence) : null,
    hasFile: Number(r.has_file ?? 0) === 1,
  }));
}

/** 검수 수정 — 추출값 보정 후 저장(검수 완료 시 note 비움) */
export async function updateContract(
  contractId: string,
  patch: {
    contractDate?: string | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    positionName?: string | null;
    duty?: string | null;
    firstHiredAt?: string | null;
    annualSalary?: number | null;
    monthlySalary?: number | null;
    wageComponents?: Record<string, number>;
    tag?: string | null;
    reviewed?: boolean;
  }
): Promise<void> {
  await withDbWrite(async (db) => {
    await db.exec(
      `UPDATE labor_contracts SET
         contract_date = COALESCE($2, contract_date),
         effective_from = COALESCE($3, effective_from),
         effective_to = COALESCE($4, effective_to),
         position_name = COALESCE($5, position_name),
         duty = COALESCE($6, duty),
         first_hired_at = COALESCE($7, first_hired_at),
         annual_salary = COALESCE($8, annual_salary),
         monthly_salary = COALESCE($9, monthly_salary),
         wage_components = COALESCE($10::jsonb, wage_components),
         tag = COALESCE($11, tag),
         note = CASE WHEN $12 THEN NULL ELSE note END,
         updated_at = now()::text
       WHERE contract_id = $1`,
      [
        contractId,
        patch.contractDate ?? null,
        patch.effectiveFrom ?? null,
        patch.effectiveTo ?? null,
        patch.positionName ?? null,
        patch.duty ?? null,
        patch.firstHiredAt ?? null,
        patch.annualSalary ?? null,
        patch.monthlySalary ?? null,
        patch.wageComponents ? JSON.stringify(patch.wageComponents) : null,
        patch.tag ?? null,
        patch.reviewed ?? false,
      ]
    );
  });
}

/** 앱 생성 계약 개별 삭제(테스트·오기 제거) — generated & 미서명만. 라운드에 계약이 안 남으면 라운드도 정리. */
export async function deleteContract(contractId: string): Promise<void> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT source, status, round_id FROM labor_contracts WHERE contract_id = $1`, [contractId])
  );
  const r = rows[0];
  if (!r) throw Object.assign(new Error("계약을 찾을 수 없습니다."), { status: 404 });
  if (String(r.source) !== "generated") {
    throw Object.assign(new Error("가져온(스캔) 계약은 삭제할 수 없습니다."), { status: 400 });
  }
  if (String(r.status) === "signed") {
    throw Object.assign(new Error("서명 완료된 계약은 삭제할 수 없습니다."), { status: 400 });
  }
  const roundId = r.round_id ? String(r.round_id) : null;
  await withDbWrite(async (txn) => {
    await txn.exec(`DELETE FROM labor_contracts WHERE contract_id = $1`, [contractId]);
    if (roundId) {
      await txn.exec(
        `DELETE FROM labor_contract_rounds r WHERE r.round_id = $1
           AND NOT EXISTS (SELECT 1 FROM labor_contracts c WHERE c.round_id = $1)`,
        [roundId]
      );
    }
  });
}

/** 파일 스토리지 위치 조회(다운로드 스트림용) */
export async function getContractFile(contractId: string): Promise<{
  bucket: string;
  key: string;
  fileName: string;
} | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.file_storage_bucket, c.file_storage_key, c.contract_date, p.name
         FROM labor_contracts c
         JOIN employee_profiles p ON p.employee_id = c.employee_id
        WHERE c.contract_id = $1`,
      [contractId]
    )
  );
  const r = rows[0];
  if (!r || !r.file_storage_key) return null;
  return {
    bucket: String(r.file_storage_bucket),
    key: String(r.file_storage_key),
    fileName: `${r.name} 근로계약서(${r.contract_date ?? ""}).pdf`,
  };
}
