import { INTEL_PROJECT_STAGES, INTEL_SERVICE_CODES, type IntelProjectInput, type IntelProjectStage, type IntelProject, type ServiceAssessment, type PublicPriority, type PriorityComponent, type IntelServiceCode, type RecommendedAction } from "./project-intelligence-types";

export const PROJECT_RULE_VERSION = "public-rules-v1";
export function intelError(message: string, status = 400): Error & { status: number } { return Object.assign(new Error(message), { status }); }
export function requiredText(value: unknown, field: string, max = 300): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw intelError(`${field}을(를) 확인하세요.`);
  return value.trim();
}
export function optionalText(value: unknown, max = 1000): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw intelError("문자열 길이 또는 형식이 올바르지 않습니다.");
  return value.trim() || null;
}
export function stringIds(value: unknown, max = 100): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw intelError("대상 목록이 올바르지 않습니다.");
  return [...new Set(value.map((v) => requiredText(v, "식별자", 160)))];
}
export function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw intelError("검토한 버전이 필요합니다.");
  return Number(value);
}
export function isoDate(value: unknown): string | null {
  const s = optionalText(value, 10); if (!s) return null;
  const date = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== s) throw intelError("날짜가 올바르지 않습니다.");
  return s;
}
/** 영업 캘린더와 같은 KST 벽시계 문자열. 임의 timezone 변환을 하지 않는다. */
export function activityDate(value: unknown): string {
  const s = requiredText(value, "예정 일시", 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) throw intelError("예정 일시를 한국 시간으로 입력하세요.");
  isoDate(s.slice(0, 10));
  if (Number(s.slice(11, 13)) > 23 || Number(s.slice(14, 16)) > 59 || Number(s.slice(17, 19) || 0) > 59) throw intelError("예정 시간이 올바르지 않습니다.");
  return s.length === 16 ? `${s}:00` : s;
}
export function normalizeProjectInput(input: IntelProjectInput): IntelProjectInput {
  const stage = input.stage ?? "unknown";
  if (!INTEL_PROJECT_STAGES.includes(stage)) throw intelError("사업 단계를 확인하세요.");
  const amount = input.amount == null ? null : input.amount;
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER)) throw intelError("투자금액을 확인하세요.");
  const currency = input.currency ?? "KRW";
  if (!/^[A-Z]{3}$/.test(currency)) throw intelError("통화 코드를 확인하세요.");
  const expectedStartAt = isoDate(input.expectedStartAt); const expectedEndAt = isoDate(input.expectedEndAt);
  if (expectedStartAt && expectedEndAt && expectedStartAt > expectedEndAt) throw intelError("시작일은 종료일보다 늦을 수 없습니다.");
  return { title: requiredText(input.title, "사업명"), companyName: optionalText(input.companyName, 300),
    facilityId: optionalText(input.facilityId, 160), industry: optionalText(input.industry, 100), region: optionalText(input.region, 200),
    stage, amount, currency, amountScope: optionalText(input.amountScope, 100) ?? "unknown",
    publicSummary: optionalText(input.publicSummary, 10000), expectedStartAt, expectedEndAt, signalIds: stringIds(input.signalIds) };
}
export function serviceCode(value: unknown): IntelServiceCode {
  if (!INTEL_SERVICE_CODES.includes(value as IntelServiceCode)) throw intelError("지원하지 않는 서비스 분류입니다.");
  return value as IntelServiceCode;
}
export const SERVICE_LABELS: Record<IntelServiceCode, string> = { integrated_permit: "통합허가", chem: "화관법", haps: "HAPs", esg: "ESG·탄소중립", etc: "기타 환경자문" };
export const FACILITY_SERVICE_MAP: Record<IntelServiceCode, string> = { integrated_permit: "integrated", chem: "chemicals", haps: "haps", esg: "esg", etc: "other" };
export const CONTRACT_SERVICE_MAP: Record<IntelServiceCode, string> = { integrated_permit: "통합허가", chem: "장외&화관법", haps: "HAPs", esg: "ESG탄소중립", etc: "기타" };

/** 공개 근거의 확인 질문을 실행 가능한 초안으로만 제시한다. 담당 정보는 호출자가 권한 확인한 값만 받는다. */
export function recommendProjectActions(projectId: string, services: ServiceAssessment[], owner: { employeeId: string; name: string; salesProjectId: string } | null, asOf: string): RecommendedAction[] {
  const day = isoDate(asOf); if (!day) throw intelError("추천 기준일이 필요합니다.");
  const suggestedDate = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  return services.filter(s => s.status === "possible" && s.evidenceSignalIds.length > 0 && s.questions.length > 0).slice(0,3).map(s => ({
    key: `${projectId}:${s.serviceCode}:${s.ruleVersion}`, title: `${s.label} 검토: ${s.questions[0]}`.slice(0,300), activityType: "email",
    evidenceSignalIds: [...s.evidenceSignalIds], defaultAssignee: owner ? { employeeId: owner.employeeId, name: owner.name } : null,
    salesProjectId: owner?.salesProjectId ?? null, suggestedDate, reason: `${s.rationale} 담당자와 일정은 채택 전에 확인하세요.`,
  }));
}

