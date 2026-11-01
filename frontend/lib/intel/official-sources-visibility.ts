import { getDb, rowsToObjects, type PgDatabase } from "../db";
import { OfficialSourceError } from "./official-sources-policy";

/** 공식 자료의 AI·보고 경로는 문서 revision 권리를 검사하는 신규 경로로 한정한다. */
export function legacySignalSourceCondition(alias = "s"): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("invalid SQL alias");
  return `COALESCE(${alias}.source,'') NOT LIKE 'official:%'`;
}

/** 사용자에게 보여 줄 공식 신호 메타데이터도 현재 자료 이용 상태를 따른다. */
export function officialSignalVisibleCondition(alias = "s"): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error("invalid SQL alias");
  return `(COALESCE(${alias}.source,'') NOT LIKE 'official:%' OR EXISTS (
      SELECT 1 FROM intel_source_documents d JOIN scraper_sources src ON src.source_id=d.source_id
      JOIN intel_source_document_revisions r ON r.revision_id=d.current_revision_id
      WHERE d.signal_id=${alias}.signal_id AND src.official_provider IS NOT NULL AND d.status='available'
        AND src.official_config->>'enabled'='true' AND NULLIF(src.official_config->>'verifiedAt','') IS NOT NULL
        AND src.official_config->'permissions'->>'storageAllowed'='true'
        AND src.official_config->'permissions'->>'aiAllowed'='true'
        AND src.official_config->'permissions'->>'internalReportAllowed'='true'
        AND r.rights_snapshot->>'storageAllowed'='true' AND r.rights_snapshot->>'aiAllowed'='true'
        AND r.rights_snapshot->>'internalReportAllowed'='true'))`;
}
export async function assertOfficialSignalVisible(signalId: string, db?: PgDatabase): Promise<void> {
  const client = db ?? await getDb();
  const invalid = rowsToObjects(await client.exec(`SELECT s.signal_id FROM intel_signals s WHERE s.signal_id=$1 AND NOT (${officialSignalVisibleCondition("s")})`, [signalId]));
  if (invalid.length) throw new OfficialSourceError("근거 자료의 이용 허용이 변경되어 조회를 보류했습니다.", 403);
}

/** 구형 보고서는 revision ACL을 갖지 않으므로 공식 근거가 섞인 경우 재사용하지 않는다. */
export function assertLegacyBriefingSourcePolicy(row: Record<string, unknown>): void {
  if (row.access_scope === "restricted") return;
  let sources: unknown = row.sources;
  if (typeof sources === "string") { try { sources = JSON.parse(sources); } catch { return; } }
  if (Array.isArray(sources) && sources.some((source) => source && typeof source === "object" && (String(source.source ?? "").startsWith("official:") || source.kind === "official" || source.kind === "project"))) {
    throw new OfficialSourceError("공식 근거가 포함된 기존 브리핑은 이용 조건을 확인할 수 없습니다. 정기 브리핑에서 다시 생성하세요.", 403);
  }
}
