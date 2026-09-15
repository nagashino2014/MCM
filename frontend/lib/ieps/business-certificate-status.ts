export function certificateAnalysisWarning(row: Record<string, unknown>): string | null {
  let parsed = row.parsed_json;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const data = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const warning = data.warning || data.extractionWarning;
  if (typeof warning === "string" && warning) return warning;
  if (!row.business_type && !row.business_item && !row.corporate_registration_no && !data.representativeName) {
    return "분석 결과가 없습니다. 재분석해 주세요.";
  }
  return null;
}
