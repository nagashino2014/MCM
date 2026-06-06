import {
  normalizeBusinessCertificateOcrText,
  parseBusinessCertificateText,
  type BusinessCertificateKind,
  type BusinessCertificateParseResult,
} from "./business-certificate-parser";

export interface OcrCandidate {
  engine?: string | null;
  text?: string | null;
  confidence?: number | null;
  score?: number | null;
  variant?: string | null;
}

export interface FieldVote {
  fieldName: keyof BusinessCertificateParseResult;
  value: string;
  confidence: number;
  needsReview: boolean;
  engines: string[];
}

export interface VotedBusinessCertificateResult extends BusinessCertificateParseResult {
  ocrText: string;
  votedFields: FieldVote[];
  needsReviewFields: string[];
  candidateCount: number;
}

interface ParsedCandidate {
  candidate: OcrCandidate;
  text: string;
  parsed: BusinessCertificateParseResult;
  weight: number;
}

const ENGINE_WEIGHTS: Record<string, number> = {
  vlm: 1.5,
  "paddleocr-vl": 1.5,
  "dots.mocr": 1.5,
  paddleocr: 1.35,
  easyocr: 1.2,
  tesseract: 0.75,
  text_layer: 0.8,
};

export function voteBusinessCertificateCandidates(
  candidates: OcrCandidate[],
  fallbackText: string,
  filename?: string | null
): VotedBusinessCertificateResult {
  const normalizedCandidates = normalizeCandidates(candidates, fallbackText);
  const parsedCandidates = normalizedCandidates.map((candidate) => {
    const text = normalizeBusinessCertificateOcrText(candidate.text ?? "");
    const parsed = parseBusinessCertificateText(text, { filename });
    return {
      candidate,
      text,
      parsed,
      weight: candidateWeight(candidate) + fieldCompletenessScore(parsed),
    };
  }).sort((a, b) => b.weight - a.weight);

  const bestTextCandidate = parsedCandidates[0];
  const companyName = voteScalar(parsedCandidates, "companyName", validateCompanyName);
  const businessRegistrationNo = voteScalar(parsedCandidates, "businessRegistrationNo", validateBusinessRegistrationNo);
  const representativeName = voteScalar(parsedCandidates, "representativeName", validateKoreanName);
  const siteAddress = voteScalar(parsedCandidates, "siteAddress", validateAddress);
  const corporateRegistrationNo = voteScalar(parsedCandidates, "corporateRegistrationNo", validateCorporateRegistrationNo);
  const bestKinds = chooseBusinessKinds(parsedCandidates);

  const votedFields = [
    companyName,
    businessRegistrationNo,
    representativeName,
    siteAddress,
    corporateRegistrationNo,
  ];
  const needsReviewFields = votedFields.filter((field) => field.needsReview).map((field) => field.fieldName);

  return {
    companyName: companyName.value,
    businessRegistrationNo: businessRegistrationNo.value,
    representativeName: representativeName.value,
    siteAddress: siteAddress.value,
    businessType: bestKinds.map((item) => item.businessType).filter(Boolean).join("\n"),
    businessItem: bestKinds.map((item) => item.businessItem).filter(Boolean).join("\n"),
    businessKinds: bestKinds,
    corporateRegistrationNo: corporateRegistrationNo.value,
    ocrText: bestTextCandidate?.text.slice(0, 12000) ?? "",
    votedFields,
    needsReviewFields,
    candidateCount: parsedCandidates.length,
  };
}

function normalizeCandidates(candidates: OcrCandidate[], fallbackText: string): OcrCandidate[] {
  const fromCandidates = candidates
    .map((candidate) => ({ ...candidate, text: normalizeBusinessCertificateOcrText(candidate.text ?? "") }))
    .filter((candidate) => candidate.text);
  if (fromCandidates.length) {
    return fromCandidates.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  }
  const text = normalizeBusinessCertificateOcrText(fallbackText);
  return text ? [{ engine: "fallback", text, confidence: 0.5, score: 0 }] : [];
}

