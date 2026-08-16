/**
 * 추진내역 요약(work_plan_reports.summary_text)을 불릿 행으로 분해.
 * AI 요약은 줄바꿈 구분이지만, 이전에 한 문단으로 저장된 요약·원문 폴백도
 * 글머리기호(①·•)나 문장 종결로 끊어 준다. 최대 4행.
 */
export function summaryLines(text: string | null | undefined): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  let parts = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) parts = raw.split(/\s*[①-⑳]\s*|\s+[•·▪]\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) parts = raw.split(/(?<=(?:다|음|함|됨|료)[.]?)\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((s) => s.replace(/^[\s•·▪\-–—*\d.)\]]+/, "").trim()).filter(Boolean).slice(0, 4);
}
