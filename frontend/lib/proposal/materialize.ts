import type { ProposalDocument } from "./types";

export const PROPOSAL_VARIABLE_LABELS = {
  client: "발주처", projectName: "용역명", siteName: "사업장명", duration: "수행기간", companyName: "제안사명",
} as const;

/** Keep reusable source tokens in the draft; resolve a separate preview/publication snapshot. */
export function materializeDocument(document: ProposalDocument): ProposalDocument {
  const values: Record<string, string> = { client: document.client, projectName: document.projectName, ...document.variables };
  const visit = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") return ["id", "pageId", "dataUrl", "contentVersion"].includes(key) ? value : value.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (token, name: string) => Object.hasOwn(values, name) && typeof values[name] === "string" && values[name].trim() ? values[name] : token);
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k)]));
    return value;
  };
  return visit(document) as ProposalDocument;
}
