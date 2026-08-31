import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { saveDoc } from "@/lib/approval/docs";
import { sendMail } from "@/lib/mail/send";

/**
 * 근로계약 작성/갱신 라운드 (PL-P3, 블루프린트 §4-2·§5-2·§5-3)
 * - annual: 전 직원 일괄 갱신 — 갱신연봉 = 현행 × (1 + 물가상승률% + 추가보정%),
 *   월급여 천원 미만 절사 후 ×12(§8-5). 인상분은 기본급으로 반영(고정수당 유지).
 * - promotion: 개별 승진 — 1인 라운드.
 * - 결재 게이트: frm-labor-contract 기안(대표이사 직결) → approval_docs.status='approved'
 *   전까지 발송 불가(bonus 와 달리 시스템 강제).
 */

export const CONTRACT_FORM_ID = "frm-labor-contract";
const EXEC_RANK_CUTOFF = 82; // bonus/shared.ts 와 동일 기준

export interface RoundSummary {
  roundId: string;
  roundKind: string;
  baseDate: string;
  baseYear: number;
  cpiRate: number | null;
  extraRate: number | null;
  scope: string;
  status: string;
  approvalDocId: string | null;
  approvalDocNo: string | null;
  contractCount: number;
  signedCount: number;
  sentCount: number;
  /** 라운드 대상자 이름(진행 현황 카드 표시용) */
  employeeNames: string[];
  createdAt: string;
}

export interface AnnualPreviewRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  currentSalary: number | null;
  newMonthly: number | null;
  newSalary: number | null;
  raisePct: number | null;
  excluded: string | null; // 제외 사유(현행 계약 없음 등)
}

/** 일괄 갱신 인원별 예외 산정(§4-2 미리보기 '예외' 열) — mode=rate 는 %, amount 는 연봉 인상액(원) */
export interface AnnualOverride {
  mode: "rate" | "amount";
  value: number;
  reason: string; // 성과우수 | 성과부진 | 인사평가 우수 | 인사평가 미흡
  reasonDetail?: string;
}

/** 예외 산식 — 기본 산식과 동일하게 월급여 천원 미만 절사 후 ×12(§8-5) */
function applyOverride(currentSalary: number, ov: AnnualOverride): { newMonthly: number; newSalary: number } {
  const raised = ov.mode === "rate" ? currentSalary * (1 + ov.value / 100) : currentSalary + ov.value;
  const newMonthly = Math.floor(raised / 12 / 1000) * 1000;
  return { newMonthly, newSalary: newMonthly * 12 };
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function findCeoUserId(): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id
         FROM users u
         LEFT JOIN employee_profiles e1 ON e1.employee_id = u.employee_id
         LEFT JOIN employee_profiles e2 ON e2.user_id = u.user_id
        WHERE e1.position_id = 'ceo' OR e2.position_id = 'ceo'
        LIMIT 1`
    )
  );
  return rows[0]?.user_id ? String(rows[0].user_id) : null;
}

/** 직원별 현행(최신) 계약 조회 — void 제외, 작성일 최신 */
async function latestContracts(): Promise<Map<string, Record<string, unknown>>> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (employee_id)
              employee_id, contract_id, annual_salary, monthly_salary, wage_components, duty, work_hours
         FROM labor_contracts
        WHERE status <> 'void' AND annual_salary IS NOT NULL
        ORDER BY employee_id, contract_date DESC NULLS LAST, created_at DESC`
    )
  );
  return new Map(rows.map((r) => [String(r.employee_id), r]));
}

