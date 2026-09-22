import ExcelJS from "exceljs";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { maskRrnPrefix } from "@/lib/security/pii-crypto";

/**
 * 수당 지급 규칙 + 직원 원천징수 설정 (PL-P4, 블루프린트 §6-2 A·B)
 * - 규칙: 자격증·주거비·숙박·육아·장기근속·명절상여·학자금상환 등 직원×항목 정액(기간·지급월 제한).
 * - 세액 프로필: 원천징수 비율(80/100/120)·공제대상가족수·8~20세 자녀수.
 *   초기 적재는 세무사 소득세액공제신고서 엑셀(1-1시트) 파싱(importTaxForm).
 */

export interface PayRule {
  ruleId: string;
  employeeId: string;
  employeeName?: string;
  itemId: string;
  itemName?: string;
  amount: number;
  validFrom: string | null; // YYYY-MM
  validTo: string | null;
  payMonths: number[] | null;
  note: string | null;
  isActive: boolean;
}

export interface TaxProfile {
  employeeId: string;
  employeeName?: string;
  withholdingRate: number;
  dependents: number;
  childDeduction: number;
  /** 특수관계인(대표 친족 등) — 고용·산재 가입 제외 관행이라 고용보험 산출에서 제외 */
  specialRelation: boolean;
  dependentsDetail: Array<{ relation: string; name: string; rrnPrefix: string | null }> | null;
  source: string | null;
  note: string | null;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function listRules(): Promise<PayRule[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.*, p.name AS employee_name, d.name AS item_name
         FROM payroll_pay_rules r
         JOIN employee_profiles p ON p.employee_id = r.employee_id
         JOIN payroll_item_defs d ON d.item_id = r.item_id
        ORDER BY p.name, d.display_order`
    )
  );
  return rows.map((r) => ({
    ruleId: String(r.rule_id),
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    itemId: String(r.item_id),
    itemName: String(r.item_name),
    amount: toNum(r.amount),
    validFrom: r.valid_from ? String(r.valid_from) : null,
    validTo: r.valid_to ? String(r.valid_to) : null,
    payMonths: Array.isArray(r.pay_months) ? (r.pay_months as number[]) : null,
    note: r.note ? String(r.note) : null,
    isActive: Number(r.is_active ?? 1) === 1,
  }));
}

export async function saveRule(
  rule: Omit<PayRule, "ruleId" | "employeeName" | "itemName"> & { ruleId?: string | null },
  actorUserId: string
): Promise<string> {
  if (!Number.isSafeInteger(rule.amount)) {
    throw Object.assign(new Error("수당 규칙 금액은 유한한 정수 원 단위로 입력하세요. 지급 중단은 0원으로 명시하세요."), { status: 400 });
  }
  const now = new Date().toISOString();
  const ruleId = rule.ruleId || newId("prule");
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO payroll_pay_rules
         (rule_id, employee_id, item_id, amount, valid_from, valid_to, pay_months, note, is_active, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$11)
       ON CONFLICT (rule_id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id, item_id = EXCLUDED.item_id, amount = EXCLUDED.amount,
         valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, pay_months = EXCLUDED.pay_months,
         note = EXCLUDED.note, is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at`,
      [
        ruleId, rule.employeeId, rule.itemId, rule.amount,
        rule.validFrom, rule.validTo,
        rule.payMonths ? JSON.stringify(rule.payMonths) : null,
        rule.note, rule.isActive ? 1 : 0, actorUserId, now,
      ]
    );
  });
  return ruleId;
}

export async function deleteRule(ruleId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.exec(`DELETE FROM payroll_pay_rules WHERE rule_id = $1`, [ruleId]);
  });
}

/** 규칙 일괄 삭제(항목별 설정의 묶음 삭제) */
export async function deleteRules(ruleIds: string[]): Promise<number> {
  if (!ruleIds.length) return 0;
  await withDbWrite(async (db) => {
    await db.exec(`DELETE FROM payroll_pay_rules WHERE rule_id = ANY($1::text[])`, [ruleIds]);
  });
  return ruleIds.length;
}

