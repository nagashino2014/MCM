import crypto from "node:crypto";
import JSZip from "jszip";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { resolveEmployeeId } from "@/lib/payroll/sign";
import { parseTaxForm } from "@/lib/payroll/rules";
import { parseSimplifiedPdf } from "@/lib/finance/yearend-pdf-parser";
import { listSettlements, saveSettlement, type YearendInputs, type YearendResult } from "@/lib/finance/yearend";
import { putContractDocument, readContractDocument, deleteContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { renderWithholdingReceiptPdf } from "@/lib/finance/withholding-receipt-pdf";

/*
 * 내 연말정산(직원 셀프서비스, 2026-09-14) — 관리자 전용이던 연말정산(P8)에 직원 대면 플로우를 붙인다.
 * - 자료 업로드: 소득·세액공제신고서 엑셀(세무사 서식) + 홈택스 간소화 PDF → S3(hr/yearend/…) 보관 + 파싱값 스냅.
 *   파싱값은 정산이 미확정이면 정산 입력(inputs)에 곧바로 반영돼 앱 자체 계산에 쓰이고, 파일은 세무사 제출용 묶음(zip)에 들어간다.
 *   ※ 월 급여 세액 프로필(payroll_tax_profiles)은 건드리지 않는다 — 급여 산정 파라미터는 관리자 검토 후 반영.
 * - 원천징수영수증: 세무법인 원본(yearend_settlements.pdf_key, 관리자 등록)이 있으면 그 파일, 없으면 앱 산출 요약본을 렌더.
 * - 발급 신청: 증명신청서 기안 화면으로 prefill(원천징수영수증 체크·귀속연도) 링크 — 결재선은 기안 화면에서 지정.
 */

export type YearendUploadKind = "simplified_pdf" | "deduction_form" | "other";

export const UPLOAD_KIND_LABEL: Record<YearendUploadKind, string> = {
  simplified_pdf: "홈택스 간소화 자료(PDF)",
  deduction_form: "소득·세액공제신고서(엑셀)",
  other: "기타 증빙",
};

export interface YearendUploadRow {
  uploadId: string;
  targetYear: number;
  employeeId: string;
  employeeName?: string;
  kind: YearendUploadKind;
  kindLabel: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  parsed: Record<string, unknown> | null;
  applied: boolean;
  createdAt: string;
  /** 저장 키(서버 내부용 — 화면에는 내려주지 않는다) */
  fileKey?: string;
}

export interface MyYearendYear {
  year: number;
  /** none = 확정 급여대장 없음(집계 불가) · draft · confirmed */
  status: "none" | "draft" | "confirmed";
  monthCount: number;
  grossPay: number;
  nonTaxablePay: number;
  prepaidTax: number;
  inputs: YearendInputs;
  result: YearendResult | null;
  hasOriginalPdf: boolean;
  originalPdfName: string | null;
  uploads: YearendUploadRow[];
}

const newId = () => `yeu-${crypto.randomBytes(6).toString("hex")}`;
const toNum = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
function parseJson<T>(v: unknown): T | null {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function mapUpload(r: Record<string, unknown>): YearendUploadRow {
  const kind = (["simplified_pdf", "deduction_form", "other"].includes(String(r.kind)) ? String(r.kind) : "other") as YearendUploadKind;
  return {
    uploadId: String(r.upload_id),
    targetYear: Number(r.target_year),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name != null ? String(r.employee_name) : undefined,
    kind,
    kindLabel:
      kind === "other" && (parseJson<Record<string, unknown>>(r.parsed)?.label)
        ? `기타 증빙 · ${String(parseJson<Record<string, unknown>>(r.parsed)?.label)}`
        : UPLOAD_KIND_LABEL[kind],
    fileName: String(r.file_name),
    contentType: r.content_type != null ? String(r.content_type) : null,
    sizeBytes: toNum(r.size_bytes),
    parsed: parseJson<Record<string, unknown>>(r.parsed),
    applied: toNum(r.applied) === 1,
    createdAt: String(r.created_at),
    fileKey: r.file_key != null ? String(r.file_key) : undefined,
  };
}

/** 직원 1명의 귀속연도 자동 집계(buildYearendBase 와 같은 규칙, 본인 행만). */
async function myBase(employeeId: string, year: number) {
  const db = await getDb();
  const r = rowsToObjects(
    await db.exec(
      `SELECT count(DISTINCT pl.ledger_id) AS month_count,
              COALESCE(SUM(CASE WHEN pid.kind = 'pay' AND COALESCE(pid.taxable, 1) = 1 THEN pel.amount END), 0) AS taxable_pay,
              COALESCE(SUM(CASE WHEN pid.kind = 'pay' AND pid.taxable = 0 THEN pel.amount END), 0) AS nontax_pay,
              COALESCE(SUM(CASE WHEN pel.item_id = 'income-tax' THEN pel.amount END), 0) AS prepaid_tax
         FROM payroll_ledgers pl
         JOIN payroll_entries pe ON pe.ledger_id = pl.ledger_id
         JOIN payroll_entry_lines pel ON pel.entry_id = pe.entry_id
         JOIN payroll_item_defs pid ON pid.item_id = pel.item_id
        WHERE pl.status = 'confirmed' AND pl.pay_year = $1 AND pe.employee_id = $2`,
      [year, employeeId]
    )
  )[0];
  return {
    monthCount: Number(r?.month_count ?? 0),
    grossPay: Math.round(toNum(r?.taxable_pay)),
    nonTaxablePay: Math.round(toNum(r?.nontax_pay)),
    prepaidTax: Math.round(toNum(r?.prepaid_tax)),
  };
}

/** 내 연말정산 개요 — 대장·정산·업로드가 있는 모든 귀속연도(최신순). */
export async function listMyYearend(userId: string): Promise<{ linked: boolean; employeeId: string | null; years: MyYearendYear[] }> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) return { linked: false, employeeId: null, years: [] };
  const db = await getDb();
  const yearRows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT y FROM (
         SELECT pl.pay_year AS y FROM payroll_ledgers pl JOIN payroll_entries pe ON pe.ledger_id = pl.ledger_id
          WHERE pl.status = 'confirmed' AND pe.employee_id = $1
         UNION SELECT target_year FROM yearend_settlements WHERE employee_id = $1
         UNION SELECT target_year FROM yearend_employee_uploads WHERE employee_id = $1
       ) t ORDER BY y DESC LIMIT 6`,
      [employeeId]
    )
  ).map((r) => Number(r.y));
  const settlements = new Map(
    rowsToObjects(
      await db.exec(`SELECT target_year, status, inputs, result, pdf_key, pdf_file_name FROM yearend_settlements WHERE employee_id = $1`, [employeeId])
    ).map((r) => [Number(r.target_year), r])
  );
  const uploads = rowsToObjects(
    await db.exec(`SELECT * FROM yearend_employee_uploads WHERE employee_id = $1 ORDER BY created_at DESC`, [employeeId])
  ).map(mapUpload);
  const years: MyYearendYear[] = [];
  for (const year of yearRows) {
    const base = await myBase(employeeId, year);
    const s = settlements.get(year);
    years.push({
      year,
      status: base.monthCount === 0 ? "none" : s && String(s.status) === "confirmed" ? "confirmed" : "draft",
      monthCount: base.monthCount,
      grossPay: base.grossPay,
      nonTaxablePay: base.nonTaxablePay,
      prepaidTax: base.prepaidTax,
      inputs: (s ? parseJson<YearendInputs>(s.inputs) : null) ?? {},
      result: s ? parseJson<YearendResult>(s.result) : null,
      hasOriginalPdf: !!(s && s.pdf_key),
      originalPdfName: s?.pdf_file_name != null ? String(s.pdf_file_name) : null,
      uploads: uploads.filter((u) => u.targetYear === year),
    });
  }
  return { linked: true, employeeId, years };
}

/** 공제신고서 명부 → 정산 입력(부양가족 수·자녀세액공제 대상 수). 본인(관계코드 0)은 제외. */
function inputsFromDeductionForm(parsed: Awaited<ReturnType<typeof parseTaxForm>>, targetYear: number): Partial<YearendInputs> {
  const deps = parsed.dependents.filter((d) => d.relation !== "0");
  const children = deps.filter((d) => {
    if (d.relation !== "4" && d.relation !== "5" || !d.rrnPrefix) return false;
    const yy = Number(d.rrnPrefix.slice(0, 2));
    const birthYear = yy <= targetYear % 100 ? 2000 + yy : 1900 + yy;
    const age = targetYear - birthYear;
    return age >= 8 && age <= 20;
  }).length;
  const out: Partial<YearendInputs> = { dependents: deps.length };
  if (children > 0) out.children = children;
  return out;
}

/**
 * 직원 셀프 업로드 — 파일 보관 + 파싱 + (정산 미확정이면) 입력 반영.
 * 확정된 정산은 건드리지 않고 파일·파싱값만 보관한다(관리자가 확정 취소 후 반영).
 */
export async function uploadMyYearendFile(
  userId: string,
  params: { year: number; kind: YearendUploadKind; fileName: string; contentType: string; buffer: Buffer; label?: string | null }
): Promise<{ upload: YearendUploadRow; applied: boolean; parsedKeys: string[]; message: string }> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) throw Object.assign(new Error("직원 연결이 없는 계정입니다."), { status: 403 });
  if (params.buffer.length > 30 * 1024 * 1024) throw Object.assign(new Error("파일은 30MB 이하만 올릴 수 있습니다."), { status: 400 });
  const safeName = sanitizeFilename(params.fileName);
  const ext = safeName.toLowerCase().split(".").pop() ?? "";
  if (params.kind === "simplified_pdf" && ext !== "pdf") throw Object.assign(new Error("간소화 자료는 PDF 파일을 올려 주세요."), { status: 400 });
  if (params.kind === "deduction_form" && !["xlsx", "xlsm", "xls"].includes(ext)) {
    throw Object.assign(new Error("공제신고서는 엑셀(xlsx) 파일을 올려 주세요."), { status: 400 });
  }

  let parsed: Record<string, unknown> | null = null;
  let inputs: Partial<YearendInputs> = {};
  let message = "";
  if (params.kind === "simplified_pdf") {
    const res = await parseSimplifiedPdf(params.buffer).catch(() => null);
    if (res) {
      parsed = { inputs: res.inputs, personName: res.personName, model: res.model };
      inputs = res.inputs;
      message = `간소화 자료에서 ${Object.keys(res.inputs).length}개 항목을 읽었습니다.`;
    } else {
      message = "파일은 보관했지만 자동 인식에 실패했습니다 — 관리자가 확인 후 입력합니다.";
    }
  } else if (params.kind === "deduction_form") {
    try {
      const form = await parseTaxForm(params.buffer);
      parsed = { name: form.name, ratePct: form.ratePct, dependents: form.dependents };
      inputs = inputsFromDeductionForm(form, params.year);
      message = `공제신고서에서 부양가족 ${inputs.dependents ?? 0}명${inputs.children ? ` · 자녀세액공제 대상 ${inputs.children}명` : ""}을 읽었습니다.`;
    } catch (err) {
      message = `파일은 보관했지만 신고서 해석에 실패했습니다(${err instanceof Error ? err.message : String(err)}).`;
    }
  } else {
    parsed = params.label ? { label: params.label } : null;
    message = `${params.label ? `${params.label} ` : ""}증빙 파일을 보관했습니다.`;
  }

  const key = `hr/yearend/${params.year}/${employeeId}/${Date.now()}-${safeName}`;
  await putContractDocument(key, params.buffer, params.contentType || "application/octet-stream");

  // 정산 입력 반영 — 확정 전이고 대장이 있을 때만.
  let applied = false;
  const keys = Object.keys(inputs).filter((k) => (inputs as Record<string, unknown>)[k] != null);
  if (keys.length) {
    const db = await getDb();
    const s = rowsToObjects(
      await db.exec(`SELECT status, inputs FROM yearend_settlements WHERE target_year = $1 AND employee_id = $2`, [params.year, employeeId])
    )[0];
    if (!s || String(s.status) !== "confirmed") {
      const merged: YearendInputs = { ...((s ? parseJson<YearendInputs>(s.inputs) : null) ?? {}), ...inputs };
      try {
        await saveSettlement(params.year, employeeId, merged);
        applied = true;
        message += " 연말정산 계산에 반영했습니다.";
      } catch (err) {
        message += ` (계산 반영 보류: ${err instanceof Error ? err.message : String(err)})`;
      }
    } else {
      message += " 이미 확정된 정산이라 값은 반영하지 않았습니다(관리자 확인).";
    }
  }

  const uploadId = newId();
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.exec(
      `INSERT INTO yearend_employee_uploads
         (upload_id, target_year, employee_id, kind, file_key, file_name, content_type, size_bytes, parsed, applied, uploaded_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
      [uploadId, params.year, employeeId, params.kind, key, safeName, params.contentType || null, params.buffer.length,
        parsed ? JSON.stringify(parsed) : null, applied ? 1 : 0, userId, now]
    );
  });
  const row = rowsToObjects(await (await getDb()).exec(`SELECT * FROM yearend_employee_uploads WHERE upload_id = $1`, [uploadId]))[0];
  return { upload: mapUpload(row), applied, parsedKeys: keys, message };
}

