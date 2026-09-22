import { vatCanonicalV2 } from './vat-canonical-v2';
import { SUPPLY_REVIEW_SCHEMA, type ReviewMoney, type SupplyReviewDraft, type SupplyReviewBasis,
  type SupplyReviewAssessment, type SupplyReviewIssue, type SupplyReviewSourceSnapshot,
  type SupplyReviewPreviewInput, type SupplyReviewSaveInput, type SupplyReviewWithdrawInput } from './supply-review-types';

/** DE-0 records and diagnoses declared facts; it never authorizes VAT or journal consumption. */
export const supplyReviewError = (message: string, status = 400, code = 'supply_review_input') =>
  Object.assign(new Error(message), { status, code });
const invalid = (message: string): never => { throw supplyReviewError(message); };
const object = (v: unknown, keys: string[], label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype
    || Reflect.ownKeys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) invalid(`${label}의 항목을 확인하세요.`);
  for (const k of keys) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid(`${label}에는 일반 값만 입력하세요.`); }
  return v as Record<string, unknown>;
};
const text = (v: unknown, label: string, max = 200, empty = false): string => {
  if (typeof v !== 'string' || v.length > max || (!empty && !v.trim()) || v.includes('\0')) invalid(`${label}의 길이와 내용을 확인하세요.`);
  return v as string;
};
const id = (v: unknown, label: string): string => {
  const s = text(v, label); if (s.trim() !== s || /[\x00-\x20\x7f]/.test(s)) invalid(`${label}의 식별자를 확인하세요.`); return s;
};
const nullableId = (v: unknown, label: string): string | null => v === null ? null : id(v, label);
const integer = (v: unknown, label: string, nonnegative = false): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || (nonnegative && v < 0)) invalid(`${label}에는 안전한 원 단위 정수를 입력하세요.`);
  return Object.is(v, -0) ? 0 : v as number;
};
const date = (v: unknown, label: string): string => {
  const s = text(v, label, 10); if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(s)) invalid(`${label}에는 실제 날짜를 입력하세요.`);
  const d = new Date(`${s}T00:00:00Z`); if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) invalid(`${label}에는 실제 날짜를 입력하세요.`); return s;
};
const oneOf = (v: unknown, choices: string[], label: string): string => {
  if (typeof v !== 'string' || !choices.includes(v)) invalid(`${label}의 구분을 확인하세요.`); return v as string;
};
const array = (v: unknown, label: string, max: number, min = 0): unknown[] => {
  if (!Array.isArray(v) || v.length < min || v.length > max) invalid(`${label}의 건수를 확인하세요.`); return v as unknown[];
};
const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) invalid(`${label}의 식별자가 중복됩니다.`); };
const wire = (v: unknown, max = 300_000) => {
  try { if (vatCanonicalV2(v).length > max) invalid('입력 자료의 크기가 허용 범위를 초과합니다.'); }
  catch (e) { if ((e as { code?: string }).code === 'supply_review_input') throw e; invalid('입력 자료에는 일반 객체와 안전한 정수·문자열만 사용할 수 있습니다.'); }
};
const money = (v: Record<string, unknown>, label: string): ReviewMoney => {
  const supply = integer(v.supply, `${label} 공급가액`), tax = integer(v.tax, `${label} 세액`), total = integer(v.total, `${label} 합계`);
  if (BigInt(supply) + BigInt(tax) !== BigInt(total)) invalid(`${label}의 공급가액·세액·합계가 일치하지 않습니다.`);
  return { supply, tax, total };
};
const sumSafe = (values: number[], label: string) => {
  const n = values.reduce((a, v) => a + BigInt(v), BigInt(0));
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) invalid(`${label} 합계가 안전한 원 단위 범위를 초과합니다.`);
  return Number(n);
};
const sumMoney = (values: ReviewMoney[]): ReviewMoney => ({ supply: sumSafe(values.map(v => v.supply), '공급가액'), tax: sumSafe(values.map(v => v.tax), '세액'), total: sumSafe(values.map(v => v.total), '금액') });
const zero = (): ReviewMoney => ({ supply: 0, tax: 0, total: 0 });
const sameMoney = (a: ReviewMoney, b: ReviewMoney) => a.supply === b.supply && a.tax === b.tax && a.total === b.total;

