/** Only static, user-facing diagnostics leave the VAT E boundary. SQL details and arbitrary issue text do not. */
export const VAT_SAME_SUPPLY_MESSAGES = {
  vat_same_supply_input: '같은 공급의 회사·검토 종류·정확한 확인판을 확인하세요.',
  vat_same_supply_scope_unsupported: '같은 공급 공제 조정은 봉인 근거가 있는 확정신고에서 지원합니다.',
  vat_same_supply_record_missing: '요청한 확인판을 찾을 수 없습니다. 회사와 사건을 다시 확인하세요.',
  vat_same_supply_conflict: '선택한 근거가 변경됐거나 현재 지원 범위와 맞지 않습니다. 최신 판과 공제·귀속 판단을 확인한 뒤 다시 계산하세요.',
  vat_same_supply_unavailable: '같은 공급의 저장 근거를 검증할 수 없습니다. 처리 중이던 요청은 같은 요청으로 결과를 확인하세요.',
} as const;
export function sameSupplyErrorResponse(error: unknown, write = false) {
  const source = error as { status?: number; code?: unknown };
  const status = [400, 404, 409, 503].includes(source?.status ?? 0) ? source.status! : 503;
  const fallback = status === 400 ? 'vat_same_supply_input' : status === 404 ? 'vat_same_supply_record_missing' : status === 409 ? 'vat_same_supply_conflict' : 'vat_same_supply_unavailable';
  const code = typeof source?.code === 'string' && Object.hasOwn(VAT_SAME_SUPPLY_MESSAGES, source.code) ? source.code as keyof typeof VAT_SAME_SUPPLY_MESSAGES : fallback;
  return { status, body: { error: VAT_SAME_SUPPLY_MESSAGES[code], code, issues: [], canConfirm: false,
    nextAction: status === 503 ? write ? 'retry_same_request' : 'reload_evidence' : status === 409 ? 'recalculate' : 'check_input' } };
}
