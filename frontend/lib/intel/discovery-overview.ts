// 영업 발굴 화면 전용 조회 — 개요(중요 변화·내 후속 활동·우선 검토)와 목록 부가정보(서비스·영업 연결·활동).
// 쓰기 없음. 원자료 권리 조건은 project-intelligence 의 목록·사건 조회와 같은 조건을 쓴다.

import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { checkPermission, type UserAccess } from "@/lib/auth/rbac";
import { officialSignalVisibleCondition } from "./official-sources-visibility";
import { newsContentQualityCondition } from "./news-content-quality";
import { isImportantBriefingChange } from "./briefing-important";
import { queryBriefingProjects } from "./project-intelligence";
import { intelError } from "./project-intelligence-rules";
import type { IntelProject } from "./project-intelligence-types";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const obj = (v: unknown): Row => (typeof v === "string" ? JSON.parse(v) : ((v ?? {}) as Row));

async function rows(db: PgDatabase, sql: string, params: unknown[] = []): Promise<Row[]> {
  return rowsToObjects(await db.exec(sql, params));
}

const signalVisible = (alias: string) => `(${officialSignalVisibleCondition(alias)} AND ${newsContentQualityCondition(alias)})`;

/** 후속 활동 기한 경과 — 화면의 기존 판정(KST 벽시계 문자열 + 09:00)과 같다. */
function isOverdue(row: Row): boolean {
  const due = str(row.ended_at) ?? str(row.scheduled_at);
  if (!due) return false;
  const status = str(row.activity_status);
  if (status && status !== "planned") return false;
  if (!status && row.status === "rejected") return false;
  const stamp = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(due) ? due : `${due.length <= 10 ? `${due}T23:59:59` : due}+09:00`);
  return Number.isFinite(stamp) && stamp < Date.now();
}

function actionVisible(access: UserAccess, row: Row): boolean {
  return row.sales_project_id
    ? checkPermission(access, "sales.view", { projectId: String(row.sales_project_id) })
    : row.created_by === access.userId || (access.employeeId != null && row.assignee_employee_id === access.employeeId);
}

const OPEN_ACTION = (row: Row) =>
  row.status === "proposed" || row.status === "hold" || (row.status === "accepted" && (row.activity_status ?? "planned") === "planned");

// ── 목록 부가정보 ──

export interface DiscoveryExtras {
  /** 공개 근거로 '검토 가능' 판정된 서비스 코드. */
  services: string[];
  /** 현재 계정이 열람할 수 있는 영업·계약 연결 수. */
  linkCount: number;
  openActions: number;
  overdueActions: number;
}

export async function discoveryExtras(projectIds: string[], access: UserAccess, db?: PgDatabase): Promise<Record<string, DiscoveryExtras>> {
  const ids = [...new Set(projectIds)].slice(0, 200);
  const result: Record<string, DiscoveryExtras> = Object.fromEntries(ids.map((id) => [id, { services: [], linkCount: 0, openActions: 0, overdueActions: 0 }]));
  if (!ids.length) return result;
  const conn = db ?? (await getDb());
  const services = await rows(conn,
    `SELECT a.project_id, a.service_code FROM intel_service_assessments a
       JOIN intel_projects p ON p.project_id = a.project_id AND p.version = a.project_version
      WHERE a.project_id = ANY($1::text[]) AND a.assessment->>'status' = 'possible'
      ORDER BY a.service_code`, [ids]);
  for (const r of services) result[String(r.project_id)]?.services.push(String(r.service_code));
  const links = await rows(conn, "SELECT project_id, sales_project_id, contract_id FROM intel_business_links WHERE project_id = ANY($1::text[])", [ids]);
  for (const r of links) {
    const visible = r.sales_project_id
      ? checkPermission(access, "sales.view", { projectId: String(r.sales_project_id) })
      : checkPermission(access, "contract.view", { contractId: String(r.contract_id) });
    if (visible && result[String(r.project_id)]) result[String(r.project_id)].linkCount += 1;
  }
  const actions = await rows(conn,
    `SELECT a.project_id, a.status, a.scheduled_at, a.ended_at, a.sales_project_id, a.created_by, a.assignee_employee_id, s.status AS activity_status
       FROM intel_action_suggestions a LEFT JOIN sales_activities s ON s.activity_id = a.sales_activity_id
      WHERE a.project_id = ANY($1::text[])`, [ids]);
  for (const r of actions) {
    const extra = result[String(r.project_id)];
    if (!extra || !actionVisible(access, r) || !OPEN_ACTION(r)) continue;
    extra.openActions += 1;
    if (isOverdue(r)) extra.overdueActions += 1;
  }
  return result;
}

