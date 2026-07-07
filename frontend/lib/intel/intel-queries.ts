// intel_signals 조회·상태변경·영업건 전환 쿼리. API & RAG 1차.

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { createSalesProject } from "@/lib/sales/queries";
import { INTEL_SIGNAL_TYPE_LABELS, type IntelSignalType, type IntelSignalGrade } from "./signal-extractor";

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface IntelSignal {
  signalId: string;
  source: string;
  externalId: string;
  corpCode: string | null;
  companyName: string | null;
  brn: string | null;
  reportName: string | null;
  signalType: IntelSignalType;
  signalGrade: IntelSignalGrade;
  assetClass: string | null;
  acquirePurpose: string | null;
  counterparty: string | null;
  disclosedAt: string | null;
  amount: number | null;
  url: string | null;
  facilityId: string | null;
  facilityName: string | null;
  matchStatus: string; // matched | unmatched | ignored
  matchType: string; // direct | counterparty
  linkedProjectId: string | null;
  status: string; // new | reviewed | converted | dismissed
  createdAt: string;
  updatedAt: string;
}

export interface IntelSignalFilter {
  signalType?: string;
  matchStatus?: string;
  status?: string;
  grade?: string; // 미지정=confirmed+candidate 기본, 'all'=전체, 특정등급=그 등급만
  q?: string;
  from?: string; // disclosed_at >=
  to?: string; // disclosed_at <=
}

function mapSignal(row: Record<string, unknown>): IntelSignal {
  return {
    signalId: String(row.signal_id ?? ""),
    source: String(row.source ?? ""),
    externalId: String(row.external_id ?? ""),
    corpCode: text(row.corp_code),
    companyName: text(row.company_name),
    brn: text(row.brn),
    reportName: text(row.report_name),
    signalType: (String(row.signal_type ?? "other") as IntelSignalType),
    signalGrade: (String(row.signal_grade ?? "candidate") as IntelSignalGrade),
    assetClass: text(row.asset_class),
    acquirePurpose: text(row.acquire_purpose),
    counterparty: text(row.counterparty),
    disclosedAt: text(row.disclosed_at),
    amount: num(row.amount),
    url: text(row.url),
    facilityId: text(row.facility_id),
    facilityName: text(row.facility_name),
    matchStatus: String(row.match_status ?? "unmatched"),
    matchType: String(row.match_type ?? "direct"),
    linkedProjectId: text(row.linked_project_id),
    status: String(row.status ?? "new"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SIGNAL_SELECT = `
  SELECT s.signal_id, s.source, s.external_id, s.corp_code, s.company_name, s.brn, s.report_name,
         s.signal_type, s.signal_grade, s.asset_class, s.acquire_purpose, s.counterparty,
         s.disclosed_at, s.amount, s.url, s.facility_id, f.company_name AS facility_name,
         s.match_status, s.match_type, s.linked_project_id, s.status, s.created_at, s.updated_at
    FROM intel_signals s
    LEFT JOIN facilities f ON f.facility_id = s.facility_id`;

export async function listIntelSignals(filter: IntelSignalFilter = {}): Promise<IntelSignal[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.signalType) { params.push(filter.signalType); where.push(`s.signal_type = $${params.length}`); }
  if (filter.matchStatus) { params.push(filter.matchStatus); where.push(`s.match_status = $${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`s.status = $${params.length}`); }
  // grade 기본값: confirmed+candidate 노출. 'all'=제약없음, 특정등급=그 등급만.
  if (filter.grade === undefined) {
    where.push(`s.signal_grade IN ('confirmed','candidate')`);
  } else if (filter.grade !== "all") {
    params.push(filter.grade); where.push(`s.signal_grade = $${params.length}`);
  }
  if (filter.from) { params.push(filter.from); where.push(`s.disclosed_at >= $${params.length}`); }
  if (filter.to) { params.push(filter.to); where.push(`s.disclosed_at <= $${params.length}`); }
  if (filter.q) {
    params.push(`%${filter.q}%`);
    where.push(`(s.company_name ILIKE $${params.length} OR s.report_name ILIKE $${params.length})`);
  }
  const db = await getDb();
  const sql = `${SIGNAL_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY s.disclosed_at DESC NULLS LAST, s.created_at DESC LIMIT 500`;
  return rowsToObjects(await db.exec(sql, params)).map(mapSignal);
}

export async function getIntelSignal(signalId: string): Promise<IntelSignal | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${SIGNAL_SELECT} WHERE s.signal_id = $1 LIMIT 1`, [signalId]));
  return rows.length ? mapSignal(rows[0]) : null;
}

/** 처리상태 변경(new/reviewed/dismissed). converted는 전환 함수에서만. */
export async function updateSignalStatus(signalId: string, status: "new" | "reviewed" | "dismissed"): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run("UPDATE intel_signals SET status = $2, updated_at = $3 WHERE signal_id = $1", [signalId, status, now]);
  });
}

/** 미매칭 신호에 사업장 수동 연결. */
export async function linkSignalFacility(signalId: string, facilityId: string): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      "UPDATE intel_signals SET facility_id = $2, match_status = 'matched', updated_at = $3 WHERE signal_id = $1",
      [signalId, facilityId, now]
    );
  });
}

/** 신호 → 영업건(lead) 전환. facility 매칭 필수. 반환: projectId. */
export async function convertSignalToProject(signalId: string, userId: string | null): Promise<string> {
  const signal = await getIntelSignal(signalId);
  if (!signal) throw new Error("신호를 찾을 수 없습니다.");
  if (!signal.facilityId) throw new Error("사업장이 매칭되지 않은 신호는 전환할 수 없습니다.");
  if (signal.linkedProjectId) return signal.linkedProjectId;

  const label = INTEL_SIGNAL_TYPE_LABELS[signal.signalType] ?? "발주";
  const title = `${signal.companyName ?? "사업장"} · ${label} 대응`;
  const projectId = await createSalesProject(
    {
      facilityId: signal.facilityId,
      title,
      stage: "lead",
      priority: "normal",
      memo: `[DART 신호] ${signal.reportName ?? ""} (${signal.disclosedAt ?? ""})\n${signal.url ?? ""}`,
    },
    userId
  );

  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      "UPDATE intel_signals SET linked_project_id = $2, status = 'converted', updated_at = $3 WHERE signal_id = $1",
      [signalId, projectId, now]
    );
  });
  return projectId;
}