/** 업로드 파일 읽기 — 본인(userId) 또는 관리자(userId=null). */
export async function readYearendUpload(uploadId: string, userId: string | null): Promise<{ buffer: Buffer; fileName: string; contentType: string } | null> {
  const db = await getDb();
  const row = rowsToObjects(await db.exec(`SELECT * FROM yearend_employee_uploads WHERE upload_id = $1`, [uploadId]))[0];
  if (!row) return null;
  if (userId) {
    const employeeId = await resolveEmployeeId(userId);
    if (!employeeId || employeeId !== String(row.employee_id)) throw Object.assign(new Error("본인 자료만 열람할 수 있습니다."), { status: 403 });
  }
  const buffer = await readContractDocument(String(row.file_key));
  if (!buffer) return null;
  return { buffer, fileName: String(row.file_name), contentType: row.content_type ? String(row.content_type) : "application/octet-stream" };
}

/** 업로드 삭제(본인) — 파일·행 삭제. 이미 반영된 입력값은 되돌리지 않는다(관리자 검토). */
export async function deleteMyYearendUpload(userId: string, uploadId: string): Promise<void> {
  const employeeId = await resolveEmployeeId(userId);
  if (!employeeId) throw Object.assign(new Error("직원 연결이 없는 계정입니다."), { status: 403 });
  const db = await getDb();
  const row = rowsToObjects(await db.exec(`SELECT file_key, employee_id FROM yearend_employee_uploads WHERE upload_id = $1`, [uploadId]))[0];
  if (!row) return;
  if (String(row.employee_id) !== employeeId) throw Object.assign(new Error("본인 자료만 삭제할 수 있습니다."), { status: 403 });
  await withDbWrite(async (txn) => {
    await txn.exec(`DELETE FROM yearend_employee_uploads WHERE upload_id = $1`, [uploadId]);
  });
  await deleteContractDocument(String(row.file_key)).catch(() => undefined);
}

