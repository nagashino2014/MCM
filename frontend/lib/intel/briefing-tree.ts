// 정기 발행본 분류 트리 — 통합허가 업종 → 사업장(마스터·관심 기업·미등록 기업) → 그 사업장을 다룬 발행 보고서.
// 열람 범위는 발행 이력 목록과 같다(listBriefingRuns: 소유자·명시 수신자). 조회 전용.

import { getDb, rowsToObjects } from "@/lib/db";
import { INTEGRATED_PERMIT_INDUSTRIES, industryIdFromKsic } from "@/lib/ieps/integrated-permit-industries";
import { listBriefingProfiles, listBriefingRuns } from "./briefing-store";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

export const UNCLASSIFIED_INDUSTRY = "unclassified";

const LETTER_NAMES: Record<string, string> = { A: "에이", B: "비", C: "씨", D: "디", E: "이", F: "에프", G: "지", H: "에이치", I: "아이", J: "제이", K: "케이", L: "엘", M: "엠", N: "엔", O: "오", P: "피", Q: "큐", R: "알", S: "에스", T: "티", U: "유", V: "브이", W: "더블유", X: "엑스", Y: "와이", Z: "제트" };
/**
 * 회사명 비교 키 — 법인 표기·공백·기호를 지우고, 4자 이하 영문 약자는 한글 읽기로 바꾼다.
 * 등기 회사명이 약자를 한글로 적는 경우(SK하이닉스 ↔ 에스케이하이닉스, LG화학 ↔ 엘지화학)를 같은 회사로 본다.
 */
