import crypto from "node:crypto";

export type NewsInputKind = "search_excerpt" | "full_text";
export type NewsQualityDecision = "accepted" | "background" | "needs_review" | "unrelated";
export type NewsTitleRelation = "main" | "background" | "unclear";
export interface NewsContentQuality {
  version: "news-grounded-v1";
  inputHash: string;
  inputKind: NewsInputKind;
  decision: NewsQualityDecision;
  titleRelation: NewsTitleRelation;
  evidenceQuotes: string[];
  reason: string;
}
export interface NewsQualityInput { title: string; description: string; inputKind?: NewsInputKind }
export interface NewsEvidencePart { id: string; text: string }
const decisions: NewsQualityDecision[] = ["accepted", "background", "needs_review", "unrelated"];
const relations: NewsTitleRelation[] = ["main", "background", "unclear"];
export const normalizeNewsText = (value: string): string => value.replace(/\s+/g, " ").trim();

/** 모델의 재작성 없이 근거 ID로 원문을 선택한다. 짧은 검색 발췌는 문맥 전체를 보존한다. */
export function buildNewsEvidenceParts(input: NewsQualityInput): NewsEvidencePart[] {
  const parts: NewsEvidencePart[] = [{ id: "T", text: normalizeNewsText(input.title) }];
  const body = normalizeNewsText(input.description);
  if (!body) return parts;
  if (body.length <= 1200) return [...parts, { id: "S1", text: body }];
  // 긴 본문은 기존 온전한 문장 경계만 사용하며 숫자·조건·생략 내용을 수정하지 않는다.
  const sentences = body.split(/(?<=[.!?。！？])\s+/);
  let chunk = "";
  for (const sentence of sentences) {
    if (chunk && chunk.length + sentence.length + 1 > 1200) { parts.push({ id: `S${parts.length}`, text: chunk }); chunk = ""; }
    chunk = chunk ? `${chunk} ${sentence}` : sentence;
  }
  if (chunk) parts.push({ id: `S${parts.length}`, text: chunk });
  return parts;
}

/** 비채택 자료에서는 배경 투자 문장을 제목의 새 사건처럼 요약하지 않는다. 근거는 별도 metadata에 남긴다. */
export function newsReviewSummary(title: string, decision: NewsQualityDecision): string {
  const explanation = decision === "background" ? "투자 관련 언급은 배경 정보로 분류했습니다."
    : decision === "unrelated" ? "국내 생산시설 투자 대상과 관련 없는 자료로 분류했습니다."
      : "현재 자료만으로 투자 사실을 확인하지 못해 검토가 필요합니다.";
  return `${normalizeNewsText(title)} · ${explanation}`;
}