/** 라운드 목록 + 연도별 비율 이력(5개년 그래프 데이터) */
export async function listRounds(): Promise<RoundSummary[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.*,
              count(c.contract_id) AS contract_count,
              count(c.contract_id) FILTER (WHERE c.status = 'signed') AS signed_count,
              count(c.contract_id) FILTER (WHERE c.status IN ('sent','signed')) AS sent_count,
              array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL) AS employee_names,
              d.doc_no AS approval_doc_no
         FROM labor_contract_rounds r
         LEFT JOIN labor_contracts c ON c.round_id = r.round_id
         LEFT JOIN employee_profiles p ON p.employee_id = c.employee_id
         LEFT JOIN approval_docs d ON d.doc_id = r.approval_doc_id
        GROUP BY r.round_id, d.doc_no
        ORDER BY r.base_date DESC`
    )
  );
  return rows.map((r) => ({
    roundId: String(r.round_id),
    roundKind: String(r.round_kind),
    baseDate: String(r.base_date),
    baseYear: Number(r.base_year),
    cpiRate: toNum(r.cpi_rate),
    extraRate: toNum(r.extra_rate),
    scope: String(r.scope),
    status: String(r.status),
    approvalDocId: r.approval_doc_id ? String(r.approval_doc_id) : null,
    approvalDocNo: r.approval_doc_no ? String(r.approval_doc_no) : null,
    contractCount: Number(r.contract_count ?? 0),
    signedCount: Number(r.signed_count ?? 0),
    sentCount: Number(r.sent_count ?? 0),
    employeeNames: Array.isArray(r.employee_names) ? r.employee_names.map(String) : [],
    createdAt: String(r.created_at ?? ""),
  }));
}

/** 일괄 갱신 미리보기 — 대상 재직자별 현행→갱신 */
export async function previewAnnual(
  cpiRate: number,
  extraRate: number,
  scope: "exclude_exec" | "all"
): Promise<AnnualPreviewRow[]> {
  const db = await getDb();
  const employees = rowsToObjects(
    await db.exec(
      `SELECT p.employee_id, p.name, d.dept_name, pos.position_name, pos.rank_order
         FROM employee_profiles p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
        WHERE p.status = 'active'
        ORDER BY d.display_order NULLS LAST, pos.rank_order DESC NULLS LAST, p.name`
    )
  );
  const latest = await latestContracts();
  const rate = 1 + (cpiRate + extraRate) / 100;

  return employees
    .filter((e) => scope === "all" || toNum(e.rank_order) == null || Number(e.rank_order) < EXEC_RANK_CUTOFF)
    .map((e) => {
      const cur = latest.get(String(e.employee_id));
      const currentSalary = cur ? toNum(cur.annual_salary) : null;
      if (!currentSalary) {
        return {
          employeeId: String(e.employee_id),
          name: String(e.name),
          deptName: e.dept_name ? String(e.dept_name) : null,
          positionName: e.position_name ? String(e.position_name) : null,
          currentSalary: null, newMonthly: null, newSalary: null, raisePct: null,
          excluded: "현행 계약(연봉) 없음 — 검수 후 재시도 또는 개별 작성",
        };
      }
      // 월급여 천원 미만 절사 → ×12 (§8-5)
      const newMonthly = Math.floor((currentSalary * rate) / 12 / 1000) * 1000;
      const newSalary = newMonthly * 12;
      return {
        employeeId: String(e.employee_id),
        name: String(e.name),
        deptName: e.dept_name ? String(e.dept_name) : null,
        positionName: e.position_name ? String(e.position_name) : null,
        currentSalary,
        newMonthly,
        newSalary,
        raisePct: ((newSalary - currentSalary) / currentSalary) * 100,
        excluded: null,
      };
    });
}

/** wage_components 갱신 — 고정수당 유지, 기본급으로 조정 */
function rebuildWage(prev: Record<string, number> | null, newMonthly: number): Record<string, number> {
  const wage = { ...(prev ?? {}) };
  const others = Object.entries(wage)
    .filter(([k]) => k !== "기본급")
    .reduce((a, [, v]) => a + Number(v || 0), 0);
  wage["기본급"] = Math.max(0, newMonthly - others);
  return wage;
}

/** 일괄 갱신 라운드 + draft 계약 일괄 생성. overrides 지정 인원은 예외 산식 적용(§4-2 예외 산정). */
export async function createAnnualRound(params: {
  baseDate: string; // YYYY-MM-DD (기본 매년 1/1)
  cpiRate: number;
  extraRate: number;
  scope: "exclude_exec" | "all";
  overrides?: Record<string, AnnualOverride>;
  actorUserId: string;
}): Promise<{ roundId: string; created: number; skipped: number }> {
  const preview = await previewAnnual(params.cpiRate, params.extraRate, params.scope);
  const targets = preview.filter((r) => !r.excluded);
  if (!targets.length) throw Object.assign(new Error("대상 직원이 없습니다."), { status: 400 });

  const overrides = params.overrides ?? {};
  for (const t of targets) {
    const ov = overrides[t.employeeId];
    if (!ov || t.currentSalary == null) continue;
    const applied = applyOverride(t.currentSalary, ov);
    t.newMonthly = applied.newMonthly;
    t.newSalary = applied.newSalary;
    t.raisePct = ((applied.newSalary - t.currentSalary) / t.currentSalary) * 100;
  }

  const latest = await latestContracts();
  const baseYear = Number(params.baseDate.slice(0, 4));
  const effectiveTo = `${baseYear}-12-31`;
  const roundId = newId("lcr");
  const now = new Date().toISOString();

  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO labor_contract_rounds
         (round_id, round_kind, base_date, base_year, cpi_rate, extra_rate, scope, overrides, status, created_by, created_at, updated_at)
       VALUES ($1,'annual',$2,$3,$4,$5,$6,$7::jsonb,'draft',$8,$9,$9)`,
      [
        roundId, params.baseDate, baseYear, params.cpiRate, params.extraRate, params.scope,
        Object.keys(overrides).length ? JSON.stringify(overrides) : null,
        params.actorUserId, now,
      ]
    );
    for (const t of targets) {
      const cur = latest.get(t.employeeId);
      const wage = rebuildWage((cur?.wage_components ?? null) as Record<string, number> | null, t.newMonthly!);
      const empRows = rowsToObjects(
        await db.exec(
          `SELECT p.hired_at, pos.position_name FROM employee_profiles p
            LEFT JOIN positions pos ON pos.position_id = p.position_id WHERE p.employee_id = $1`,
          [t.employeeId]
        )
      );
      await db.exec(
        `INSERT INTO labor_contracts
           (contract_id, employee_id, kind, tag, contract_date, effective_from, effective_to,
            position_name, duty, first_hired_at, annual_salary, monthly_salary, wage_components,
            work_hours, probation, source, template_version, status, round_id, created_by, created_at, updated_at)
         VALUES ($1,$2,'regular','일반',$3,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,0,'generated',1,'draft',$12,$13,$14,$14)`,
        [
          newId("lc"),
          t.employeeId,
          params.baseDate,
          effectiveTo,
          empRows[0]?.position_name ? String(empRows[0].position_name) : t.positionName,
          cur?.duty ? String(cur.duty) : null,
          empRows[0]?.hired_at ? String(empRows[0].hired_at) : null,
          t.newSalary,
          t.newMonthly,
          JSON.stringify(wage),
          JSON.stringify(cur?.work_hours ?? null),
          roundId,
          params.actorUserId,
          now,
        ]
      );
    }
  });
  return { roundId, created: targets.length, skipped: preview.length - targets.length };
}