export function validateSupplyReviewDraft(input: unknown): SupplyReviewDraft {
  wire(input);
  const d = object(input, ['schemaVersion', 'subjectId', 'title', 'reason', 'lines', 'members', 'allocations', 'claims'], '공급 검토');
  if (d.schemaVersion !== SUPPLY_REVIEW_SCHEMA) invalid('지원하는 공급 검토 형식을 확인하세요.');
  id(d.subjectId, '신고 주체'); text(d.title, '제목', 200); text(d.reason, '검토 사유', 2000);
  const lines = array(d.lines, '공급행', 100, 1).map(v => {
    const l = object(v, ['lineId', 'description', 'dateFrom', 'dateTo', 'fulfillment', 'documentId', 'evidenceLocation', 'supply', 'tax', 'total'], '공급행');
    id(l.lineId, '공급행'); text(l.description, '공급 내용', 1000); date(l.dateFrom, '공급 시작일'); date(l.dateTo, '공급 종료일');
    if ((l.dateFrom as string) > (l.dateTo as string)) invalid('공급 시작일은 종료일보다 늦을 수 없습니다.');
    oneOf(l.fulfillment, ['completed', 'partial', 'advance', 'unknown'], '공급 완료'); nullableId(l.documentId, '공급 증빙'); text(l.evidenceLocation, '공급 증빙 위치', 500, true); money(l, '공급행'); return l;
  });
  const members = array(d.members, '원천 구성원', 100, 1).map(v => {
    const m = object(v, ['memberId', 'kind', 'sourceId', 'correction'], '원천 구성원');
    id(m.memberId, '구성원'); id(m.sourceId, '원천'); oneOf(m.kind, ['card', 'hometax', 'tax_invoice'], '원천 종류');
    const c = object(m.correction, ['isCorrection', 'reason', 'originalApprovalNumber', 'originalMemberId', 'referenceStatus', 'role', 'documentId', 'evidenceLocation'], '수정 계보');
    if (typeof c.isCorrection !== 'boolean') invalid('수정 여부를 확인하세요.');
    text(c.reason, '수정 사유', 2000, true); nullableId(c.originalApprovalNumber, '원 승인번호'); nullableId(c.originalMemberId, '원 구성원');
    oneOf(c.referenceStatus, ['not_collected', 'not_provided', 'unresolved', 'declared'], '원 계산서 수집 상태');
    oneOf(c.role, ['unknown', 'reversal', 'replacement', 'delta'], '수정 역할'); nullableId(c.documentId, '수정 증빙'); text(c.evidenceLocation, '수정 증빙 위치', 500, true); return m;
  });
  const allocations = array(d.allocations, '원천 배부', 400).map(v => {
    const a = object(v, ['allocationId', 'memberId', 'lineId', 'supply', 'tax', 'total'], '원천 배부');
    id(a.allocationId, '배부'); id(a.memberId, '배부 구성원'); id(a.lineId, '배부 공급행'); money(a, '배부'); return a;
  });
  const claims = array(d.claims, '기공제 근거', 200).map(v => {
    const c = object(v, ['claimId', 'lineId', 'memberId', 'origin', 'reference', 'claimedSupply', 'claimedTax', 'coverage', 'documentId', 'evidenceLocation', 'cReference'], '기공제 근거');
    id(c.claimId, '기공제'); id(c.lineId, '기공제 공급행'); id(c.memberId, '기공제 구성원'); oneOf(c.origin, ['external', 'c_consumption'], '기공제 출처');
    text(c.reference, '기공제 참조', 1000, true); integer(c.claimedSupply, '기공제 공급가액', true); integer(c.claimedTax, '기공제 세액', true);
    oneOf(c.coverage, ['exact', 'partial', 'unknown'], '기공제 대사 범위'); nullableId(c.documentId, '기공제 증빙'); text(c.evidenceLocation, '기공제 증빙 위치', 500, true);
    if (c.cReference !== null) {
      const r = object(c.cReference, ['revisionId', 'pairLineNo'], 'C 소비 참조'); id(r.revisionId, 'C 검토판'); const line = integer(r.pairLineNo, 'C 쌍 번호', true);
      if (line > 99) invalid('C 쌍 번호는 0부터 99까지입니다.');
    }
    // An absent C reference may be recorded as missing evidence; an external claim cannot carry a contradictory C reference.
    if (c.origin === 'external' && c.cReference !== null) invalid('외부 기공제 근거에는 C 소비 참조를 넣을 수 없습니다.'); return c;
  });
  unique(lines.map(l => l.lineId as string), '공급행'); unique(members.map(m => m.memberId as string), '구성원');
  unique(allocations.map(a => a.allocationId as string), '배부'); unique(claims.map(c => c.claimId as string), '기공제');
  const lineIds = new Set(lines.map(l => l.lineId)), memberIds = new Set(members.map(m => m.memberId));
  for (const a of [...allocations, ...claims]) if (!lineIds.has(a.lineId) || !memberIds.has(a.memberId)) invalid('배부·기공제의 공급행과 구성원을 먼저 등록하세요.');
  for (const m of members) { const c = m.correction as Record<string, unknown>; if (c.originalMemberId !== null && !memberIds.has(c.originalMemberId)) invalid('원 계산서 구성원을 먼저 등록하거나 미수집 상태로 기록하세요.'); }
  const draft = structuredClone(input) as SupplyReviewDraft;
  sumMoney(draft.lines); sumMoney(draft.allocations); sumSafe(draft.claims.map(c => c.claimedSupply), '기공제 공급가액'); sumSafe(draft.claims.map(c => c.claimedTax), '기공제 세액');
  return draft;
}