/** 공개 원문에 있는 표현만 사용. 법적 적용 여부·내부 고객관계는 추론하지 않는다. */
export function assessPublicServices(project: Pick<IntelProject, "title" | "publicSummary" | "industry" | "stage">, evidenceSignalIds: string[]): ServiceAssessment[] {
  const text = [project.title, project.publicSummary, project.industry].filter(Boolean).join(" ");
  const rules: Array<[IntelServiceCode, RegExp, string[]]> = [
    ["integrated_permit", /신설|증설|공장|생산시설|공정|통합.?허가/, ["기존 허가 유형과 변경되는 시설·배출량은 무엇인가요?", "해당 사업의 법정 업종·규모와 인허가 일정은 확인했나요?"]],
    ["chem", /화학|유해|위험물|특수.?가스|용제|불산/, ["취급 물질·농도·최대 보유량과 변경 범위를 확인했나요?"]],
    ["haps", /HAPs|특정대기|유해대기|휘발성|VOC|벤젠/i, ["대상 물질·배출시설·관리 기준의 실제 적용 여부를 확인했나요?"]],
    ["esg", /탄소|온실가스|ESG|CBAM|LCA|공급망|배출권|탈탄소/i, ["고객의 공시·수출·감축 목표 및 실제 요구사항은 무엇인가요?"]],
    ["etc", /환경|인허가|수질|대기|폐수|폐기물/, ["필요한 환경자문 범위와 발주 담당을 확인했나요?"]],
  ];
  return rules.map(([code, regex, questions]) => {
    const match = text.match(regex); const supported = !!match && evidenceSignalIds.length > 0;
    return { serviceCode: code, label: SERVICE_LABELS[code], status: supported ? "possible" : "insufficient",
      facts: supported ? [`공개 근거의 관련 표현: ${match![0]}`] : [],
      rationale: supported ? "공개된 사업 내용에 관련 표현이 있어 서비스 검토가 가능합니다. 법적 적용은 별도 확인이 필요합니다." : "서비스 수요를 판단할 공개 근거가 부족합니다.",
      questions, evidenceSignalIds, ruleVersion: PROJECT_RULE_VERSION, basis: "public" };
  });
}
export function scorePublicProject(project: Pick<IntelProject, "stage" | "amount" | "currency" | "expectedStartAt">, services: ServiceAssessment[], confidence: PublicPriority["confidence"] = "unknown", asOf = new Date().toISOString().slice(0, 10)): PublicPriority {
  const hasService = services.some((s) => s.status === "possible");
  const stagePoints: Partial<Record<IntelProjectStage, number>> = { mou: 5, announced: 10, approved: 20, permitting: 25, construction: 15, operating: 5, delayed: 3, suspended: 0, canceled: 0 };
  const days = project.expectedStartAt ? (Date.parse(project.expectedStartAt) - Date.parse(asOf)) / 86400000 : null;
  const components: PriorityComponent[] = [
    { key: "service", label: "서비스 검토 적합성", maximum: 30, points: hasService ? 30 : null, reason: hasService ? "공개 근거에 서비스 검토 표현 있음" : "서비스 판단 자료 부족" },
    { key: "stage", label: "추진 단계", maximum: 25, points: stagePoints[project.stage] ?? null, reason: `확인한 단계: ${project.stage}` },
    { key: "timing", label: "접촉 시급성", maximum: 20, points: days == null ? null : days >= 0 && days <= 90 ? 20 : days > 90 && days <= 180 ? 10 : 0, reason: project.expectedStartAt ? `확인한 예정일 ${project.expectedStartAt}` : "예정일 미확인" },
    { key: "size", label: "확인된 사업 규모", maximum: 10, points: project.amount == null || project.currency !== "KRW" ? null : project.amount >= 100000000000 ? 10 : project.amount >= 10000000000 ? 7 : project.amount > 0 ? 3 : 0, reason: project.currency !== "KRW" ? "환율 기준 없이 외화 규모 점수 산정하지 않음" : project.amount == null ? "규모 미상" : "공개 투자금액 기준; 용역금액과 무관" },
  ];
  const score = components.reduce((n, c) => n + (c.points ?? 0), 0);
  return { ruleVersion: PROJECT_RULE_VERSION, basis: "public", score, possibleScore: score + components.filter((c) => c.points == null).reduce((n, c) => n + c.maximum, 0), maximum: 85,
    needsReview: !hasService || project.stage === "unknown", components, confidence };
}