/** 개별(승진) 라운드 + draft 계약 1건 */
export async function createPromotionRound(params: {
  employeeId: string;
  baseDate: string;
  newPositionName: string;
  newMonthly: number; // 승급 반영 월급여(천원 절사는 호출측 UI 에서 안내, 서버도 절사)
  actorUserId: string;
}): Promise<{ roundId: string; contractId: string }> {
  const db = await getDb();
  const empRows = rowsToObjects(
    await db.exec(
      `SELECT p.name, p.hired_at FROM employee_profiles p WHERE p.employee_id = $1 AND p.status = 'active'`,
      [params.employeeId]
    )
  );
  if (!empRows.length) throw Object.assign(new Error("재직자를 찾을 수 없습니다."), { status: 404 });
  const latest = (await latestContracts()).get(params.employeeId);

  const newMonthly = Math.floor(params.newMonthly / 1000) * 1000;
  const newSalary = newMonthly * 12;
  const baseYear = Number(params.baseDate.slice(0, 4));
  const roundId = newId("lcr");
  const contractId = newId("lc");
  const now = new Date().toISOString();
  const wage = rebuildWage((latest?.wage_components ?? null) as Record<string, number> | null, newMonthly);

  await withDbWrite(async (txn) => {
    await txn.exec(
      `INSERT INTO labor_contract_rounds
         (round_id, round_kind, base_date, base_year, scope, status, created_by, created_at, updated_at)
       VALUES ($1,'promotion',$2,$3,'all','draft',$4,$5,$5)`,
      [roundId, params.baseDate, baseYear, params.actorUserId, now]
    );
    await txn.exec(
      `INSERT INTO labor_contracts
         (contract_id, employee_id, kind, tag, contract_date, effective_from, effective_to,
          position_name, duty, first_hired_at, annual_salary, monthly_salary, wage_components,
          work_hours, probation, source, template_version, status, round_id, created_by, created_at, updated_at)
       VALUES ($1,$2,'promotion','승진',$3,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,0,'generated',1,'draft',$12,$13,$14,$14)`,
      [
        contractId,
        params.employeeId,
        params.baseDate,
        `${baseYear}-12-31`,
        params.newPositionName,
        latest?.duty ? String(latest.duty) : null,
        empRows[0]?.hired_at ? String(empRows[0].hired_at) : null,
        newSalary,
        newMonthly,
        JSON.stringify(wage),
        JSON.stringify(latest?.work_hours ?? null),
        roundId,
        params.actorUserId,
        now,
      ]
    );
  });
  return { roundId, contractId };
}

