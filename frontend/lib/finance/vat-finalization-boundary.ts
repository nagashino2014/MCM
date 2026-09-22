import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { validateFiscalYear } from "./write-lock";

export interface VatFinalizationApplication {
  subjectId?: string | null;
  year: number;
  term: 1 | 2;
  kind: "pre" | "preliminary" | "final";
  path: "legacy" | "basis";
}

export interface VatFinalizationConflict {
  origin: "legacy" | "basis_return";
  returnId: string;
  confirmationId: string | null;
  subjectId: string | null;
  subjectResolution: "unresolved_legacy" | "exact";
  taxpayerCorpNum: string | null;
  filingUnit: "single_business_place" | null;
  matchKind: "legacy_unresolved" | "legacy_global" | "same_subject" | "same_taxpayer_unit";
  year: number;
  term: 1 | 2;
  kind: "final";
}

const unavailable = () => Object.assign(new Error("신고 확정 경계를 검증할 수 없습니다. 필수 마이그레이션 234·235와 보관 자료를 확인하세요."), { status: 503, code: "vat_finalization_unavailable" });
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && value === value.trim();

/** 호출자가 잡은 회계 잠금·트랜잭션의 DB를 그대로 사용한다. 새 연결이나 현재 신고 계산을 열지 않는다. */
export async function listVatFinalizationConflicts(db: PgDatabase, application: VatFinalizationApplication): Promise<VatFinalizationConflict[]> {
  validateFiscalYear(application.year);
  if (![1, 2].includes(application.term) || !["pre", "preliminary", "final"].includes(application.kind) || !["legacy", "basis"].includes(application.path)
    || application.subjectId != null && !text(application.subjectId) || application.path === "basis" && !text(application.subjectId)) {
    throw Object.assign(new Error("신고 확정 경계의 주체·연도·기수·종류를 확인하세요."), { status: 400, code: "vat_finalization_input" });
  }
  try {
    const structure = rowsToObjects(await db.exec(`SELECT to_regclass('vat_finalization_fences') IS NOT NULL AS table_present,
      to_regprocedure('vat_finalization_conflicts(text,integer,integer,text,text)') IS NOT NULL AS function_present,
      to_regprocedure('vat_finalization_identity_version()') IS NOT NULL AS identity_version_present,
      to_regprocedure('vat_finalization_basis_identity(text)') IS NOT NULL AS identity_function_present`))[0];
    if (structure?.table_present !== true || structure?.function_present !== true
      || structure?.identity_version_present !== true || structure?.identity_function_present !== true) throw unavailable();
    await db.exec("SELECT key,generation FROM vat_finalization_fences WHERE false");
    const identityVersion = rowsToObjects(await db.exec("SELECT vat_finalization_identity_version() AS version"))[0];
    if (identityVersion?.version !== "vat-finalization-taxpayer-v1") throw unavailable();
    const row = rowsToObjects(await db.exec("SELECT vat_finalization_conflicts($1,$2,$3,$4,$5) AS conflicts", [application.subjectId ?? null, application.year, application.term, application.kind, application.path]))[0];
    const conflicts: unknown = typeof row?.conflicts === "string" ? JSON.parse(row.conflicts) : row?.conflicts;
    if (!Array.isArray(conflicts)) throw unavailable();
    for (const value of conflicts) {
      if (!value || typeof value !== "object" || !["legacy", "basis_return"].includes(value.origin) || !text(value.returnId)
        || value.year !== application.year || value.term !== application.term || value.kind !== "final"
        || value.origin === "legacy" && (value.subjectId !== null || value.confirmationId !== null || value.subjectResolution !== "unresolved_legacy"
          || value.taxpayerCorpNum !== null || value.filingUnit !== null || value.matchKind !== "legacy_unresolved")
        || value.origin === "basis_return" && (!text(value.subjectId) || !text(value.confirmationId) || value.subjectResolution !== "exact"
          || typeof value.taxpayerCorpNum !== "string" || !/^[0-9]{10}$/.test(value.taxpayerCorpNum) || value.filingUnit !== "single_business_place"
          || value.matchKind !== (application.path === "legacy" ? "legacy_global" : value.subjectId === application.subjectId ? "same_subject" : "same_taxpayer_unit"))
        || application.kind !== "final") throw unavailable();
    }
    return conflicts as VatFinalizationConflict[];
  } catch (error) {
    if (["40001", "40P01"].includes(String((error as { code?: string }).code))) throw error;
    throw unavailable();
  }
}

/** 과거 예정 근거는 차단하지 않는다. legacy의 미귀속 확정판은 같은 기수의 모든 주체에 보수적으로 충돌한다. */
export async function assertVatFinalizationOpen(db: PgDatabase, application: VatFinalizationApplication): Promise<void> {
  const conflicts = await listVatFinalizationConflicts(db, application);
  if (conflicts.length) throw Object.assign(new Error("같은 적용 당기에 이미 확정된 신고가 있습니다. 기존 확정본을 보존하고 경로·주체를 확인하세요."), {
    status: 409, code: "vat_finalization_conflict", conflicts,
    application: { ...application, subjectId: application.subjectId ?? null },
  });
}
