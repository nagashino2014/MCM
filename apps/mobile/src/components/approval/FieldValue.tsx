import { Text, View } from 'react-native';

import { HtmlView } from '@/components/ui';
import { timeRangeText } from '@/lib/approval/form-types';
import { useApi } from '@/lib/use-api';

/**
 * 결재 양식 필드의 **읽기 전용** 렌더(웹 ApprovalFormRenderer 의 readOnly 대응).
 *
 * 값 형태는 양식 필드 타입마다 다르다(서버 lib/approval/fields.ts):
 *   multitext=HTML 문자열 / period={from,to} / checkbox=string[] /
 *   user_select=PersonValue|PersonValue[] / table=Record<string,string>[] / 그 외=문자열.
 * 앱은 편집을 하지 않으므로 "보여주기"에만 집중하고, 모르는 형태는 안전하게 문자열로 떨어뜨린다.
 */

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  content?: string;
  tableColumns?: { key: string; label: string; type?: string }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 객체 값에서 사람이 읽을 이름을 뽑는다(인원·업체·계약 선택 필드). */
function labelOf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(labelOf).filter(Boolean).join(', ');
  if (isRecord(v)) {
    for (const k of ['name', 'label', 'title', 'companyName', 'counterpartyName', 'deptName']) {
      const x = v[k];
      if (typeof x === 'string' && x.trim()) return x;
    }
    return '';
  }
  return String(v);
}

function plain(value: unknown, type: string): string {
  if (value == null || value === '') return '';
  switch (type) {
    case 'period': {
      const v = isRecord(value) ? value : {};
      const from = String(v.from ?? '');
      const to = String(v.to ?? '');
      return from || to ? `${from} ~ ${to}` : '';
    }
    case 'time_range':
      return timeRangeText(value);
    case 'checkbox':
      return Array.isArray(value) ? value.map(String).join(', ') : String(value);
    case 'currency': {
      const n = Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) ? `${n.toLocaleString()} 원` : String(value);
    }
    case 'number': {
      const n = Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) ? n.toLocaleString() : String(value);
    }
    case 'user_select':
    case 'dept_select':
    case 'company_select':
    case 'contract_select':
    case 'leave_type':
      return labelOf(value) || (typeof value === 'string' ? value : '');
    default:
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : labelOf(value);
  }
}

export function FieldValue({ field, value }: { field: FieldDef; value: unknown }) {
  // 휴가 종류 카탈로그 — 값이 key("half_am")로 저장되므로 라벨("반차(오전)")로 바꿔 보여준다
  // (작성 화면 LeaveTypeField 와 동일 소스·캐시. 훅 규칙상 early return 앞에서 호출).
  const leaveTypes = useApi<{ types: { key: string; label: string }[] }>(
    '/api/approval/leave-types',
    { cache: true, skip: field.type !== 'leave_type' }
  );

  // 안내문은 라벨 없이 본문만.
  if (field.type === 'static') {
    return (
      <View className="rounded-xl bg-cd-surface px-3 py-2.5">
        <Text className="text-[13px] leading-5 text-cd-muted">{field.content ?? ''}</Text>
      </View>
    );
  }

  if (field.type === 'multitext') {
    const html = typeof value === 'string' ? value : '';
    return (
      <View className="gap-1">
        <Text className="text-[12px] font-bold text-cd-faint">{field.label}</Text>
        {html.trim() ? (
          // HtmlView 문서 CSS 가 body padding 0 이라 박스 쪽에서 여백을 준다(글자 밀착 방지).
          <View className="overflow-hidden rounded-xl border border-cd-border px-3 py-2">
            <HtmlView html={html} />
          </View>
        ) : (
          <Text className="text-[14px] text-cd-faint">-</Text>
        )}
      </View>
    );
  }

  if (field.type === 'table') {
    const cols = field.tableColumns ?? [];
    const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    const filled = rows.filter((r) => cols.some((c) => String(r?.[c.key] ?? '').trim()));
    return (
      <View className="gap-1">
        <Text className="text-[12px] font-bold text-cd-faint">{field.label}</Text>
        {filled.length === 0 ? (
          <Text className="text-[14px] text-cd-faint">-</Text>
        ) : (
          // 열이 많으면 좁은 화면에서 찌그러지므로, 행마다 "열: 값" 세로 목록으로 재배치한다
          // (축소 대신 리플로우 — 블루프린트 §2-7).
          <View className="gap-2">
            {filled.map((r, i) => (
              <View key={i} className="gap-0.5 rounded-xl border border-cd-border p-3">
                {cols.map((col) => (
                  <View key={col.key} className="flex-row gap-2">
                    <Text className="w-24 text-[12px] text-cd-faint">{col.label}</Text>
                    <Text className="flex-1 text-[13px] text-cd-text">
                      {plain(r?.[col.key], col.type ?? 'text') || '-'}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
      </View>
    );
  }

  let text = plain(value, field.type);
  if (field.type === 'leave_type' && typeof value === 'string' && value) {
    const t = leaveTypes.data?.types?.find((x) => x.key === value || x.label === value);
    if (t) text = t.label;
  }
  return (
    <View className="gap-0.5">
      <Text className="text-[12px] font-bold text-cd-faint">{field.label}</Text>
      <Text className="text-[15px] leading-6 text-cd-text">{text || '-'}</Text>
    </View>
  );
}