/** 라운드 기안 생성 — 대표이사 직결. 상신은 기안 화면에서 사용자가 직접(bonus 관례). */
export async function createRoundDraft(roundId: string, actorUserId: string): Promise<{ docId: string }> {
  const db = await getDb();
  const roundRows = rowsToObjects(
    await db.exec(`SELECT * FROM labor_contract_rounds WHERE round_id = $1`, [roundId])
  );
  const round = roundRows[0];
  if (!round) throw Object.assign(new Error("라운드를 찾을 수 없습니다."), { status: 404 });
  const contracts = rowsToObjects(
    await db.exec(
      `SELECT c.employee_id, c.annual_salary, c.position_name, p.name, d.dept_name,
              (SELECT c2.annual_salary FROM labor_contracts c2
                WHERE c2.employee_id = c.employee_id AND c2.contract_id <> c.contract_id
                  AND c2.status <> 'void' AND c2.annual_salary IS NOT NULL
                ORDER BY c2.contract_date DESC NULLS LAST LIMIT 1) AS prev_salary
         FROM labor_contracts c
         JOIN employee_profiles p ON p.employee_id = c.employee_id
         LEFT JOIN departments d ON d.dept_id = p.dept_id
        WHERE c.round_id = $1
        ORDER BY p.name`,
      [roundId]
    )
  );
  if (!contracts.length) throw Object.assign(new Error("라운드에 계약이 없습니다."), { status: 400 });
  const ceoUserId = await findCeoUserId();
  if (!ceoUserId) throw Object.assign(new Error("대표이사 계정을 찾을 수 없습니다."), { status: 400 });

  const isAnnual = String(round.round_kind) === "annual";
  const fmt = (v: number) => Math.round(v).toLocaleString("ko-KR");
  // 예외 산정 인원 요약 — 결재자가 기안 비고에서 확인
  const overrides = (round.overrides ?? {}) as Record<string, AnnualOverride>;
  const nameByEmp = new Map(contracts.map((c) => [String(c.employee_id), String(c.name)]));
  const overrideNote = Object.entries(overrides)
    .map(([empId, ov]) => {
      const label = ov.mode === "rate" ? `${ov.value}%` : `${fmt(ov.value)}원`;
      const detail = ov.reasonDetail ? ` — ${ov.reasonDetail}` : "";
      return `${nameByEmp.get(empId) ?? empId}: ${ov.reason} ${label}${detail}`;
    })
    .join(" / ");
  const docId = await saveDoc({
    docId: null,
    formId: CONTRACT_FORM_ID,
    title: `${String(round.base_date).slice(0, 4)}년 근로계약서 ${isAnnual ? "일괄 갱신" : "승진 작성"} 계획`,
    urgent: false,
    fieldValues: {
      roundKind: isAnnual ? "연간 일괄 갱신" : "개별(승진)",
      baseDate: String(round.base_date),
      headcount: contracts.length,
      cpiRate: round.cpi_rate != null ? `${round.cpi_rate}` : "-",
      extraRate: round.extra_rate != null ? `${round.extra_rate}` : "-",
      scope: String(round.scope) === "all" ? "전체" : "임원 제외",
      rows: contracts.map((c) => {
        const cur = toNum(c.annual_salary) ?? 0;
        const prev = toNum(c.prev_salary);
        return {
          name: String(c.name),
          dept: c.dept_name ? String(c.dept_name) : "-",
          position: c.position_name ? String(c.position_name) : "-",
          currentSalary: prev != null ? fmt(prev) : "-",
          newSalary: fmt(cur),
          raisePct: prev ? `${(((cur - prev) / prev) * 100).toFixed(1)}%` : "-",
        };
      }),
      note: overrideNote ? `예외 산정 적용: ${overrideNote}` : "",
    },
    line: [{ stepType: "approve", assigneeUserId: ceoUserId }],
    actorUserId,
  });

  await withDbWrite(async (txn) => {
    await txn.exec(
      `UPDATE labor_contract_rounds SET approval_doc_id = $2, status = 'pending_approval', updated_at = $3
        WHERE round_id = $1`,
      [roundId, docId, new Date().toISOString()]
    );
    await txn.exec(
      `UPDATE labor_contracts SET approval_doc_id = $2, status = 'pending_approval', updated_at = $3
        WHERE round_id = $1 AND status = 'draft'`,
      [roundId, docId, new Date().toISOString()]
    );
  });
  return { docId };
}