/** 입력의 식별자는 모델이 생성하지 않는다. 발췌/본문 범위와 실제 입력 전체를 서버에서 묶는다. */
export function newsInputHash(title: string, description: string, inputKind: NewsInputKind = "search_excerpt"): string {
  return crypto.createHash("sha256").update(JSON.stringify({ title, description, inputKind })).digest("hex");
}
export function createNewsContentQuality(input: NewsQualityInput & { decision: NewsQualityDecision; titleRelation?: NewsTitleRelation; evidenceQuotes?: string[]; reason: string }): NewsContentQuality {
  return { version: "news-grounded-v1", inputHash: newsInputHash(input.title, input.description, input.inputKind), inputKind: input.inputKind ?? "search_excerpt", decision: input.decision, titleRelation: input.titleRelation ?? "unclear", evidenceQuotes: input.evidenceQuotes ?? [], reason: input.reason };
}
export function checkNewsContentQuality(value: unknown): value is NewsContentQuality {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const q = value as Record<string, unknown>;
  return q.version === "news-grounded-v1" && typeof q.inputHash === "string" && /^[a-f0-9]{64}$/.test(q.inputHash)
    && typeof q.inputKind === "string" && ["search_excerpt", "full_text"].includes(q.inputKind) && decisions.includes(q.decision as NewsQualityDecision)
    && relations.includes(q.titleRelation as NewsTitleRelation) && Array.isArray(q.evidenceQuotes) && q.evidenceQuotes.length <= 4
    && q.evidenceQuotes.every(quote => typeof quote === "string" && !!quote.trim() && quote.length <= 1200)
    && typeof q.reason === "string" && !!q.reason.trim() && q.reason.length <= 600
    && (q.decision !== "accepted" || (q.titleRelation === "main" && q.evidenceQuotes.length > 0));
}
/** 품질 표기가 없는 기존 자료는 유지한다. 표시가 있으면 유효한 accepted만 자동 분석에 쓴다. */
export function isNewsContentQualityAccepted(raw: unknown): boolean {
  let data: unknown = raw;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return false; } }
  if (data == null) return true;
  if (typeof data !== "object" || Array.isArray(data)) return false;
  const classification = (data as { classification?: unknown }).classification;
  if (!classification || typeof classification !== "object" || Array.isArray(classification) || !Object.hasOwn(classification, "contentQuality")) return true;
  const quality = (classification as { contentQuality: unknown }).contentQuality;
  return checkNewsContentQuality(quality) && quality.decision === "accepted";
}
/** raw_json text/jsonb 양쪽 지원. 공식 자료 권리 조건과 별도로 함께 적용한다. */
export function newsContentQualityCondition(alias = "s"): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) throw new Error("Invalid news quality SQL alias");
  const raw = `${alias}.raw_json::jsonb`;
  const q = `(${raw} #> '{classification,contentQuality}')`;
  const quotes = `(CASE WHEN jsonb_typeof(${q}->'evidenceQuotes')='array' THEN ${q}->'evidenceQuotes' ELSE '[]'::jsonb END)`;
  return `COALESCE((${raw} IS NULL OR jsonb_typeof(${raw})='null' OR (jsonb_typeof(${raw})='object' AND (${q} IS NULL OR (jsonb_typeof(${q})='object' AND ${q}->>'version'='news-grounded-v1' AND ${q}->>'decision'='accepted' AND ${q}->>'titleRelation'='main' AND ${q}->>'inputKind' IN('search_excerpt','full_text') AND ${q}->>'inputHash' ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${q}->'evidenceQuotes')='array' AND jsonb_array_length(${quotes}) BETWEEN 1 AND 4 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${quotes}) AS nq_quote(value) WHERE jsonb_typeof(nq_quote.value)<>'string' OR length(regexp_replace(nq_quote.value #>> '{}','[[:space:]]','','g'))=0 OR length(nq_quote.value #>> '{}')>1200) AND jsonb_typeof(${q}->'reason')='string' AND length(regexp_replace(${q}->>'reason','[[:space:]]','','g'))>0 AND length(${q}->>'reason')<=600)))),false)`;
}

export interface NewsGroundedOutput {
  decision: NewsQualityDecision; titleRelation: NewsTitleRelation; reason: string; evidenceQuotes: string[];
  signalType: "investment" | "expansion" | "new_site" | "other";
  companyName: string | null; location: string | null; scale: string | null; projectPeriod: string | null;
  confidence: "high" | "medium" | "low";
  industry: string | null; industryRelevance: "direct" | "supply_chain" | "low" | "none" | null; relevanceNote: string | null;
}
const required = ["decision", "titleRelation", "reason", "evidenceQuotes", "signalType", "companyName", "location", "scale", "projectPeriod", "confidence", "industry", "industryRelevance", "relevanceNote"];
const failure = (message: string): never => { throw new Error(`뉴스 근거 검증 실패: ${message}`); };