/** 관리자 — 귀속연도 직원 업로드 목록. */
export async function listYearendUploads(year: number): Promise<YearendUploadRow[]> {
  const db = await getDb();
  return rowsToObjects(
    await db.exec(
      `SELECT u.*, p.name AS employee_name FROM yearend_employee_uploads u
         LEFT JOIN employee_profiles p ON p.employee_id = u.employee_id
        WHERE u.target_year = $1 ORDER BY p.name, u.created_at DESC`,
      [year]
    )
  ).map(mapUpload);
}

/** 관리자 — 세무법인 원본 원천징수영수증 PDF 등록(yearend_settlements.pdf_key). 정산 행이 없으면 최소 행을 만든다. */
export async function attachOriginalWithholdingPdf(
  year: number,
  employeeId: string,
  file: { fileName: string; buffer: Buffer }
): Promise<void> {
  const safeName = sanitizeFilename(file.fileName);
  const key = `hr/yearend/${year}/${employeeId}/withholding-${Date.now()}-${safeName}`;
  await putContractDocument(key, file.buffer, "application/pdf");
  const now = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const settleId = `ye-${crypto.createHash("sha256").update(`${year}:${employeeId}`).digest("hex").slice(0, 12)}`;
  await withDbWrite(async (txn) => {
    await txn.exec(
      `INSERT INTO yearend_settlements (settle_id, target_year, employee_id, gross_pay, prepaid_tax, inputs, pdf_key, pdf_file_name, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 0, '{}'::jsonb, $4, $5, $6, $6)
       ON CONFLICT (target_year, employee_id) DO UPDATE SET pdf_key = EXCLUDED.pdf_key, pdf_file_name = EXCLUDED.pdf_file_name, updated_at = EXCLUDED.updated_at`,
      [settleId, year, employeeId, key, safeName, now]
    );
  });
}