/**
 * 항목별 설정(§ 항목 → 대상자 N명) — 같은 항목·금액·기간·지급월·비고로 직원별 규칙을 한 번에 만든다.
 * 같은 직원·항목에 활성 규칙이 이미 있으면 그 규칙을 갱신(중복 생성 방지)하고, 없으면 새로 만든다.
 * 반환: 생성/갱신된 rule_id 목록.
 */
export async function saveRulesBulk(
  rule: {
    employeeIds: string[];
    itemId: string;
    amount: number;
    validFrom: string | null;
    validTo: string | null;
    payMonths: number[] | null;
    note: string | null;
  },
  actorUserId: string
): Promise<{ ruleIds: string[]; created: number; updated: number }> {
  const employeeIds = [...new Set(rule.employeeIds.map(String).filter(Boolean))];
  if (!employeeIds.length) return { ruleIds: [], created: 0, updated: 0 };
  const db = await getDb();
  const existing = rowsToObjects(
    await db.exec(
      `SELECT rule_id, employee_id FROM payroll_pay_rules
        WHERE item_id = $1 AND is_active = 1 AND employee_id = ANY($2::text[])
          AND COALESCE(valid_from, '') = COALESCE($3, '') AND COALESCE(valid_to, '') = COALESCE($4, '')`,
      [rule.itemId, employeeIds, rule.validFrom, rule.validTo]
    )
  );
  const byEmp = new Map(existing.map((r) => [String(r.employee_id), String(r.rule_id)]));
  const ruleIds: string[] = [];
  let created = 0;
  let updated = 0;
  for (const employeeId of employeeIds) {
    const prior = byEmp.get(employeeId) ?? null;
    const ruleId = await saveRule(
      {
        ruleId: prior,
        employeeId,
        itemId: rule.itemId,
        amount: rule.amount,
        validFrom: rule.validFrom,
        validTo: rule.validTo,
        payMonths: rule.payMonths,
        note: rule.note,
        isActive: true,
      },
      actorUserId
    );
    ruleIds.push(ruleId);
    if (prior) updated += 1;
    else created += 1;
  }
  return { ruleIds, created, updated };
}

/** 귀속월 유효 규칙. 0원도 명시 규칙으로 보존하고, 같은 직원·항목의 상충 금액은 생성 전에 차단한다. */
export async function activeRulesFor(payYear: number, payMonth: number, database?: PgDatabase, employeeIds?: readonly string[]): Promise<Map<string, Array<{ itemId: string; amount: number }>>> {
  const ym = `${payYear}-${String(payMonth).padStart(2, "0")}`;
  const db = database ?? await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, item_id, amount, pay_months FROM payroll_pay_rules
        WHERE is_active = 1
          AND (valid_from IS NULL OR valid_from <= $1)
          AND (valid_to IS NULL OR valid_to >= $1)
        ORDER BY employee_id, item_id, rule_id`,
      [ym]
    )
  );
  const map = new Map<string, Array<{ itemId: string; amount: number }>>();
  const targets = employeeIds ? new Set(employeeIds) : null;
  for (const r of rows) {
    const key = String(r.employee_id);
    if (targets && !targets.has(key)) continue;
    const months = Array.isArray(r.pay_months) ? (r.pay_months as number[]) : null;
    if (months && !months.includes(payMonth)) continue;
    const itemId = String(r.item_id);
    // Do not let the generic number fallback turn corrupt/non-finite stored amounts into stop rules.
    const amount = Number(r.amount);
    if (!Number.isSafeInteger(amount)) {
      throw Object.assign(new Error(`${ym} 수당 규칙의 금액이 올바르지 않습니다. 직원 ${key}·항목 ${itemId}의 규칙을 확인하세요.`), { status: 409 });
    }
    const list = map.get(key) ?? [];
    const previous = list.find((rule) => rule.itemId === itemId);
    if (previous) {
      if (previous.amount !== amount) {
        throw Object.assign(new Error(`${ym}에 서로 다른 금액의 수당 규칙이 겹칩니다. 직원 ${key}·항목 ${itemId}의 기간·지급월을 정리한 뒤 다시 생성하세요.`), { status: 409 });
      }
      continue; // Identical overlapping rules have one effect, including an explicit zero.
    }
    list.push({ itemId, amount });
    map.set(key, list);
  }
  return map;
}

export async function listTaxProfiles(): Promise<TaxProfile[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.employee_id, p.name AS employee_name, t.withholding_rate, t.dependents,
              t.child_deduction, t.special_relation, t.dependents_detail, t.source, t.note
         FROM employee_profiles p
         LEFT JOIN payroll_tax_profiles t ON t.employee_id = p.employee_id
        WHERE p.status = 'active'
        ORDER BY p.name`
    )
  );
  return rows.map((r) => ({
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    withholdingRate: r.withholding_rate == null ? 100 : Number(r.withholding_rate),
    dependents: r.dependents == null ? 1 : Number(r.dependents),
    childDeduction: r.child_deduction == null ? 0 : Number(r.child_deduction),
    specialRelation: Number(r.special_relation ?? 0) === 1,
    dependentsDetail: Array.isArray(r.dependents_detail)
      ? (r.dependents_detail as TaxProfile["dependentsDetail"])
      : null,
    source: r.source ? String(r.source) : null,
    note: r.note ? String(r.note) : null,
  }));
}