// ── 개요 ──

export type OverviewEventKind = "new" | "stage" | "amount" | "correction";
export interface OverviewEvent {
  eventId: string; projectId: string; projectTitle: string; companyName: string | null; region: string | null;
  kind: OverviewEventKind; important: boolean;
  beforeStage: string | null; afterStage: string | null; beforeAmount: number | null; afterAmount: number | null;
  occurredAt: string | null; discoveredAt: string;
}
export interface OverviewAction {
  actionId: string; projectId: string; projectTitle: string; title: string; activityType: string;
  scheduledAt: string | null; status: string; activityStatus: string | null; overdue: boolean; salesProjectId: string | null;
}
export interface IntelOverview {
  events: OverviewEvent[];
  /** 최초 소급 적재(기존 자료 초기 분석)로 등록된 프로젝트 수 — 중요 변화에는 넣지 않는다. */
  baselineProjects: number;
  actions: OverviewAction[];
  top: Array<IntelProject & { extras: DiscoveryExtras }>;
  totals: { projects: number; confirmed: number; needsReview: number; newCandidates: number };
}

const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function intelOverview(access: UserAccess, input: { days?: number } = {}): Promise<IntelOverview> {
  if (!checkPermission(access, "sales.view")) throw intelError("영업 열람 권한이 필요합니다.", 403);
  const days = Math.min(90, Math.max(1, Math.trunc(input.days ?? 14)));
  const db = await getDb();

  const eventRows = await rows(db,
    `SELECT e.event_id, e.project_id, e.event_type, e.occurred_at, e.discovered_at, e.before_json, e.after_json, e.corrects_event_id,
            p.title AS project_title, p.company_name, p.region
       FROM intel_project_events e JOIN intel_projects p ON p.project_id = e.project_id AND p.state = 'active'
      WHERE e.mode <> 'initial_backfill' AND e.discovered_at >= now() - ($1::int * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM intel_signals rights_signal WHERE rights_signal.signal_id = ANY(e.evidence_signal_ids) AND NOT ${signalVisible("rights_signal")})
      ORDER BY e.discovered_at DESC, e.event_id LIMIT 200`, [days]);
  const events: OverviewEvent[] = [];
  for (const r of eventRows) {
    const before = obj(r.before_json), after = obj(r.after_json);
    const stageChanged = after.stage != null && before.stage !== after.stage;
    const amountChanged = after.amount != null && num(before.amount) !== num(after.amount);
    const kind: OverviewEventKind | null = r.corrects_event_id ? "correction" : r.event_type === "discovered" ? "new" : stageChanged ? "stage" : amountChanged ? "amount" : null;
    if (!kind) continue; // 근거 문서만 갱신된 사건은 개요에서 생략한다.
    events.push({
      eventId: String(r.event_id), projectId: String(r.project_id), projectTitle: String(r.project_title),
      companyName: str(r.company_name), region: str(r.region), kind,
      important: isImportantBriefingChange({ before, after, correctsEventId: str(r.corrects_event_id) }, null),
      beforeStage: str(before.stage), afterStage: str(after.stage), beforeAmount: num(before.amount), afterAmount: num(after.amount),
      occurredAt: iso(r.occurred_at), discoveredAt: iso(r.discovered_at) ?? "",
    });
    if (events.length >= 30) break;
  }
  const baseline = await rows(db, "SELECT count(DISTINCT project_id) AS n FROM intel_project_events WHERE mode = 'initial_backfill' AND event_type = 'discovered'");

  const actionRows = await rows(db,
    `SELECT a.action_id, a.project_id, a.title, a.activity_type, a.scheduled_at, a.ended_at, a.status, a.sales_project_id,
            a.created_by, a.assignee_employee_id, s.status AS activity_status, p.title AS project_title
       FROM intel_action_suggestions a
       JOIN intel_projects p ON p.project_id = a.project_id
       LEFT JOIN sales_activities s ON s.activity_id = a.sales_activity_id
      WHERE a.status IN ('proposed', 'hold', 'accepted') AND (a.created_by = $1 OR ($2::text IS NOT NULL AND a.assignee_employee_id = $2))
      ORDER BY COALESCE(a.scheduled_at, '9999') ASC, a.created_at DESC LIMIT 100`, [access.userId, access.employeeId]);
  const actions = actionRows.filter((r) => actionVisible(access, r) && OPEN_ACTION(r)).slice(0, 20).map((r): OverviewAction => ({
    actionId: String(r.action_id), projectId: String(r.project_id), projectTitle: String(r.project_title), title: String(r.title),
    activityType: String(r.activity_type), scheduledAt: str(r.scheduled_at), status: String(r.status),
    activityStatus: str(r.activity_status), overdue: isOverdue(r), salesProjectId: str(r.sales_project_id),
  }));

  const [top, confirmed, needsReview] = await Promise.all([
    queryBriefingProjects({ sortByPriority: true, limit: 5 }, { db }),
    queryBriefingProjects({ reviewState: "confirmed", limit: 1 }, { db }),
    queryBriefingProjects({ reviewState: "needs_review", limit: 1 }, { db }),
  ]);
  const extras = await discoveryExtras(top.projects.map((p) => p.projectId), access, db);
  const candidates = await rows(db, "SELECT count(*) AS n FROM intel_facility_candidates WHERE status = 'new'");

  return {
    events,
    baselineProjects: Number(baseline[0]?.n ?? 0),
    actions,
    top: top.projects.map((p) => ({ ...p, extras: extras[p.projectId] })),
    totals: { projects: top.total, confirmed: confirmed.total, needsReview: needsReview.total, newCandidates: Number(candidates[0]?.n ?? 0) },
  };
}