export function validateSupplyReviewPreviewInput(input: unknown): SupplyReviewPreviewInput {
  wire(input); const p = object(input, ['caseId', 'draft'], '미리보기'); return { caseId: nullableId(p.caseId, '검토 사건'), draft: validateSupplyReviewDraft(p.draft) };
}
export function validateSupplyReviewSaveInput(input: unknown): SupplyReviewSaveInput {
  wire(input); const p = object(input, ['caseId', 'draft', 'requestId', 'expectedRevisionId', 'expectedVersion', 'expectedPreviewHash'], '검토 저장');
  const caseId = nullableId(p.caseId, '검토 사건'), expectedRevisionId = nullableId(p.expectedRevisionId, '예상 검토판'), expectedVersion = integer(p.expectedVersion, '예상 판번호', true);
  if ((caseId === null) !== (expectedVersion === 0) || (expectedRevisionId === null) !== (expectedVersion === 0)) invalid('새 검토와 기존 검토의 판번호·참조를 확인하세요.');
  if (typeof p.expectedPreviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.expectedPreviewHash)) invalid('미리보기 근거를 확인하세요.');
  return { caseId, draft: validateSupplyReviewDraft(p.draft), requestId: id(p.requestId, '요청'), expectedRevisionId, expectedVersion, expectedPreviewHash: p.expectedPreviewHash as string };
}
export function validateSupplyReviewWithdrawInput(input: unknown): SupplyReviewWithdrawInput {
  wire(input); const p = object(input, ['caseId', 'requestId', 'expectedRevisionId', 'expectedVersion', 'reason'], '검토 철회');
  const expectedVersion = integer(p.expectedVersion, '예상 판번호', true); if (!expectedVersion) invalid('철회할 검토판을 확인하세요.');
  return { caseId: id(p.caseId, '검토 사건'), requestId: id(p.requestId, '요청'), expectedRevisionId: id(p.expectedRevisionId, '검토판'), expectedVersion, reason: text(p.reason, '철회 사유', 2000) };
}

const missingSourceReview = (code: string) => code === 'card_tax_review_required' || code === 'official_invoice_key_required'
  || /검토해야|번호.*누락|review_required|not_transmitted/.test(code);
const sourceConflict = (code: string) => /stale|changed|conflict|excluded|cancel|불일치|변경|중복/.test(code);