export async function saveTaxProfile(profile: {
  employeeId: string;
  withholdingRate: number;
  dependents: number;
  childDeduction: number;
  specialRelation?: boolean;
  dependentsDetail?: TaxProfile["dependentsDetail"];
  source?: string;
  note?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO payroll_tax_profiles
         (employee_id, withholding_rate, dependents, child_deduction, special_relation, dependents_detail, source, note, updated_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,0),$6::jsonb,$7,$8,$9)
       ON CONFLICT (employee_id) DO UPDATE SET
         withholding_rate = EXCLUDED.withholding_rate, dependents = EXCLUDED.dependents,
         child_deduction = EXCLUDED.child_deduction,
         special_relation = CASE WHEN $5::integer IS NULL THEN payroll_tax_profiles.special_relation ELSE $5::integer END,
         dependents_detail = COALESCE(EXCLUDED.dependents_detail, payroll_tax_profiles.dependents_detail),
         source = EXCLUDED.source, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
      [
        profile.employeeId, profile.withholdingRate, profile.dependents, profile.childDeduction,
        profile.specialRelation == null ? null : profile.specialRelation ? 1 : 0,
        profile.dependentsDetail ? JSON.stringify(profile.dependentsDetail) : null,
        profile.source ?? "manual", profile.note ?? null, now,
      ]
    );
  });
}

const RRN_RE = /^\d{6}-?\d{0,7}/;

/**
 * 세무사 소득세액공제신고서 엑셀(1-1시트) 파싱 — E4 성명, E11 비율 체크, C20~D31 명부.
 * 파일별 셀 밀림이 있어 명부는 행 스캔(관계코드 숫자 + 성명/주민번호 패턴)으로 견고하게 추출.
 */