/** 결재 상태 동기화 — approval_docs.status='approved' 면 라운드 approved 전환 */
export async function syncRoundApproval(roundId: string): Promise<string> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.status AS round_status, d.status AS doc_status
         FROM labor_contract_rounds r
         LEFT JOIN approval_docs d ON d.doc_id = r.approval_doc_id
        WHERE r.round_id = $1`,
      [roundId]
    )
  );
  const r = rows[0];
  if (!r) throw Object.assign(new Error("라운드를 찾을 수 없습니다."), { status: 404 });
  const roundStatus = String(r.round_status);
  const docStatus = r.doc_status ? String(r.doc_status) : null;
  if (roundStatus === "pending_approval" && docStatus === "approved") {
    await withDbWrite(async (txn) => {
      await txn.exec(
        `UPDATE labor_contract_rounds SET status = 'approved', updated_at = $2 WHERE round_id = $1`,
        [roundId, new Date().toISOString()]
      );
      await txn.exec(
        `UPDATE labor_contracts SET status = 'approved', updated_at = $2
          WHERE round_id = $1 AND status = 'pending_approval'`,
        [roundId, new Date().toISOString()]
      );
    });
    return "approved";
  }
  if (roundStatus === "pending_approval" && docStatus === "rejected") {
    await withDbWrite(async (txn) => {
      await txn.exec(
        `UPDATE labor_contract_rounds SET status = 'draft', approval_doc_id = NULL, updated_at = $2 WHERE round_id = $1`,
        [roundId, new Date().toISOString()]
      );
      await txn.exec(
        `UPDATE labor_contracts SET status = 'draft', approval_doc_id = NULL, updated_at = $2
          WHERE round_id = $1 AND status = 'pending_approval'`,
        [roundId, new Date().toISOString()]
      );
    });
    return "draft";
  }
  return roundStatus;
}

/** 발송 — 결재 게이트(approved) 강제. 계약 sent 전환 + 직원 메일 통지(열람 링크만, §8-7). */
export async function sendRound(
  roundId: string,
  actorUserId: string,
  appBaseUrl: string
): Promise<{ sent: number; skipped: Array<{ name: string; reason: string }> }> {
  const status = await syncRoundApproval(roundId);
  if (status !== "approved" && status !== "sent") {
    throw Object.assign(
      new Error(status === "pending_approval" ? "대표이사 결재 완료 후 발송할 수 있습니다." : "기안·결재를 먼저 진행하세요."),
      { status: 400 }
    );
  }
  const db = await getDb();
  const contracts = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.status, p.name, p.email
         FROM labor_contracts c
         JOIN employee_profiles p ON p.employee_id = c.employee_id
        WHERE c.round_id = $1 AND c.status IN ('approved','sent')`,
      [roundId]
    )
  );
  const now = new Date().toISOString();
  let sent = 0;
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const c of contracts) {
    if (String(c.status) === "sent") continue; // 재발송 시 기존 sent 는 유지
    await withDbWrite(async (txn) => {
      await txn.exec(
        `UPDATE labor_contracts SET status = 'sent', sent_at = $2, updated_at = $2 WHERE contract_id = $1`,
        [String(c.contract_id), now]
      );
    });
    sent += 1;
    const email = c.email ? String(c.email) : null;
    if (!email) {
      skipped.push({ name: String(c.name), reason: "이메일 미등록(앱 수신함으로만 통지)" });
      continue;
    }
    // 메일에는 열람 링크만 — 계약서 PDF 는 첨부하지 않는다(임금 기밀, §8-7)
    const res = await sendMail({
      userId: actorUserId,
      to: [{ name: String(c.name), address: email }],
      subject: `[한국환경안전연구원] 근로계약서 서명 요청`,
      bodyHtml: `<p>${String(c.name)} 님, 새 근로계약서가 도착했습니다.</p>
<p>MCM 홈 화면의 <b>내 근로계약</b> 카드에서 내용을 확인하고 전자서명해 주세요.</p>
<p><a href="${appBaseUrl}/home">계약서 확인·서명 바로가기</a></p>
<p style="color:#888;font-size:12px">본 메일에는 보안상 계약서 파일이 첨부되지 않습니다. 앱에서 열람해 주세요.</p>`,
      idempotencyKey: `labor-contract-send:${roundId}:${String(c.contract_id)}`,
    });
    if (!res.ok) skipped.push({ name: String(c.name), reason: `메일 실패: ${res.error ?? ""}` });
  }

  await withDbWrite(async (txn) => {
    await txn.exec(
      `UPDATE labor_contract_rounds SET status = 'sent', updated_at = $2 WHERE round_id = $1`,
      [roundId, now]
    );
  });
  return { sent, skipped };
}