/** 원천징수영수증 PDF — 원본(pdf_key) 우선, 없으면 앱 산출 요약본. 본인(userId) 또는 관리자(null, employeeId 지정). */
export async function getWithholdingReceiptPdf(
  year: number,
  who: { userId: string } | { employeeId: string }
): Promise<{ bytes: Uint8Array; fileName: string; source: "original" | "generated" } | null> {
  const employeeId = "userId" in who ? await resolveEmployeeId(who.userId) : who.employeeId;
  if (!employeeId) throw Object.assign(new Error("직원 연결이 없는 계정입니다."), { status: 403 });
  const db = await getDb();
  const head = rowsToObjects(
    await db.exec(
      `SELECT p.name, p.employee_no, d.dept_name, pos.position_name, s.status, s.result, s.pdf_key, s.pdf_file_name
         FROM employee_profiles p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN positions pos ON pos.position_id = p.position_id
         LEFT JOIN yearend_settlements s ON s.employee_id = p.employee_id AND s.target_year = $2
        WHERE p.employee_id = $1`,
      [employeeId, year]
    )
  )[0];
  if (!head) return null;
  if (head.pdf_key) {
    const buf = await readContractDocument(String(head.pdf_key));
    if (buf) return { bytes: new Uint8Array(buf), fileName: String(head.pdf_file_name ?? `원천징수영수증_${year}.pdf`), source: "original" };
  }
  const result = parseJson<YearendResult>(head.result);
  if (!result) return null;
  const base = await myBase(employeeId, year);
  const bytes = await renderWithholdingReceiptPdf({
    targetYear: year,
    employeeName: String(head.name),
    empNo: head.employee_no != null ? String(head.employee_no) : null,
    deptName: head.dept_name != null ? String(head.dept_name) : null,
    positionName: head.position_name != null ? String(head.position_name) : null,
    monthCount: base.monthCount,
    nonTaxablePay: base.nonTaxablePay,
    result,
    status: String(head.status) === "confirmed" ? "confirmed" : "draft",
  });
  return { bytes, fileName: `${String(head.name)} 근로소득 원천징수영수증(${year}년 귀속).pdf`, source: "generated" };
}