export function companyMatchKey(name: string | null | undefined): string | null {
  if (!name) return null;
  let out = String(name).normalize("NFKC")
    .replace(/주\s*식\s*회\s*사|유\s*한\s*회\s*사|\(\s*[주유]\s*\)|㈜|㈲/g, "")
    .replace(/[\s()（）\[\]·.,&'"-]/g, "");
  out = out.replace(/(?<![A-Za-z])[A-Z]{1,4}(?![A-Za-z])/g, (run) => [...run].map((ch) => LETTER_NAMES[ch] ?? ch).join(""));
  out = out.toLowerCase();
  return out || null;
}

export interface BriefingTreeReport {
  briefingId: string;
  runId: string;
  profileName: string;
  /** 발간일(KST, YYYY-MM-DD) */
  date: string;
  /** 이 사업장 근거의 정보 유형 — investment·expansion·new_site·other */
  types: string[];
  /** 관심 분야 지정 서비스 ∪ 연결 프로젝트의 '검토 가능' 서비스 */
  services: string[];
}

export interface BriefingTreeEntity {
  key: string;
  /** facility: 사업장 마스터 · interest: 관심 기업(마스터 미등록) · unregistered: 보고서에만 나온 마스터 미등록 기업 */
  kind: "facility" | "interest" | "unregistered";
  facilityId: string | null;
  name: string;
  detail: string | null;
  reports: BriefingTreeReport[];
}

export interface BriefingTreeIndustry { id: string; label: string; entities: BriefingTreeEntity[] }

const kstDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
};

function parseReport(answer: unknown): { companies: Array<{ name?: string; projectId?: string | null; region?: string | null }> } {
  try {
    const value = typeof answer === "string" ? JSON.parse(answer) : answer;
    return value && typeof value === "object" && Array.isArray((value as Row).companies) ? (value as { companies: [] }) : { companies: [] };
  } catch { return { companies: [] }; }
}

export async function buildBriefingTree(userId: string): Promise<{ industries: BriefingTreeIndustry[] }> {
  const runs = (await listBriefingRuns(userId)).filter((run) => run.status === "published" && run.briefingId);
  const profiles = await listBriefingProfiles(userId);
  const profileById = new Map(profiles.map((profile) => [profile.profileId, profile]));
  const db = await getDb();

  // ── 사업장 마스터 ──
  const facilities = rowsToObjects(await db.exec(
    // industry_code 는 축약 시험 DB 에 없을 수 있어 jsonb 로 읽는다(실제 스키마에서는 같은 값).
    "SELECT f.facility_id, f.company_name, f.site_address, to_jsonb(f)->>'industry_code' AS industry_code, f.normalized_company_name, f.region_sido, f.region_sigungu FROM facilities f"));
  const facilityById = new Map<string, Row>();
  const facilitiesByName = new Map<string, Row[]>();
  for (const f of facilities) {
    facilityById.set(String(f.facility_id), f);
  }
  const addName = (name: string | null, f: Row) => {
    const key = companyMatchKey(name);
    if (!key) return;
    if (!facilitiesByName.has(key)) facilitiesByName.set(key, []);
    const list = facilitiesByName.get(key)!;
    if (!list.includes(f)) list.push(f);
  };
  for (const f of facilities) addName(str(f.company_name), f);
  // 마스터 별칭(POSCO ↔ 포스코처럼 키로 못 묶는 이름)도 같은 사업장으로 찾는다. 별칭 표가 없는 축약 DB 는 건너뛴다.
  const aliases = await db.exec("SELECT facility_id, alias FROM facility_aliases").then(rowsToObjects).catch(() => [] as Row[]);
  for (const a of aliases) { const f = facilityById.get(String(a.facility_id)); if (f) addName(str(a.alias), f); }
  /** 회사명 → 사업장. 같은 회사의 사업장이 여럿이면 지역으로 좁히고, 못 좁히면 모두. */
  const resolveByName = (name: string | null, region: string | null): Row[] => {
    const key = companyMatchKey(name);
    if (!key) return [];
    const candidates = facilitiesByName.get(key) ?? [];
    if (candidates.length <= 1 || !region) return candidates;
    const narrowed = candidates.filter((f) => [f.region_sido, f.region_sigungu, f.site_address].some((v) => v && String(v).includes(region) || (v && region.includes(String(v)))));
    return narrowed.length ? narrowed : candidates;
  };

  // ── 보고서·근거 ──
  const briefingIds = runs.map((run) => run.briefingId!) ;
  const briefings = briefingIds.length ? rowsToObjects(await db.exec(
    "SELECT briefing_id, answer_md, sources, profile_id, created_at FROM intel_rag_briefings WHERE briefing_id = ANY($1::text[])", [briefingIds])) : [];
  const briefingById = new Map(briefings.map((b) => [String(b.briefing_id), b]));
  const signalIds = new Set<string>(), projectIds = new Set<string>();
  for (const b of briefings) {
    const sources = Array.isArray(b.sources) ? b.sources as Row[] : (() => { try { return JSON.parse(String(b.sources ?? "[]")) as Row[]; } catch { return []; } })();
    for (const s of sources) { const id = str(s.signalId); if (id && !id.includes(":")) signalIds.add(id); }
    for (const c of parseReport(b.answer_md).companies) if (c.projectId) projectIds.add(String(c.projectId));
  }
  const signals = signalIds.size ? rowsToObjects(await db.exec(
    "SELECT signal_id, facility_id, company_name, signal_type, industry, region FROM intel_signals WHERE signal_id = ANY($1::text[])", [[...signalIds]])) : [];
  const signalById = new Map(signals.map((s) => [String(s.signal_id), s]));
  const projects = projectIds.size ? rowsToObjects(await db.exec(
    "SELECT project_id, facility_id, company_name, industry, region FROM intel_projects WHERE project_id = ANY($1::text[])", [[...projectIds]])) : [];
  const projectById = new Map(projects.map((p) => [String(p.project_id), p]));
  const projectTypes = new Map<string, Set<string>>(), projectServices = new Map<string, Set<string>>();
  if (projectIds.size) {
    for (const r of rowsToObjects(await db.exec(
      "SELECT ps.project_id, s.signal_type FROM intel_project_signals ps JOIN intel_signals s ON s.signal_id = ps.signal_id WHERE ps.project_id = ANY($1::text[])", [[...projectIds]]))) {
      const id = String(r.project_id); if (!projectTypes.has(id)) projectTypes.set(id, new Set()); if (r.signal_type) projectTypes.get(id)!.add(String(r.signal_type));
    }
    for (const r of rowsToObjects(await db.exec(
      `SELECT a.project_id, a.service_code FROM intel_service_assessments a JOIN intel_projects p ON p.project_id = a.project_id AND p.version = a.project_version
        WHERE a.project_id = ANY($1::text[]) AND a.assessment->>'status' = 'possible'`, [[...projectIds]]))) {
      const id = String(r.project_id); if (!projectServices.has(id)) projectServices.set(id, new Set()); projectServices.get(id)!.add(String(r.service_code));
    }
  }

  // 엔티티 키 → (보고서 → 유형·서비스)
  const links = new Map<string, Map<string, { run: (typeof runs)[number]; types: Set<string>; services: Set<string> }>>();
  const unregistered = new Map<string, { name: string; industry: string | null }>();
  const attach = (key: string, run: (typeof runs)[number], types: Iterable<string>, services: Iterable<string>) => {
    if (!links.has(key)) links.set(key, new Map());
    const byBriefing = links.get(key)!;
    const entry = byBriefing.get(run.briefingId!) ?? { run, types: new Set<string>(), services: new Set<string>() };
    for (const t of types) entry.types.add(t);
    for (const s of services) entry.services.add(s);
    byBriefing.set(run.briefingId!, entry);
  };
  const attachTarget = (run: (typeof runs)[number], facilityId: string | null, name: string | null, region: string | null, industry: string | null, types: Iterable<string>, services: Iterable<string>) => {
    const typeList = [...types], serviceList = [...services];
    if (facilityId && facilityById.has(facilityId)) { attach(`facility:${facilityId}`, run, typeList, serviceList); return; }
    const matched = resolveByName(name, region);
    if (matched.length) { for (const f of matched) attach(`facility:${f.facility_id}`, run, typeList, serviceList); return; }
    const key = companyMatchKey(name);
    if (!key) return;
    if (!unregistered.has(key)) unregistered.set(key, { name: String(name), industry });
    attach(`company:${key}`, run, typeList, serviceList);
  };

  for (const run of runs) {
    const b = briefingById.get(run.briefingId!);
    if (!b) continue;
    const profileServices = profileById.get(run.profileId)?.filters.services ?? [];
    const sources = Array.isArray(b.sources) ? b.sources as Row[] : (() => { try { return JSON.parse(String(b.sources ?? "[]")) as Row[]; } catch { return []; } })();
    for (const source of sources) {
      const signal = signalById.get(String(source.signalId ?? ""));
      if (!signal) continue;
      attachTarget(run, str(signal.facility_id), str(signal.company_name), str(signal.region), str(signal.industry), signal.signal_type ? [String(signal.signal_type)] : [], profileServices);
    }
    for (const company of parseReport(b.answer_md).companies) {
      const project = company.projectId ? projectById.get(String(company.projectId)) : undefined;
      const services = [...profileServices, ...(project ? projectServices.get(String(project.project_id)) ?? [] : [])];
      const types = project ? projectTypes.get(String(project.project_id)) ?? [] : [];
      attachTarget(run, str(project?.facility_id), str(project?.company_name) ?? str(company.name), str(project?.region) ?? str(company.region), str(project?.industry), types, services);
    }
  }

  const reportsFor = (key: string): BriefingTreeReport[] => [...(links.get(key)?.values() ?? [])]
    .map(({ run, types, services }) => ({ briefingId: run.briefingId!, runId: run.runId, profileName: run.profileName, date: kstDate(run.scheduledFor), types: [...types], services: [...services] }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // ── 트리 조립 ──
  const industries = new Map<string, BriefingTreeIndustry>();
  for (const item of INTEGRATED_PERMIT_INDUSTRIES) industries.set(item.id, { id: item.id, label: item.label, entities: [] });
  industries.set(UNCLASSIFIED_INDUSTRY, { id: UNCLASSIFIED_INDUSTRY, label: "업종 미분류", entities: [] });
  const industryOf = (id: string | null | undefined) => industries.get(id && industries.has(id) ? id : UNCLASSIFIED_INDUSTRY)!;

  for (const f of facilities) {
    const id = String(f.facility_id);
    industryOf(industryIdFromKsic(str(f.industry_code))).entities.push({
      key: `facility:${id}`, kind: "facility", facilityId: id, name: String(f.company_name),
      detail: [str(f.region_sido), str(f.region_sigungu)].filter(Boolean).join(" ") || str(f.site_address), reports: reportsFor(`facility:${id}`),
    });
  }
  // 관심 기업 — 마스터에 같은 회사가 있으면 그 사업장 노드가 대신한다.
  const placed = new Set<string>();
  for (const profile of profiles) {
    for (const name of profile.filters.companyNames) {
      const key = companyMatchKey(name);
      if (!key || facilitiesByName.has(key)) continue;
      const targets = profile.filters.industries.length ? profile.filters.industries : [UNCLASSIFIED_INDUSTRY];
      for (const industry of targets) {
        if (placed.has(`${industry}|${key}`)) continue;
        placed.add(`${industry}|${key}`);
        industryOf(industry).entities.push({ key: `company:${key}`, kind: "interest", facilityId: null, name, detail: `관심 분야 '${profile.name}'`, reports: reportsFor(`company:${key}`) });
      }
      unregistered.delete(key);
    }
  }
  for (const [key, company] of unregistered) {
    industryOf(company.industry).entities.push({ key: `company:${key}`, kind: "unregistered", facilityId: null, name: company.name, detail: "보고서에만 나온 기업", reports: reportsFor(`company:${key}`) });
  }

  for (const industry of industries.values()) {
    industry.entities.sort((a, b) => b.reports.length - a.reports.length || (a.kind === "facility" ? 1 : 0) - (b.kind === "facility" ? 1 : 0) || a.name.localeCompare(b.name, "ko"));
  }
  return { industries: [...industries.values()] };
}