export function assessSupplyReview(input: SupplyReviewDraft, basis: SupplyReviewBasis): SupplyReviewAssessment {
  const draft = validateSupplyReviewDraft(input), issues: SupplyReviewIssue[] = [];
  const add = (code: string, message: string, scope: string, severity: SupplyReviewIssue['severity'] = 'missing') => {
    if (!issues.some(i => i.code === code && i.scope === scope && i.message === message)) issues.push({ code, message, scope, severity });
  };
  for (const i of basis.subjectIssues) add(i.code, i.message, i.scope, i.severity);
  if (basis.schemaVersion !== 'de0-supply-basis-v1' || basis.subjectId !== draft.subjectId) add('basis_subject_mismatch', '신고 주체와 수집 근거의 주체가 다릅니다.', 'subject', 'conflict');
  const members = new Map(draft.members.map(m => [m.memberId, m])), lines = new Map(draft.lines.map(l => [l.lineId, l]));
  const sourceGroups = new Map<string, SupplyReviewSourceSnapshot[]>();
  for (const s of basis.sources) { const list = sourceGroups.get(s.memberId) ?? []; list.push(s); sourceGroups.set(s.memberId, list); }
  const sources = new Map<string, SupplyReviewSourceSnapshot>();
  for (const m of draft.members) {
    const matches = sourceGroups.get(m.memberId) ?? [];
    if (matches.length !== 1) { add(matches.length ? 'source_snapshot_ambiguous' : 'source_missing', matches.length ? '구성원의 원천 근거가 둘 이상입니다.' : '원천을 수집하거나 정확한 원천 참조를 확인하세요.', `member:${m.memberId}`, matches.length ? 'conflict' : 'missing'); continue; }
    const s = matches[0]; sources.set(m.memberId, s);
    if (!s.found) add('source_missing', '원천이 수집되지 않아 금액과 계보를 대사할 수 없습니다.', `member:${m.memberId}`);
    if (s.kind !== m.kind || s.sourceId !== m.sourceId) add('source_identity_mismatch', '구성원 참조와 수집된 원천이 다릅니다.', `member:${m.memberId}`, 'conflict');
    if (s.found && (!s.sourceHash || !s.canonicalKey)) add('source_identity_incomplete', '원천 지문과 별칭의 근거가 부족합니다.', `member:${m.memberId}`);
    if (![s.supply, s.tax, s.total].every(Number.isSafeInteger) || BigInt(Number.isSafeInteger(s.supply) ? s.supply : 0) + BigInt(Number.isSafeInteger(s.tax) ? s.tax : 0) !== BigInt(Number.isSafeInteger(s.total) ? s.total : 0)) {
      add('source_money_invalid', '원천 금액의 단위와 성분합계를 확인하세요.', `member:${m.memberId}`, 'conflict');
    }
    for (const code of s.sourceIssues) {
      if (code === 'modified_invoice_not_supported') add('source_correction_requires_lineage', '수정세금계산서는 기존 연결 경로에서 미지원입니다. 여기서는 수정 계보 근거만 기록합니다.', `member:${m.memberId}`, 'unsupported');
      else add('source_issue', `원천 확인: ${code}`, `member:${m.memberId}`, sourceConflict(code) ? 'conflict' : missingSourceReview(code) ? 'missing' : 'unsupported');
    }
    if (s.sourceIssues.includes('modified_invoice_not_supported') && !m.correction.isCorrection) add('correction_declaration_missing', '수정 원천을 일반 원본으로 선언할 수 없습니다.', `member:${m.memberId}`, 'conflict');
  }
  const evidence = (documentId: string | null, location: string, scope: string) => {
    if (!documentId) { add('document_missing', '확인할 증빙 문서를 지정하세요.', scope); return; }
    const docs = basis.documents.filter(d => d.documentId === documentId);
    if (!docs.length) add('document_missing', '해당 증빙 문서의 원문 근거가 없습니다.', scope);
    else if (docs.length !== 1 || docs[0].subjectId !== draft.subjectId) add('document_subject_mismatch', '증빙 문서의 주체 또는 단일성을 확인하세요.', scope, 'conflict');
    if (!location.trim()) add('evidence_location_missing', '증빙에서 확인할 위치를 기록하세요.', scope);
  };
  for (const l of draft.lines) {
    const scope = `line:${l.lineId}`; evidence(l.documentId, l.evidenceLocation, scope);
    if (l.fulfillment !== 'completed') add('supply_not_completed', '공급의 완료 여부와 실제 공급 범위를 확인하세요. 선급·부분·미확인은 공제 근거가 아닙니다.', scope);
    if (l.dateFrom > l.dateTo) add('supply_period_invalid', '공급 시작일이 종료일보다 늦습니다.', scope, 'conflict');
    if (!l.total && !l.supply && !l.tax) add('supply_zero_amount', '0원 공급행의 내용을 확인하세요.', scope);
    const allocated = draft.allocations.filter(a => a.lineId === l.lineId);
    if (!allocated.length) add('line_allocation_missing', '공급행과 원천의 대응 배부가 없습니다.', scope);
    else {
      // A card and an invoice can evidence the same supply. Each evidence family is reconciled independently;
      // invoice originals and signed corrections remain in one family and retain their signed net amount.
      const families = new Map<string, ReviewMoney[]>();
      for (const allocation of allocated) { const family = members.get(allocation.memberId)!.kind === 'card' ? 'card' : 'invoice'; const group = families.get(family) ?? []; group.push(allocation); families.set(family, group); }
      let complete = false;
      for (const [family, values] of families) {
        const amount = sumMoney(values), familyScope = `${scope}:${family}`;
        if (sameMoney(amount, l)) complete = true;
        for (const field of ['supply', 'tax', 'total'] as const) {
          if (amount[field] !== 0 && (l[field] === 0 || Math.sign(amount[field]) !== Math.sign(l[field]))) add('line_allocation_sign_mismatch', '증빙군의 배부 순액과 공급행 금액 방향이 다릅니다.', familyScope, 'conflict');
          if (Math.abs(amount[field]) > Math.abs(l[field])) add('line_allocation_capacity_exceeded', '카드 또는 계산서 증빙군의 배부 금액이 공급행의 성분별 금액을 초과합니다.', familyScope, 'conflict');
        }
      }
      if (!complete) add('line_allocation_incomplete', '공급행 전체에 대응하는 카드 또는 계산서 증빙군이 아직 없습니다. 서로 다른 증빙군의 부분금액을 합쳐 완전 대사로 판단하지 않습니다.', scope);
    }
  }
  const pairs = new Set<string>();
  for (const a of draft.allocations) {
    const key = `${a.memberId}\0${a.lineId}`;
    if (pairs.has(key)) add('allocation_pair_duplicate', '같은 구성원·공급행 배부가 중복됩니다.', `allocation:${a.allocationId}`, 'conflict'); pairs.add(key);
  }
  const capacities = (values: ReviewMoney[], capacity: ReviewMoney, scope: string) => {
    for (const field of ['supply', 'tax', 'total'] as const) {
      const parts = values.map(v => v[field]);
      if (parts.some(n => n !== 0 && (capacity[field] === 0 || Math.sign(n) !== Math.sign(capacity[field])))) add('allocation_sign_mismatch', '배부의 방향이 원천 금액과 다릅니다. 양수·음수를 상쇄해 용량을 맞추지 마세요.', scope, 'conflict');
      if (parts.reduce((n, p) => n + BigInt(Math.abs(p)), BigInt(0)) > BigInt(Math.abs(capacity[field]))) add('allocation_capacity_exceeded', '배부의 공급가액·세액·합계 중 원천 한도를 넘는 성분이 있습니다.', scope, 'conflict');
    }
  };
  const memberTotals: SupplyReviewAssessment['memberTotals'] = [];
  for (const m of draft.members) {
    const s = sources.get(m.memberId), allocated = sumMoney(draft.allocations.filter(a => a.memberId === m.memberId));
    const safe = !!s && [s.supply, s.tax, s.total].every(Number.isSafeInteger), value = safe ? { supply: s!.supply, tax: s!.tax, total: s!.total } : zero();
    if (s?.found && safe) capacities(draft.allocations.filter(a => a.memberId === m.memberId), value, `member:${m.memberId}`);
    const remaining = { supply: sumSafe([value.supply, -allocated.supply], '잔여 공급가액'), tax: sumSafe([value.tax, -allocated.tax], '잔여 세액'), total: sumSafe([value.total, -allocated.total], '잔여 금액') };
    memberTotals.push({ memberId: m.memberId, ...value, allocated, remaining });
  }
  // Multiple rows for the same official representation share capacity. Corrections are distinct supplies, never aliases of the original.
  const aliases = new Map<string, typeof draft.members>();
  for (const m of draft.members) { const s = sources.get(m.memberId); if (s?.found && s.canonicalKey) { const list = aliases.get(s.canonicalKey) ?? []; list.push(m); aliases.set(s.canonicalKey, list); } }
  for (const [key, group] of aliases) if (group.length > 1) {
    const values = group.map(m => sources.get(m.memberId)!);
    if (values.some(s => !sameMoney(s, values[0]))) add('alias_money_conflict', '같은 원천 별칭의 금액 표현이 서로 다릅니다.', `alias:${key}`, 'conflict');
    if (group.some(m => m.correction.isCorrection) && group.some(m => !m.correction.isCorrection)) add('correction_original_alias_conflict', '수정 원천과 원본을 같은 별칭으로 합칠 수 없습니다.', `alias:${key}`, 'conflict');
    const allocations = draft.allocations.filter(a => group.some(m => m.memberId === a.memberId));
    if ([values[0].supply, values[0].tax, values[0].total].every(Number.isSafeInteger)) capacities(allocations, values[0], `alias:${key}`);
    const aliasedPairs = new Set<string>();
    for (const a of allocations) { if (aliasedPairs.has(a.lineId)) add('alias_allocation_duplicate', '같은 공식 원천의 여러 표현을 같은 공급행에 중복 배부했습니다.', `line:${a.lineId}`, 'conflict'); aliasedPairs.add(a.lineId); }
    const claims = draft.claims.filter(c => group.some(m => m.memberId === c.memberId));
    if (sumSafe(claims.map(c => c.claimedSupply), '별칭 기공제 공급가액') > Math.max(0, values[0].supply)
      || sumSafe(claims.map(c => c.claimedTax), '별칭 기공제 세액') > Math.max(0, values[0].tax)) add('claim_alias_capacity_exceeded', '동일 공식 원천의 별칭들에 선언한 기공제 부분의 합계가 원천 금액을 초과합니다.', `alias:${key}`, 'conflict');
  }
  for (const m of draft.members) {
    const c = m.correction, scope = `member:${m.memberId}`, current = sources.get(m.memberId);
    let metadata: Record<string, unknown> | null = null;
    if (current?.found) {
      try { const parsed: unknown = JSON.parse(current.metadataText); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Invalid metadata'); metadata = parsed as Record<string, unknown>; }
      catch { add('source_metadata_unavailable', '수집된 수정 계보의 원문 메타데이터를 확인할 수 없습니다.', scope, 'conflict'); }
      if (metadata?.kind && metadata.kind !== m.kind) add('source_metadata_kind_mismatch', '수집된 계보 근거의 원천 종류가 구성원과 다릅니다.', scope, 'conflict');
      const modifyCode = metadata?.modifyCode;
      if (modifyCode !== undefined && modifyCode !== null && modifyCode !== '' && modifyCode !== 0 && modifyCode !== '0' && !c.isCorrection) add('correction_declaration_missing', '수집된 수정사유 코드가 있어 일반 원본으로 선언할 수 없습니다.', scope, 'conflict');
      if (metadata?.ownApprovalNumber && current.ownApprovalNumber && metadata.ownApprovalNumber !== current.ownApprovalNumber) add('source_metadata_approval_mismatch', '기존 원천과 별도 계보 조회의 공식 승인번호가 다릅니다.', scope, 'conflict');
      if (m.kind === 'hometax' && metadata && Object.hasOwn(metadata, 'rawWriteDate')) {
        const raw = metadata.rawWriteDate, normalized = typeof raw === 'string' && /^\d{8}$/.test(raw)
          ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
        let validWriteDate: string | null = null;
        try { validWriteDate = date(normalized, '수집 원문 작성일'); } catch { /* Missing/invalid collected date is a recordable diagnostic. */ }
        if (!validWriteDate) add('source_date_unverified', '수집 원문의 계산서 작성일이 없거나 불명확합니다. 발급일·전송일로 작성일을 추정하지 않습니다.', scope);
        else if (validWriteDate !== current.date) add('source_date_conflict', '기존 원천의 귀속 일자와 별도로 수집한 원문 작성일이 다릅니다.', scope, 'conflict');
      }
    }
    if (!c.isCorrection) {
      if (c.originalApprovalNumber !== null || c.originalMemberId !== null || c.role !== 'unknown') add('original_has_correction_reference', '일반 원천에 수정 계보가 함께 선언되어 있습니다.', scope, 'conflict');
      continue;
    }
    evidence(c.documentId, c.evidenceLocation, `correction:${m.memberId}`);
    if (m.kind === 'card') add('card_correction_unsupported', '카드 취소와 수정세금계산서 계보는 별개의 근거가 필요합니다.', scope, 'unsupported');
    if (!c.reason.trim() || c.role === 'unknown') add('correction_details_missing', '수정사유와 수정 원천의 역할을 확인하세요.', scope);
    if (!c.originalApprovalNumber) add('correction_original_approval_missing', '원 계산서의 공식 승인번호가 없습니다.', scope);
    if (!c.originalMemberId || c.referenceStatus !== 'declared') add(`correction_original_${c.referenceStatus}`, '원 계산서의 수집 및 정확한 참조를 확인하세요.', scope);
    if (metadata?.originalReferenceCollection === 'stored_app_reference') {
      const storedId = typeof metadata.originalInvoiceId === 'string' && metadata.originalInvoiceId ? metadata.originalInvoiceId : null;
      const storedApproval = typeof metadata.originalApprovalNumber === 'string' && metadata.originalApprovalNumber ? metadata.originalApprovalNumber : null;
      if (!storedId) add('collected_original_reference_missing', '앱 수정 원천에 저장된 원 계산서 참조가 없습니다.', scope);
      if (storedId && metadata.originalRowFound !== true) add('collected_original_row_missing', '앱에 저장된 원 계산서 ID의 원본 행이 수집되어 있지 않습니다.', scope);
      if (storedApproval && c.originalApprovalNumber && storedApproval !== c.originalApprovalNumber) add('collected_original_approval_mismatch', '앱에 저장된 실제 원 승인번호와 선언한 원 승인번호가 다릅니다.', scope, 'conflict');
      if (storedId && !c.originalMemberId) add('collected_original_not_selected', '앱에 저장된 실제 원 계산서 참조를 검토 구성원에 대응하세요.', scope);
      if (storedId && c.originalMemberId) {
        const declared = members.get(c.originalMemberId)!, originalSource = sources.get(c.originalMemberId);
        const exactAppId = declared.kind === 'tax_invoice' && declared.sourceId === storedId;
        const exactHometaxAlias = declared.kind === 'hometax' && !!storedApproval && originalSource?.found && originalSource.ownApprovalNumber === storedApproval;
        if (!exactAppId && !exactHometaxAlias) add('collected_original_member_mismatch', '수집된 앱 원 계산서 ID 또는 그 공식 홈택스 별칭과 선언한 원 구성원이 다릅니다.', scope, 'conflict');
      }
    }
    if (c.originalMemberId) {
      const original = sources.get(c.originalMemberId);
      if (!original?.found) add('correction_original_source_missing', '참조한 원 계산서가 수집되지 않았습니다.', scope);
      if (c.originalMemberId === m.memberId) add('correction_cycle', '수정 원천이 자신을 원 계산서로 참조합니다.', scope, 'conflict');
      if (original?.ownApprovalNumber && c.originalApprovalNumber && original.ownApprovalNumber !== c.originalApprovalNumber) add('correction_original_approval_mismatch', '원 승인번호가 참조한 원 계산서와 다릅니다.', scope, 'conflict');
      if (original?.found && !original.ownApprovalNumber) add('correction_original_approval_unavailable', '수집 원본의 공식 승인번호를 확인할 수 없습니다.', scope);
      if (current?.canonicalKey && original?.canonicalKey === current.canonicalKey) add('correction_original_alias_conflict', '수정 원천을 원 계산서와 동일한 별칭으로 합칠 수 없습니다.', scope, 'conflict');
    }
    const seen = new Set<string>([m.memberId]); let next = c.originalMemberId;
    while (next) { if (seen.has(next)) { add('correction_cycle', '수정 계보에 순환 참조가 있습니다.', scope, 'conflict'); break; } seen.add(next); next = members.get(next)?.correction.originalMemberId ?? null; }
    if (current?.found && c.role === 'reversal' && current.total > 0) add('correction_reversal_sign', '취소 역할로 선언한 수정 원천의 금액이 양수입니다. 수정사유와 표현을 대사하세요.', scope, 'conflict');
    // Positive, multiple and chained corrections are not automatically rejected. Their exact references and allocations decide the diagnostic.
  }
  const cKeys = new Map<string, typeof draft.claims>(), externalClaimKeys = new Set<string>();
  for (const claim of draft.claims) {
    const scope = `claim:${claim.claimId}`, source = sources.get(claim.memberId), line = lines.get(claim.lineId)!;
    evidence(claim.documentId, claim.evidenceLocation, scope);
    if (!claim.reference.trim()) add('claim_reference_missing', '기공제된 신고서와 명세 위치를 기록하세요.', scope);
    if (claim.coverage !== 'exact') add('claim_coverage_incomplete', '기공제된 정확한 부분의 대응이 끝나지 않았습니다. 잔여 금액을 공제로 계산하지 않습니다.', scope);
    if (!claim.claimedSupply && !claim.claimedTax) add('claim_zero_amount', '기공제 0원 근거의 내용을 확인하세요.', scope);
    const allocated = sumMoney(draft.allocations.filter(a => a.memberId === claim.memberId && a.lineId === claim.lineId));
    if (claim.claimedSupply > Math.max(0, allocated.supply) || claim.claimedTax > Math.max(0, allocated.tax)
      || claim.claimedSupply > Math.max(0, line.supply) || claim.claimedTax > Math.max(0, line.tax)) add('claim_allocation_exceeded', '기공제된 공급가액 또는 세액이 해당 원천·공급행 배부를 초과합니다.', scope, 'conflict');
    if (source?.found && (claim.claimedSupply > Math.max(0, source.supply) || claim.claimedTax > Math.max(0, source.tax))) add('claim_source_exceeded', '기공제 근거가 원천 금액을 초과합니다.', scope, 'conflict');
    if (claim.origin !== 'c_consumption') {
      const canonical = source?.canonicalKey ?? `${members.get(claim.memberId)!.kind}:${members.get(claim.memberId)!.sourceId}`;
      const key = `${canonical}\0${claim.lineId}\0${claim.reference}`;
      if (claim.reference.trim() && externalClaimKeys.has(key)) add('claim_reference_duplicate', '같은 원천·공급행·기공제 참조를 중복 선언했습니다. 서로 다른 부분의 근거를 구분하세요.', scope, 'conflict');
      externalClaimKeys.add(key); continue;
    }
    if (!claim.cReference) { add('c_reference_missing', 'C 소비의 정확한 검토판과 쌍 번호를 지정하세요.', scope); continue; }
    const ref = claim.cReference, key = `${ref.revisionId}\0${ref.pairLineNo}`, claimed = cKeys.get(key) ?? []; claimed.push(claim); cKeys.set(key, claimed);
    const matches = basis.cReferences.filter(r => r.revisionId === ref.revisionId && r.pairLineNo === ref.pairLineNo), c = matches[0];
    if (matches.length !== 1 || !c?.found || !c.consumptionId) { add(matches.length > 1 ? 'c_reference_ambiguous' : 'c_reference_missing', 'C의 실제 소비행과 정확한 쌍을 확인할 수 없습니다.', scope, matches.length > 1 ? 'conflict' : 'missing'); continue; }
    if (c.subjectId !== draft.subjectId) add('c_reference_subject_mismatch', 'C 소비와 현재 검토의 신고 주체가 다릅니다.', scope, 'conflict');
    const historical = members.get(claim.memberId)!;
    if (c.historicalKind !== historical.kind || c.historicalSourceId !== historical.sourceId) add('c_reference_historical_source_mismatch', 'C 쌍의 과거 기공제 원천과 현재 선택한 구성원이 다릅니다. 당기 측 공제액을 과거 기공제로 읽지 않습니다.', scope, 'conflict');
    // C's past.claim.supply is the whole source amount, not the supply amount attributable to a partial tax claim.
    // A missing claimedSupply remains unknown; neither proportional allocation nor the full source amount is an oracle.
    if (c.claimedSupply === null) { if (claim.claimedSupply > 0) add('c_claim_supply_unverified', 'C 소비에는 실제 기공제 공급가액이 없습니다. 원천 전체 공급가액이나 세액 비율로 추정하지 않습니다.', scope); }
    else if (!Number.isSafeInteger(c.claimedSupply) || c.claimedSupply < 0) add('c_reference_money_unavailable', 'C 소비의 기공제 공급가액 근거를 확인할 수 없습니다.', scope);
    else if (claim.claimedSupply > c.claimedSupply) add('c_reference_amount_exceeded', '선택한 기공제 공급가액이 C의 확인된 공급가액을 초과합니다.', scope, 'conflict');
    if (!Number.isSafeInteger(c.claimedTax) || c.claimedTax! < 0) add('c_reference_money_unavailable', 'C 소비의 과거 기공제 세액을 확인할 수 없습니다.', scope);
    else if (claim.claimedTax > c.claimedTax!) add('c_reference_amount_exceeded', '선택한 기공제 세액이 C 과거 측의 기공제 세액을 초과합니다.', scope, 'conflict');
    add('c_consumption_requires_exact_portion', 'C는 별개 공급을 검토한 소비입니다. 같은 쌍 참조만으로 E의 동일 공급·기공제 부분이 일치한다고 판단하지 않습니다.', scope, 'unsupported');
  }
  for (const [key, group] of cKeys) if (group.length > 1) {
    const c = basis.cReferences.find(r => `${r.revisionId}\0${r.pairLineNo}` === key);
    if (group.some((a, index) => group.slice(index + 1).some(b => a.memberId === b.memberId && a.lineId === b.lineId))) add('c_reference_portion_duplicate', '같은 C 쌍·원천·공급행의 기공제 부분이 중복 선언됐습니다.', `c:${key.replace('\0', ':')}`, 'conflict');
    if (c?.found && ((Number.isSafeInteger(c.claimedSupply) && sumSafe(group.map(g => g.claimedSupply), 'C 기공제 공급가액') > c.claimedSupply!)
      || (Number.isSafeInteger(c.claimedTax) && sumSafe(group.map(g => g.claimedTax), 'C 기공제 세액') > c.claimedTax!))) add('c_reference_capacity_exceeded', '동일 C 쌍에 선언한 기공제 부분의 합계가 과거 기공제 금액을 초과합니다.', `c:${key.replace('\0', ':')}`, 'conflict');
  }
  for (const line of draft.lines) {
    const claims = draft.claims.filter(c => c.lineId === line.lineId);
    if (sumSafe(claims.map(c => c.claimedSupply), '공급행 기공제 공급가액') > Math.max(0, line.supply) || sumSafe(claims.map(c => c.claimedTax), '공급행 기공제 세액') > Math.max(0, line.tax)) add('claim_line_capacity_exceeded', '공급행에 선언한 기공제 부분의 합계가 공급 금액을 초과합니다.', `line:${line.lineId}`, 'conflict');
  }
  for (const member of draft.members) {
    const claims = draft.claims.filter(c => c.memberId === member.memberId), s = sources.get(member.memberId);
    if (s?.found && (sumSafe(claims.map(c => c.claimedSupply), '원천 기공제 공급가액') > Math.max(0, s.supply) || sumSafe(claims.map(c => c.claimedTax), '원천 기공제 세액') > Math.max(0, s.tax))) add('claim_source_capacity_exceeded', '동일 원천에 선언한 기공제 부분의 합계가 원천 금액을 초과합니다.', `member:${member.memberId}`, 'conflict');
    for (const lineId of new Set(claims.map(c => c.lineId))) {
      const group = claims.filter(c => c.lineId === lineId), allocated = sumMoney(draft.allocations.filter(a => a.memberId === member.memberId && a.lineId === lineId));
      if (sumSafe(group.map(c => c.claimedSupply), '원천 공급행 기공제 공급가액') > Math.max(0, allocated.supply)
        || sumSafe(group.map(c => c.claimedTax), '원천 공급행 기공제 세액') > Math.max(0, allocated.tax)) add('claim_allocation_capacity_exceeded', '같은 원천·공급행에 선언한 기공제 부분의 합계가 해당 배부를 초과합니다.', `member-line:${member.memberId}:${lineId}`, 'conflict');
    }
  }
  return { schemaVersion: 'de0-supply-assessment-v1', status: issues.length ? 'needs_information' : 'reviewable', canApply: false,
    consumptionSupported: false, issues, lineTotals: sumMoney(draft.lines), claimedTotals: { supply: sumSafe(draft.claims.map(c => c.claimedSupply), '기공제 공급가액'), tax: sumSafe(draft.claims.map(c => c.claimedTax), '기공제 세액') }, memberTotals,
    additionalVatDeduction: null };
}