/** 라운드 삭제(테스트·오기 제거) — 서명 완료 계약이 있으면 불가. 연결 기안 문서는 남기고 링크만 해제. */
export async function deleteRound(roundId: string): Promise<{ deleted: number }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT count(*) FILTER (WHERE status = 'signed') AS signed_count, count(*) AS total
         FROM labor_contracts WHERE round_id = $1`,
      [roundId]
    )
  );
  if (!rows.length) throw Object.assign(new Error("라운드를 찾을 수 없습니다."), { status: 404 });
  if (Number(rows[0].signed_count ?? 0) > 0) {
    throw Object.assign(new Error("서명 완료된 계약이 있어 삭제할 수 없습니다."), { status: 400 });
  }
  const total = Number(rows[0].total ?? 0);
  await withDbWrite(async (txn) => {
    await txn.exec(`DELETE FROM labor_contracts WHERE round_id = $1`, [roundId]);
    await txn.exec(`DELETE FROM labor_contract_rounds WHERE round_id = $1`, [roundId]);
  });
  return { deleted: total };
}

/** 개별(승진) 패널 컨텍스트 — 현 직급 위 2단계 목록 + 승진 이력 + 현행 급여 */
export async function getPromotionContext(employeeId: string): Promise<{
  currentPosition: string | null;
  candidates: string[];
  history: Array<{ positionName: string; date: string }>;
  currentSalary: number | null;
  currentMonthly: number | null;
}> {
  const db = await getDb();
  const cur = rowsToObjects(
    await db.exec(
      `SELECT pos.position_name, pos.rank_order FROM employee_profiles p
        LEFT JOIN positions pos ON pos.position_id = p.position_id WHERE p.employee_id = $1`,
      [employeeId]
    )
  )[0];
  const rank = cur ? toNum(cur.rank_order) : null;
  const candidates = rank == null
    ? []
    : rowsToObjects(
        await db.exec(
          `SELECT position_name FROM positions
            WHERE rank_order > $1 AND is_active = 1
            ORDER BY rank_order ASC LIMIT 2`,
          [rank]
        )
      ).map((r) => String(r.position_name));

  // 승진 이력 = hr_events(promotion) + 계약서상 승진 태그
  const history = rowsToObjects(
    await db.exec(
      `SELECT position_name, event_date AS date FROM employee_hr_events
        WHERE employee_id = $1 AND event_type = 'promotion'
       UNION ALL
       SELECT position_name, contract_date AS date FROM labor_contracts
        WHERE employee_id = $1 AND tag = '승진' AND contract_date IS NOT NULL
       ORDER BY date DESC`,
      [employeeId]
    )
  ).map((r) => ({ positionName: String(r.position_name ?? "-"), date: String(r.date ?? "") }));

  const latest = (await latestContracts()).get(employeeId);
  return {
    currentPosition: cur?.position_name ? String(cur.position_name) : null,
    candidates,
    history,
    currentSalary: latest ? toNum(latest.annual_salary) : null,
    currentMonthly: latest ? toNum(latest.monthly_salary) : null,
  };
}
