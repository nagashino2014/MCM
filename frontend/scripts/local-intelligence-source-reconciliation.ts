type Row = Record<string, unknown>;
export type SourceDatabase = { query(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> };
export interface ImportedSignalOrigin { sourceSignalId: string; targetSignalId: string }
export interface ImportedSignalState extends ImportedSignalOrigin { availability: "available" | "missing" | "deleted" | "excluded" | "dismissed" | "duplicate" | "source_changed"; duplicateOf: string | null }

/** 이미 가져온 ID를 별도로 확인한다. 기간·최근 N건 조건을 적용하지 않아 범위 밖 정상 자료를 삭제로 오인하지 않는다. */
export async function readImportedSignalStates(source: SourceDatabase, origins: ImportedSignalOrigin[], allowedSources: readonly string[]): Promise<ImportedSignalState[]> {
  const result: ImportedSignalState[] = [];
  for (let offset = 0; offset < origins.length; offset += 500) {
    const batch = origins.slice(offset, offset + 500);
    const rows = (await source.query("SELECT signal_id,to_jsonb(s)->>'source' AS source,to_jsonb(s)->>'signal_grade' AS signal_grade,to_jsonb(s)->>'status' AS status,to_jsonb(s)->>'duplicate_of' AS duplicate_of,to_jsonb(s)->>'deleted_at' AS deleted_at FROM intel_signals s WHERE signal_id=ANY($1::text[])", [batch.map(o => o.sourceSignalId)])).rows;
    const byId = new Map(rows.map(row => [String(row.signal_id), row]));
    for (const origin of batch) {
      const row = byId.get(origin.sourceSignalId), duplicateOf = row?.duplicate_of ? String(row.duplicate_of) : null;
      const availability = !row ? "missing" : row.deleted_at ? "deleted" : !allowedSources.includes(String(row.source)) ? "source_changed" : row.signal_grade === "excluded" ? "excluded" : row.status === "dismissed" ? "dismissed" : duplicateOf ? "duplicate" : "available";
      result.push({ ...origin, availability, duplicateOf });
    }
  }
  return result;
}

/** 원본 상태를 로컬에서만 비활성화한다. 프로젝트·후보의 공통 조회는 이 신호 상태를 따른다. */
export async function invalidateImportedSignals(destination: SourceDatabase, states: ImportedSignalState[], checkedAt: string): Promise<number> {
  let changed = 0;
  for (const state of states) {
    if (state.availability === "available") continue;
    const result = await destination.query(`UPDATE intel_signals SET signal_grade='excluded',status='dismissed',updated_at=$4,
      raw_json=jsonb_set(COALESCE(raw_json,'{}'::jsonb),'{localImport}',COALESCE(raw_json->'localImport','{}'::jsonb)||jsonb_build_object('sourceAvailability',$2::text,'sourceDuplicateOf',$3::text,'sourceCheckedAt',$4::text),true)
      WHERE signal_id=$1 AND (signal_grade IS DISTINCT FROM 'excluded' OR status IS DISTINCT FROM 'dismissed' OR raw_json#>>'{localImport,sourceAvailability}' IS DISTINCT FROM $2 OR raw_json#>>'{localImport,sourceDuplicateOf}' IS DISTINCT FROM $3)`, [state.targetSignalId, state.availability, state.duplicateOf, checkedAt]);
    changed += result.rowCount ?? 0;
    // 재공개된 원본이 이후 선택 범위에 들어오면 전체 내용을 다시 받아 활성 상태를 복구하게 한다.
    await destination.query("UPDATE local_intelligence_signal_origins SET content_hash=$2 WHERE source_signal_id=$1", [state.sourceSignalId, `source-invalid:${state.availability}`]);
  }
  return changed;
}