/**
 * 세무사 제출용 바인딩(zip) — 귀속연도 전 직원의 업로드 자료 + 원본 영수증 + 정산 요약 CSV.
 * 폴더: {성명}/{종류}_{파일명}. 요약 CSV 는 UTF-8 BOM(엑셀 호환).
 */
export async function buildYearendBundle(year: number): Promise<{ zip: Buffer; fileName: string; files: number }> {
  const zip = new JSZip();
  const uploads = await listYearendUploads(year);
  let files = 0;
  for (const u of uploads) {
    const buf = u.fileKey ? await readContractDocument(u.fileKey) : null;
    if (!buf) continue;
    zip.file(`${u.employeeName ?? u.employeeId}/${u.kindLabel.replace(/[\\/:*?"<>|]/g, "_")}_${u.fileName}`, buf);
    files += 1;
  }
  const db = await getDb();
  const originals = rowsToObjects(
    await db.exec(
      `SELECT s.pdf_key, s.pdf_file_name, p.name FROM yearend_settlements s JOIN employee_profiles p ON p.employee_id = s.employee_id
        WHERE s.target_year = $1 AND s.pdf_key IS NOT NULL`,
      [year]
    )
  );
  for (const o of originals) {
    const buf = await readContractDocument(String(o.pdf_key));
    if (!buf) continue;
    zip.file(`${String(o.name)}/원천징수영수증_${String(o.pdf_file_name ?? "원본.pdf")}`, buf);
    files += 1;
  }
  const rows = await listSettlements(year);
  const csv = [
    ["성명", "부서", "총급여(과세)", "비과세", "기납부소득세", "국민연금", "건강·요양", "고용보험", "결정세액", "환급(-)/추납(+)", "지방소득세", "상태", "부양가족", "보험료", "의료비", "교육비", "기부금", "연금계좌", "월세", "신용카드", "직불·현금", "전통시장·대중교통", "주택자금"],
    ...rows.map((r) => [
      r.name, r.deptName ?? "", r.grossPay, r.nonTaxablePay, r.prepaidTax, r.nationalPension, r.healthInsurance, r.employmentInsurance,
      r.result?.determinedTax ?? "", r.result?.balance ?? "", r.result?.localTax ?? "", r.status,
      r.inputs.dependents ?? "", r.inputs.insurancePremium ?? "", r.inputs.medicalExpense ?? "", r.inputs.educationExpense ?? "", r.inputs.donation ?? "",
      r.inputs.pensionAccount ?? "", r.inputs.monthlyRent ?? "", r.inputs.cardCredit ?? "", r.inputs.cardCheckCash ?? "", r.inputs.cardTraditionalTransit ?? "", r.inputs.housingLoanDeduction ?? "",
    ]),
  ]
    .map((line) => line.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  zip.file(`연말정산_정산요약_${year}.csv`, "\uFEFF" + csv);
  files += 1;
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: out, fileName: `연말정산_제출자료_${year}년귀속.zip`, files };
}