/** 모델은 입력에 있는 ID만 선택할 수 있다. 실제 인용문은 서버가 원문에서 가져온다. */
export function validateNewsGroundedSelection(value: unknown, input: NewsQualityInput): NewsGroundedOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) failure("JSON 객체가 아닙니다.");
  const row = value as Record<string, unknown>;
  const keys = required.map(key => key === "evidenceQuotes" ? "evidenceIds" : key);
  if (keys.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !keys.includes(key))) failure("필수 필드 또는 허용되지 않은 필드를 확인하세요.");
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length > 4 || row.evidenceIds.some(id => typeof id !== "string")) failure("근거 ID 형식이 올바르지 않습니다.");
  const parts = new Map(buildNewsEvidenceParts(input).map(part => [part.id, part.text]));
  const selected: string[] = [];
  for (const id of [...new Set(row.evidenceIds as string[])]) {
    const quote = parts.get(id);
    if (quote === undefined) return failure("선택한 근거 ID가 입력 자료에 없습니다.");
    selected.push(quote);
  }
  const { evidenceIds: _ids, ...fields } = row;
  return validateNewsGroundedOutput({ ...fields, evidenceQuotes: selected }, input);
}

/** 인용 일부만 떼어 정부의 요구를 기업의 결정으로 바꾸지 않도록 문장 경계까지 확인한다. */
function quoteBelongsToInput(quote: string, input: NewsQualityInput): boolean {
  const normalized = normalizeNewsText(quote);
  const title = normalizeNewsText(input.title), body = normalizeNewsText(input.description);
  if (normalized === title || normalized === body) return true;
  const start = body.indexOf(normalized);
  if (start < 0) return false;
  const before = body.slice(0, start).trimEnd(), after = body.slice(start + normalized.length).trimStart();
  const startsAtSentence = !before || /[.!?。！？]$/.test(before);
  const endsAtSentence = !after || /[.!?。！？]$/.test(normalized);
  return startsAtSentence && endsAtSentence;
}
const directive = /(?:정부|대통령|장관|지자체|도지사|시장|국회|의회).{0,180}(?:촉구|요구|주문|서두르|요청|제안|압박)/;
const reactionTitle = /주가|목표가|동반\s*(?:상승|하락)|실적|매출|영업이익|인사|총괄|사장|임단협|노조|분양|아파트|주거|부동산|칼럼|사설|인터뷰|국감|산안법|산업안전보건법|메가특구법/;
const facility = /공장|팹|생산시설|생산라인|클린룸|패키징|산업단지|산단|클러스터/;
const commitment = /투자|신설|증설|착공|건설|건립|구축|짓기로|짓는다|지을|신축|확장|가동|준공|기공|일정|앞당|양산|증산|오픈/;
// 검색 결과가 생략한 문맥을 건너 회사와 다른 주체의 행동을 결합하지 않는다.
const excerptOmission = /\.{2,}|…+|⋯+|(?:·\s*){3,}/;
const infrastructureRiskTitle = /(?:도로|교통|용수|전력|전기|송전|상하수|하수|인프라|기반시설).{0,25}(?:부족|병목|시급|미해결|해결\s*안|난항|차질)/;
const technologyCompetitionTitle = /(?:기술|공정|제조).{0,30}(?:혁신|경쟁|개발|진화|전환)|(?:혁신|기술).{0,12}경쟁/;
const explicitFacilityAnnouncement = /(?:공장|팹|생산시설|생산라인|클린룸|패키징).{0,30}(?:투자\s*(?:결정|발표)|(?:신설|증설|착공|신축|확장|가동|준공).{0,12}(?:결정|발표|확정|착수|시작|완료))/;

