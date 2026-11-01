import { createHash } from "node:crypto";
import { createNewsContentQuality, newsInputHash } from "../lib/intel/news-content-quality";

type Row = Record<string, unknown>;
export function explicitImportedSourceIds(value: unknown, knownIds: ReadonlySet<string>): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200 || value.some(id => typeof id !== "string" || !id.trim() || id.length > 300)) throw new Error("명시 재동기화는 기존 자료 ID 최대 200개만 허용합니다.");
  const ids = [...new Set((value as string[]).map(id => id.trim()))];
  if (ids.some(id => !knownIds.has(id))) throw new Error("명시 재동기화 대상은 이미 가져온 원본 자료여야 합니다.");
  return ids;
}
export function mergeImportedSourceRows(selected: Row[], explicit: Row[]): Row[] {
  return [...new Map([...selected, ...explicit].map(row => [String(row.signal_id), row])).values()];
}
const object = (value: unknown): Row => {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
};
const classificationFields = ["isSignal", "signalType", "companyName", "location", "scale", "projectPeriod", "confidence", "summary", "industry", "industryRelevance", "relevanceNote", "contentQuality"] as const;

/** 원본 수집 payload 전체 대신 공개 기사와 분류 결과만 복사한다. */
export function importedPublicRaw(signal: Row): Row {
  const raw = object(signal.public_raw), classification = object(raw.classification);
  const result: Row = { channel: signal.channel ?? null };
  for (const key of ["description", "originalLink"] as const) if (typeof raw[key] === "string") result[key] = raw[key];
  if (signal.source === "press" && typeof raw.body === "string") result.body = raw.body;
  if (Object.keys(classification).length) result.classification = Object.fromEntries(classificationFields.filter(key => Object.hasOwn(classification, key)).map(key => [key, classification[key]]));
  return result;
}

/** 로컬 재검증 결과를 섞지 않아 원본이 그대로면 로컬 정정을 유지한다. */
export function importedSignalFingerprint(signal: Row): string {
  return createHash("sha256").update(JSON.stringify({ ...signal, public_raw: importedPublicRaw(signal), created_at: undefined, updated_at: undefined })).digest("hex");
}

export function importedSignalRaw(signal: Row, sourceSignalId: string, importId: string, previousRaw?: unknown): Row {
  const raw = importedPublicRaw(signal), previous = object(object(previousRaw).classification), incoming = object(raw.classification);
  const incomingQuality = object(incoming.contentQuality);
  const description = String(signal.source === "press" ? raw.body ?? "" : raw.description ?? "");
  const inputKind = signal.source === "press" ? incomingQuality.inputKind === "search_excerpt" ? "search_excerpt" : "full_text" : incomingQuality.inputKind === "full_text" ? "full_text" : "search_excerpt";
  const staleAccepted = incomingQuality.decision === "accepted" && incomingQuality.inputHash !== newsInputHash(String(signal.report_name ?? ""), description, inputKind);
  // 재검증 후 원본 내용이 바뀌면, 새 입력에 검증 판정이 없던 과거 분류를 다시 승인하지 않는다.
  if (["news", "press"].includes(String(signal.source)) && (staleAccepted || (Object.hasOwn(previous, "contentQuality") && !Object.hasOwn(incoming, "contentQuality")))) {
    raw.classification = { ...incoming, isSignal: false, contentQuality: createNewsContentQuality({
      title: String(signal.report_name ?? ""), description, inputKind, decision: "needs_review",
      reason: signal.source === "press" ? "원본 자료가 변경되었습니다. 제목과 공개 보도자료 본문을 다시 검증해야 합니다." : "원본 자료가 변경되었습니다. 제목과 공개 기사 요약을 다시 검증해야 합니다.",
    }) };
  }
  return { ...raw, localImport: { sourceSignalId, importId } };
}
