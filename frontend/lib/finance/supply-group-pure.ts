import type {
  SupplyGroupDraft, SupplyGroupEvidenceInput, SupplyGroupPreviewInput, SupplyGroupRef,
  SupplyGroupRegion, SupplyGroupSaveInput, SupplyGroupWithdrawInput,
} from './supply-group-types';

export const groupError = (message: string, status = 400, code = 'supply_group_input') =>
  Object.assign(new Error(message), { status, code });
export const groupUnavailable = () => groupError('여러 문서 검토의 자료구조 또는 보관 근거를 확인할 수 없습니다.', 503, 'supply_group_unavailable');
export function groupObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw groupError('입력 형식을 확인하세요.');
  return v as Record<string, unknown>;
}
export function groupKeys(v: Record<string, unknown>, names: string[]) {
  if (Object.keys(v).length !== names.length || names.some(n => !Object.hasOwn(v, n))) throw groupError('지원하지 않거나 누락된 입력입니다.');
}
export function groupId(v: unknown): string {
  if (typeof v !== 'string' || !v.length || v.length > 200 || v.trim() !== v || /[\x00-\x1f\x7f]/.test(v)) throw groupError('식별자를 확인하세요.');
  return v;
}
export function groupText(v: unknown): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) throw groupError('검토 이유를 입력하세요.');
  return v;
}
export function groupHash(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) throw groupError('근거 해시를 확인하세요.');
  return v;
}
function version(v: unknown): number {
  if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > 2147483646) throw groupError('판 번호를 확인하세요.');
  return Number(v);
}
export function groupRef(v: unknown): SupplyGroupRef {
  const r = groupObject(v); groupKeys(r, ['documentId', 'portionId', 'observationId']);
  return { documentId: groupId(r.documentId), portionId: groupId(r.portionId), observationId: groupId(r.observationId) };
}
function ordered<T>(rows: T[], key: (v: T) => string): T[] {
  return rows.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
}
export function validateGroupRegions(v: unknown): SupplyGroupRegion[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 64) throw groupError('근거 영역은 1~64개를 선택하세요.');
  const ids = new Set<string>();
  return ordered(v.map(value => {
    const r = groupObject(value); groupKeys(r, ['regionId', 'pageNumber', 'rect', 'role', 'wholeRefs']);
    const regionId = groupId(r.regionId);
    if (ids.has(regionId)) throw groupError('근거 영역 식별자가 중복되었습니다.'); ids.add(regionId);
    if (!Number.isSafeInteger(r.pageNumber) || Number(r.pageNumber) < 1 || Number(r.pageNumber) > 20) throw groupError('지원하는 PDF 1~20페이지 안에서 선택하세요.');
    const rect = groupObject(r.rect); groupKeys(rect, ['x', 'y', 'width', 'height']);
    const number = (n: unknown): number => {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) throw groupError('근거 영역이 페이지를 벗어났습니다.');
      return n;
    };
    const normalized = { x: number(rect.x), y: number(rect.y), width: number(rect.width), height: number(rect.height) };
    if (!normalized.width || !normalized.height || normalized.x + normalized.width > 1 || normalized.y + normalized.height > 1) throw groupError('근거 영역이 페이지를 벗어났습니다.');
    if (r.role !== 'context' && r.role !== 'detail') throw groupError('근거 영역의 용도를 확인하세요.');
    if (!Array.isArray(r.wholeRefs) || !r.wholeRefs.length || r.wholeRefs.length > 21) throw groupError('해당 영역에 대응하는 문서를 선택하세요.');
    const wholeRefs = ordered(r.wholeRefs.map(groupRef), ref => ref.documentId);
    if (new Set(wholeRefs.map(ref => ref.documentId)).size !== wholeRefs.length) throw groupError('같은 영역에 문서를 중복 선택했습니다.');
    return { regionId, pageNumber: Number(r.pageNumber), rect: normalized, role: r.role, wholeRefs };
  }), r => r.regionId);
}
export function validateGroupEvidence(v: unknown): SupplyGroupEvidenceInput {
  const p = groupObject(v); groupKeys(p, ['subjectId', 'documentId', 'evidenceHash', 'regions', 'requestId']);
  return { subjectId: groupId(p.subjectId), documentId: groupId(p.documentId), evidenceHash: groupHash(p.evidenceHash), regions: validateGroupRegions(p.regions), requestId: groupId(p.requestId) };
}
function draft(v: unknown): SupplyGroupDraft {
  const d = groupObject(v);
  groupKeys(d, ['subjectId', 'reviewRevisionId', 'singleton', 'members', 'evidenceManifestId', 'reason', 'currencyEvidence', 'coverageConfirmed']);
  if (!Array.isArray(d.members) || d.members.length < 2 || d.members.length > 20) throw groupError('구성 문서는 2~20개를 선택하세요.');
  const singleton = groupRef(d.singleton), members = ordered(d.members.map(groupRef), r => r.documentId);
  if (new Set([singleton.documentId, ...members.map(r => r.documentId)]).size !== members.length + 1) throw groupError('기준 문서와 구성 문서를 중복 선택할 수 없습니다.');
  if (d.coverageConfirmed !== true) throw groupError('문서 전체의 대응과 구성원 비중복을 확인하세요.');
  if (!Array.isArray(d.currencyEvidence) || d.currencyEvidence.length !== members.length + 1) throw groupError('각 문서의 통화 근거를 선택하세요.');
  const currencyEvidence = ordered(d.currencyEvidence.map(value => {
    const c = groupObject(value); groupKeys(c, ['documentId', 'currency', 'manifestRegionId']);
    if (c.currency !== 'KRW') throw groupError('이번 검토는 원화 원문 근거만 지원합니다.');
    return { documentId: groupId(c.documentId), currency: 'KRW' as const, manifestRegionId: groupId(c.manifestRegionId) };
  }), c => c.documentId);
  if (new Set(currencyEvidence.map(c => c.documentId)).size !== currencyEvidence.length || currencyEvidence.some(c => ![singleton, ...members].some(r => r.documentId === c.documentId))) throw groupError('통화 근거와 선택 문서가 일치하지 않습니다.');
  return { subjectId: groupId(d.subjectId), reviewRevisionId: groupId(d.reviewRevisionId), singleton, members,
    evidenceManifestId: groupId(d.evidenceManifestId), reason: groupText(d.reason), currencyEvidence, coverageConfirmed: true };
}
export function validateGroupPreviewInput(v: unknown, save: true): SupplyGroupSaveInput;
export function validateGroupPreviewInput(v: unknown, save?: false): SupplyGroupPreviewInput;
export function validateGroupPreviewInput(v: unknown, save = false): SupplyGroupPreviewInput | SupplyGroupSaveInput {
  const p = groupObject(v); groupKeys(p, ['draft', 'caseId', 'expectedVersion', 'expectedRevisionId', ...(save ? ['expectedPreviewHash', 'requestId'] : [])]);
  const n = version(p.expectedVersion), c = p.caseId === null ? null : groupId(p.caseId), r = p.expectedRevisionId === null ? null : groupId(p.expectedRevisionId);
  if ((n === 0) !== (c === null && r === null) || n > 0 && (c === null || r === null)) throw groupError('현재 확인판을 선택하세요.');
  const result = { draft: draft(p.draft), caseId: c, expectedVersion: n, expectedRevisionId: r };
  return save ? { ...result, expectedPreviewHash: groupHash(p.expectedPreviewHash), requestId: groupId(p.requestId) } : result;
}
export function validateGroupWithdraw(v: unknown): SupplyGroupWithdrawInput {
  const p = groupObject(v); groupKeys(p, ['subjectId', 'caseId', 'expectedVersion', 'expectedRevisionId', 'reason', 'requestId']);
  const n = version(p.expectedVersion); if (!n) throw groupError('철회할 확인판을 선택하세요.');
  return { subjectId: groupId(p.subjectId), caseId: groupId(p.caseId), expectedVersion: n, expectedRevisionId: groupId(p.expectedRevisionId), reason: groupText(p.reason), requestId: groupId(p.requestId) };
}