/** 응답 JSON 전체와 각 추출값의 원문 존재를 검사한다. 자유 생성 요약은 받지 않는다. */
export function validateNewsGroundedOutput(value: unknown, input: NewsQualityInput): NewsGroundedOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) failure("JSON 객체가 아닙니다.");
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key))) failure("필수 필드 또는 허용되지 않은 필드를 확인하세요.");
  if (!decisions.includes(row.decision as NewsQualityDecision) || !relations.includes(row.titleRelation as NewsTitleRelation)) failure("주제 판정 값이 올바르지 않습니다.");
  if (typeof row.signalType !== "string" || !["investment", "expansion", "new_site", "other"].includes(row.signalType)) failure("signalType 값이 허용된 분류가 아닙니다.");
  if (typeof row.confidence !== "string" || !["high", "medium", "low"].includes(row.confidence)) failure("confidence 값이 허용된 분류가 아닙니다.");
  if (typeof row.reason !== "string" || !row.reason.trim() || row.reason.length > 600) failure("판정 이유가 없습니다.");
  if (!Array.isArray(row.evidenceQuotes) || row.evidenceQuotes.length > 4 || row.evidenceQuotes.some(q => typeof q !== "string" || !q.trim() || q.length > 1200)) failure("근거 문장 형식이 올바르지 않습니다.");
  const quotes = [...new Set((row.evidenceQuotes as string[]).map(normalizeNewsText))];
  for (const quote of quotes) if (!quoteBelongsToInput(quote, input)) failure("근거 문장이 입력 원문 또는 온전한 문장과 일치하지 않습니다.");
  const evidence = quotes.join(" ");
  for (const key of ["companyName", "location", "scale", "projectPeriod"]) {
    const field = row[key];
    if (field !== null && (typeof field !== "string" || !field.trim() || field.length > 200 || !evidence.includes(normalizeNewsText(field)))) failure(`${key} 값이 인용 근거에 없습니다.`);
  }
  for (const key of ["industry", "relevanceNote"]) if (row[key] !== null && (typeof row[key] !== "string" || !(row[key] as string).trim() || (row[key] as string).length > 300)) failure(`${key} 형식이 올바르지 않습니다.`);
  if (typeof row.relevanceNote === "string" && !evidence.includes(normalizeNewsText(row.relevanceNote))) failure("relevanceNote 값이 인용 근거에 없습니다.");
  if (row.industryRelevance !== null && (typeof row.industryRelevance !== "string" || !["direct", "supply_chain", "low", "none"].includes(row.industryRelevance))) failure("업종 관련성 값이 올바르지 않습니다.");
  const output = { ...row, reason: (row.reason as string).trim(), evidenceQuotes: quotes } as unknown as NewsGroundedOutput;
  if (output.decision === "accepted") {
    if (output.titleRelation !== "main" || !quotes.length || !output.companyName || output.signalType === "other") failure("채택한 투자 신호의 주제·사업 주체·근거가 부족합니다.");
    const directQuotes = quotes.filter(q => normalizeNewsText(input.description).includes(q) && q !== normalizeNewsText(input.title) && !directive.test(q)
      && q.split(excerptOmission).some(part => part.includes(output.companyName!) && facility.test(part) && commitment.test(part) && !directive.test(part)));
    if (!directQuotes.length) return { ...output, decision: "needs_review", titleRelation: "unclear", reason: "생략되지 않은 같은 구간에서 기업·시설·투자 행위를 직접 연결할 근거가 부족하거나 정부·제3자의 요구만 있어 검토가 필요합니다." };
    if (infrastructureRiskTitle.test(input.title) && !explicitFacilityAnnouncement.test(input.title)) return { ...output, decision: "background", titleRelation: "background", reason: "기사 제목은 기반시설의 부족·병목·해결 요구를 다루므로 기존 투자 시설과 일정은 배경 정보로 분류했습니다." };
    if (technologyCompetitionTitle.test(input.title) && !(facility.test(input.title) && commitment.test(input.title))) return { ...output, decision: "background", titleRelation: "background", reason: "기사 제목은 공정·제조 기술의 혁신·경쟁을 다루므로 발췌의 투자 시설·금액을 새로운 투자 발표로 채택하지 않았습니다." };
    if (reactionTitle.test(input.title) && !(facility.test(input.title) && commitment.test(input.title))) return { ...output, decision: "background", titleRelation: "background", reason: "기사 제목이 실적·주가·인사·정치·분양 등 반응을 다루므로 배경 투자 언급을 신규 사업으로 채택하지 않았습니다." };
  }
  return output;
}