export async function parseTaxForm(buf: Buffer): Promise<{
  name: string | null;
  ratePct: number | null;
  dependents: Array<{ relation: string; name: string; rrnPrefix: string | null }>;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw Object.assign(new Error("엑셀 시트를 읽을 수 없습니다."), { status: 400 });

  const cellText = (r: number, c: number): string => {
    const v = ws.getRow(r).getCell(c).value;
    if (v == null) return "";
    if (typeof v === "object" && "richText" in (v as object)) {
      return ((v as ExcelJS.CellRichTextValue).richText ?? []).map((t) => t.text).join("");
    }
    return String(v);
  };

  const name = cellText(4, 5).trim() || null; // E4

  // E11 근처에서 원천징수 비율 체크 탐색: "[V]100%" / "[■]80%" 등
  let ratePct: number | null = null;
  for (let r = 9; r <= 13 && ratePct == null; r++) {
    for (let c = 3; c <= 10; c++) {
      const t = cellText(r, c);
      if (!t.includes("%") || !t.includes("120")) continue;
      const m = t.match(/\[\s*[^\s\]]+\s*\]\s*(\d{2,3})\s*%/);
      if (m) ratePct = Number(m[1]);
      break;
    }
  }

  // 명부: 15~34행 스캔 — 관계코드(0~8 한 자리)와 성명 행, 아랫행(또는 같은 행 밀림) 주민번호
  const dependents: Array<{ relation: string; name: string; rrnPrefix: string | null }> = [];
  for (let r = 15; r <= 36; r++) {
    for (let c = 2; c <= 5; c++) {
      const code = cellText(r, c).trim();
      if (!/^[0-8]$/.test(code)) continue;
      // 같은 행 오른쪽에서 성명 탐색
      let depName = "";
      for (let cc = c + 1; cc <= c + 3; cc++) {
        const t = cellText(r, cc).trim();
        if (t && !RRN_RE.test(t) && !t.startsWith("(")) { depName = t; break; }
      }
      if (!depName) continue;
      // 주민번호: 같은 열 아래 1~2행에서 탐색
      let rrn: string | null = null;
      for (let rr = r; rr <= r + 2 && !rrn; rr++) {
        for (let cc = c + 1; cc <= c + 4; cc++) {
          const t = cellText(rr, cc).trim();
          if (/^\d{6}-?\d{7}$/.test(t)) { rrn = t.slice(0, 6); break; }
        }
      }
      // 데이터 최소화(PR-P3) — 부양가족 주민번호 앞자리는 생년 2자리만 보존(자녀 나이 판정에 충분).
      dependents.push({ relation: code, name: depName, rrnPrefix: maskRrnPrefix(rrn) });
      break;
    }
  }
  return { name, ratePct, dependents };
}

/** 공제신고서 업로드 → 세액 프로필 upsert. 반환: 매칭 결과. */
export async function importTaxForm(buf: Buffer): Promise<{
  employeeName: string | null;
  matched: boolean;
  dependents: number;
  ratePct: number;
  detail: Array<{ relation: string; name: string; rrnPrefix: string | null }>;
}> {
  const parsed = await parseTaxForm(buf);
  if (!parsed.name) {
    throw Object.assign(new Error("신고서에서 소득자 성명을 찾지 못했습니다(E4)."), { status: 400 });
  }
  const db = await getDb();
  const emp = rowsToObjects(
    await db.exec(`SELECT employee_id FROM employee_profiles WHERE status='active' AND name = $1`, [parsed.name])
  )[0];
  const dependents = Math.max(1, parsed.dependents.length); // 본인 포함 등재 인원
  const ratePct = parsed.ratePct ?? 100;
  // 8~20세 자녀수: 직계비속(관계코드 4·5) 생년(주민 앞 2자리)으로 자동 판정
  const nowYear = new Date().getFullYear();
  const children = parsed.dependents.filter((d) => {
    if (d.relation !== "4" && d.relation !== "5") return false;
    if (!d.rrnPrefix) return false;
    const yy = Number(d.rrnPrefix.slice(0, 2));
    const birthYear = yy <= nowYear % 100 ? 2000 + yy : 1900 + yy;
    const age = nowYear - birthYear;
    return age >= 8 && age <= 20;
  }).length;
  if (emp) {
    await saveTaxProfile({
      employeeId: String(emp.employee_id),
      withholdingRate: ratePct,
      dependents,
      childDeduction: children,
      dependentsDetail: parsed.dependents,
      source: "tax-form-import",
    });
  }
  return { employeeName: parsed.name, matched: !!emp, dependents, ratePct, detail: parsed.dependents };
}