// ── 신규 사업장 후보 근거 요약 ──

export interface CandidateSummary { evidenceCount: number; firstTitle: string | null; firstSource: string | null; firstDate: string | null; projectId: string | null; projectTitle: string | null }

export async function candidateSummaries(candidates: Array<{ candidateId: string; evidence: Record<string, unknown> }>): Promise<Record<string, CandidateSummary>> {
  const ids = new Set<string>();
  const byCandidate = new Map<string, string[]>();
  for (const c of candidates) {
    const signalIds = Array.isArray(c.evidence.signalIds) ? c.evidence.signalIds.filter((id): id is string => typeof id === "string") : [];
    byCandidate.set(c.candidateId, signalIds);
    signalIds.forEach((id) => ids.add(id));
  }
  const db = await getDb();
  const signals = ids.size ? await rows(db,
    `SELECT s.signal_id, s.source, s.report_name, s.disclosed_at FROM intel_signals s
      WHERE s.signal_id = ANY($1::text[]) AND ${signalVisible("s")}`, [[...ids]]) : [];
  const signalMap = new Map(signals.map((s) => [String(s.signal_id), s]));
  const projects = candidates.length ? await rows(db,
    "SELECT DISTINCT ON (candidate_id) candidate_id, project_id, title FROM intel_projects WHERE candidate_id = ANY($1::text[]) AND state = 'active' ORDER BY candidate_id, updated_at DESC",
    [candidates.map((c) => c.candidateId)]) : [];
  const projectMap = new Map(projects.map((p) => [String(p.candidate_id), p]));
  return Object.fromEntries(candidates.map((c) => {
    const visible = (byCandidate.get(c.candidateId) ?? []).map((id) => signalMap.get(id)).filter((s): s is Row => !!s)
      .sort((a, b) => String(b.disclosed_at ?? "").localeCompare(String(a.disclosed_at ?? "")));
    const first = visible[0];
    const project = projectMap.get(c.candidateId);
    return [c.candidateId, {
      evidenceCount: visible.length, firstTitle: str(first?.report_name), firstSource: str(first?.source), firstDate: iso(first?.disclosed_at),
      projectId: str(project?.project_id), projectTitle: str(project?.title),
    }];
  }));
}