function voteScalar(
  candidates: ParsedCandidate[],
  fieldName: keyof BusinessCertificateParseResult,
  validator: (value: string) => boolean
): FieldVote {
  const groups = new Map<string, { value: string; score: number; engines: Set<string> }>();
  for (const item of candidates) {
    const value = String(item.parsed[fieldName] ?? "").trim();
    if (!value) continue;
    const key = normalizeScalar(value);
    const validated = validator(value);
    const current = groups.get(key) ?? { value, score: 0, engines: new Set<string>() };
    current.score += item.weight * (validated ? 2 : 1);
    current.engines.add(String(item.candidate.engine ?? "unknown"));
    groups.set(key, current);
  }
  const sorted = Array.from(groups.values()).sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  if (!winner) {
    return { fieldName, value: "", confidence: 0, needsReview: true, engines: [] };
  }
  const runnerUp = sorted[1];
  const confidence = Math.min(1, winner.score / Math.max(1, candidates.length * 2));
  const lowConsensus = runnerUp ? winner.score / Math.max(0.1, runnerUp.score) < 1.25 : false;
  return {
    fieldName,
    value: winner.value,
    confidence,
    needsReview: !validator(winner.value) || confidence < 0.55 || lowConsensus,
    engines: Array.from(winner.engines),
  };
}

function chooseBusinessKinds(candidates: ParsedCandidate[]): BusinessCertificateKind[] {
  const scored = candidates
    .map((item) => {
      const kinds = item.parsed.businessKinds;
      const meaningful = kinds.filter((kind) => kind.businessType || kind.businessItem);
      const score =
        meaningful.length * 3 +
        meaningful.filter((kind) => /업$|업\b/.test(kind.businessType)).length +
        meaningful.filter((kind) => kind.businessItem.length >= 2).length +
        item.weight;
      return { kinds: meaningful, score };
    })
    .filter((item) => item.kinds.length);
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.kinds ?? [];
}

function candidateWeight(candidate: OcrCandidate): number {
  const engine = String(candidate.engine ?? "unknown").toLowerCase();
  const engineWeight = ENGINE_WEIGHTS[engine] ?? 1;
  const confidence = Number(candidate.confidence ?? 0.5);
  return engineWeight * (0.75 + Math.min(1, Math.max(0, confidence)));
}

function fieldCompletenessScore(parsed: BusinessCertificateParseResult): number {
  let score = 0;
  if (validateCompanyName(parsed.companyName)) score += 0.35;
  if (validateBusinessRegistrationNo(parsed.businessRegistrationNo)) score += 0.45;
  if (validateKoreanName(parsed.representativeName)) score += 0.45;
  if (validateAddress(parsed.siteAddress)) score += 0.35;
  if (validateCorporateRegistrationNo(parsed.corporateRegistrationNo)) score += 0.35;
  const meaningfulKinds = parsed.businessKinds.filter((kind) => kind.businessType || kind.businessItem);
  if (meaningfulKinds.length > 0) score += 0.25;
  if (meaningfulKinds.some((kind) => kind.businessType && kind.businessItem)) score += 0.25;
  return score;
}

function normalizeScalar(value: string): string {
  return value.replace(/\s+/g, "").replace(/[()（）.-]/g, "").toLowerCase();
}

function validateCompanyName(value: string): boolean {
  return /[가-힣A-Za-z0-9]/.test(value) && !/사업자등록증|등록번호|개업/.test(value);
}

function validateBusinessRegistrationNo(value: string): boolean {
  return /^\d{3}-\d{2}-\d{5}$/.test(value);
}

function validateCorporateRegistrationNo(value: string): boolean {
  return /^\d{6}-\d{7}$/.test(value) || /^\d{5}-\d{7}$/.test(value);
}

function validateKoreanName(value: string): boolean {
  const names = value.split(/\n+|,\s*/).map((item) => item.trim()).filter(Boolean);
  return names.length > 0 && names.every((name) => /^[가-힣]{2,5}$/.test(name));
}

function validateAddress(value: string): boolean {
  return /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/.test(value);
}
