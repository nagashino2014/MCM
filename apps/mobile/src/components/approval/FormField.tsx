import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Chip, HtmlView, Input, Sheet, Textarea } from '@/components/ui';
import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { EntityPickerSheet, type EntityKind, type EntityOption } from '@/components/pickers/EntityPickerSheet';
import { OrgPickerSheet } from '@/components/pickers/OrgPickerSheet';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';
import { parseTimeRange, timeRangeMinutes, type ApprovalFieldDef } from '@/lib/approval/form-types';

/**
 * 기안 폼의 필드 하나 — 웹 `ApprovalFormRenderer` 의 필드 렌더를 모바일로 옮긴 것.
 *
 * 값 형태는 **웹과 동일해야 한다**(같은 문서를 두 앱이 함께 읽는다):
 *   period      {from,to}          company_select {name,facilityId?,manual?}
 *   checkbox    string[]           contract_select {title,contractId?,manual?}
 *   user_select {employeeId,name} 또는 그 배열(multiple)
 *   contact_select [{id,name,title,facilityName}]   asset_select {assetId,name}
 *   multitext   HTML 문자열(웹이 리치 에디터로 저장한다)
 */

interface Props {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  /** fillMap 자동 채움 — 선택 시 다른 필드에 값을 주입한다. */
  onFill?: (targetKey: string, v: unknown) => void;
  /** contract_select 를 같은 양식의 업체 선택에 연동할 때 쓴다(웹과 동일 동작). */
  linkedFacilityId?: string | null;
  /** 자동 채움 대상 필드의 타입을 알기 위해 필요하다(양식 전체 스키마). */
  allFields?: ApprovalFieldDef[];
  /** 자동 채움으로 잠긴 필드인지 판정하려면 양식 전체 값이 필요하다. */
  allValues?: Record<string, unknown>;
  /** 자동 계산 필드(초과근무 기사용·잔여시간 등) — 편집 UI 를 잠금 표시로 렌더한다. */
  readOnly?: boolean;
  /**
   * 휴가 기간 자동 부여 일수(경조 5일·반차 1일 등). 값이 있으면 기간 필드가
   * **시작일만 고르는 단일 픽커**가 되고 종료일은 규정대로 자동 계산된다.
   * null = 사용자가 종료일까지 직접 지정(연차·병가·공가(예비군)).
   */
  periodAutoDays?: number | null;
}

/**
 * 자동 채움(fillMap)으로 값이 확정된 필드인가 — 웹 `isAutoFilled` 와 같은 판정.
 * 소스(업체·계약)를 검색으로 확정 선택했고 그 규칙이 이 필드를 대상으로 하며 값이 실제로 찼을 때.
 * 이런 필드는 입력을 잠근다(계약을 고르면 업체명·용역분류는 손댈 필요가 없다).
 * 직접 입력 모드이거나 매칭 실패로 값이 비면 잠그지 않아 수기 입력이 가능하다.
 */
function isAutoFilled(f: ApprovalFieldDef, allFields: ApprovalFieldDef[], allValues: Record<string, unknown>): boolean {
  const cur = allValues[f.key];
  const empty =
    cur == null ||
    (typeof cur === 'string' && cur.trim() === '') ||
    (Array.isArray(cur) && cur.length === 0) ||
    (typeof cur === 'object' && !Array.isArray(cur) && !Object.values(cur as Record<string, unknown>).some(Boolean));
  if (empty) return false;
  return allFields.some((src) => {
    if (!src.fillMap?.some((r) => r.target === f.key)) return false;
    const sv = allValues[src.key];
    if (!sv || typeof sv !== 'object') return false;
    const o = sv as { contractId?: string; facilityId?: string; manual?: boolean };
    return !o.manual && Boolean(o.contractId || o.facilityId);
  });
}

/** 잠긴 필드의 표시 문자열. */
function lockedText(f: ApprovalFieldDef, value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : String((v as { name?: string })?.name ?? ''))).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return String(o.name ?? o.title ?? '');
  }
  return value == null ? '' : String(value);
}

const normOption = (s: string) => s.replace(/[\s&·・\-_/()]/g, '').toLowerCase();

/**
 * 자동 채움 값을 대상 필드 타입에 맞게 구조화한다(웹 ApprovalFormRenderer.buildFillValue 와 같은 규칙).
 * 업체 필드에는 사업장 id 까지 실어 '확정 선택' 상태로 만들고, 선택형은 옵션과 느슨 매칭한다.
 */
function buildFillValue(target: ApprovalFieldDef | undefined, text: string, ref?: { facilityId?: string | null }): unknown {
  if (!target) return text;
  const matchOption = (opts: string[]): string => {
    if (!opts.length) return text;
    if (opts.includes(text)) return text;
    const n = normOption(text);
    return (
      opts.find((o) => {
        const a = normOption(o);
        return a === n || a.includes(n) || n.includes(a);
      }) ?? ''
    );
  };
  switch (target.type) {
    case 'company_select':
      return { name: text, facilityId: ref?.facilityId || undefined, manual: !ref?.facilityId };
    case 'contract_select':
      return { title: text };
    case 'select':
    case 'radio':
      return matchOption(target.options ?? []);
    case 'checkbox': {
      const hit = matchOption(target.options ?? []);
      return hit ? [hit] : [];
    }
    default:
      return text;
  }
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (v == null ? '' : String(v));

/** 평문 → 최소 HTML(웹 리치 에디터 값과 호환). 서식은 만들지 않는다. */
export function plainToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
/** HTML → 평문(모바일 편집용). 태그가 단순할 때만 되돌릴 수 있다. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  // ⚠ trim 금지 — controlled Textarea 의 value 로 쓰이므로, 끝 공백·빈 줄을 지우면
  //   타이핑한 스페이스가 리렌더에서 즉시 사라진다(2026-08-10 실측).
}
/** 굵게·목록·표 등 모바일에서 재현할 수 없는 서식이 들어 있는가. */
function hasRichMarkup(html: string): boolean {
  return /<(strong|b|em|i|u|ul|ol|li|table|img|a|h[1-6])\b/i.test(html);
}

const HHMM_OK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * HH:MM 시각 입력 — 타이핑 중간 상태("1", "18:3")를 로컬 버퍼에 보존하고,
 * 유효한 시각이 완성됐을 때만 상위(onCommit)로 커밋한다(웹 AutoTimeInput 과 동일 구조).
 * ⚠ parseTimeRange 같은 "저장 계약 정규화"를 controlled value 에 직접 물리면 부분 입력이
 *   매 타이핑마다 '' 로 되돌려져 입력 자체가 불가능해진다(초과근무 "시간" 실측 2026-08-10).
 */
function TimeInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  // 외부 변경(문서 로드·자동 채움) 동기화 — 타이핑 중 리렌더는 value 가 불변이라 버퍼가 유지된다.
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <Input
      value={text}
      keyboardType="numeric"
      placeholder={placeholder}
      onChangeText={(t: string) => {
        const d = t.replace(/[^\d]/g, '').slice(0, 4);
        const masked = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
        setText(masked);
        if (masked === '') onCommit('');
        else if (HHMM_OK.test(masked)) onCommit(masked);
      }}
      onBlur={() => {
        // 미완성·무효 입력("99:99")은 마지막 유효값으로 복원 — 잘못된 시각이 문서에 남지 않게.
        if (text && !HHMM_OK.test(text)) setText(value);
      }}
    />
  );
}

export function FormField({
  field: f,
  value,
  onSet,
  onFill,
  linkedFacilityId,
  allFields,
  allValues,
  readOnly,
  periodAutoDays,
}: Props) {
  const { c } = useTheme();
  const [sheet, setSheet] = useState<null | 'date' | 'period' | 'select' | 'org' | 'entity' | 'leave'>(null);

  const label = (
    <View className="flex-row items-center gap-1">
      <Text className="text-[13px] font-bold text-cd-muted">{f.label}</Text>
      {f.required ? <Text className="text-[13px] font-bold text-cd-error">*</Text> : null}
    </View>
  );

  // ── 안내문 ─────────────────────────────────────────────
  if (f.type === 'static') {
    return (
      <View className="rounded-xl bg-cd-surface px-3 py-2.5">
        <Text className="text-[13px] leading-5 text-cd-muted">{f.content ?? ''}</Text>
      </View>
    );
  }

  // ── 표 — 모바일 상신 대상이 아니다(양식 자체가 걸러진다). 방어용 안내. ──
  if (f.type === 'table') {
    return (
      <View className="gap-1.5">
        {label}
        <View className="rounded-xl border border-cd-border bg-cd-surface px-3 py-3">
          <Text className="text-[12.5px] text-cd-muted">표 입력은 웹에서 작성합니다.</Text>
        </View>
      </View>
    );
  }

  const locked = readOnly || isAutoFilled(f, allFields ?? [], allValues ?? {});
  if (locked) {
    return (
      <View className="gap-1.5">
        <View className="flex-row items-center gap-1">
          <Text className="text-[13px] font-bold text-cd-muted">{f.label}</Text>
          <Ionicons name="lock-closed" size={12} color={c.faint} />
        </View>
        <View className="min-h-[46px] justify-center rounded-xl border border-cd-border bg-cd-surface px-3">
          <Text className="text-[14px] text-cd-body">{lockedText(f, value)}</Text>
        </View>
      </View>
    );
  }

  const body = () => {
    switch (f.type) {
      case 'text':
      case 'dept_select':
        return <Input value={str(value)} onChangeText={onSet} placeholder={f.placeholder} />;

      case 'multitext': {
        const html = typeof value === 'string' ? value : '';
        if (html && hasRichMarkup(html)) {
          return (
            <View className="gap-1.5">
              <View className="overflow-hidden rounded-xl border border-cd-border px-3 py-2">
                <HtmlView html={html} />
              </View>
              <Text className="text-[11.5px] text-cd-warning">
                서식이 있는 내용이라 모바일에서 편집하면 서식이 사라집니다 — 웹에서 수정하세요.
              </Text>
            </View>
          );
        }
        return (
          <Textarea
            value={htmlToPlain(html)}
            onChangeText={(t: string) => onSet(t.trim() ? plainToHtml(t) : '')}
            placeholder={f.placeholder}
          />
        );
      }

      case 'number':
      case 'currency':
        return (
          <Input
            value={str(value)}
            onChangeText={(t: string) => onSet(t.replace(/[^\d.-]/g, ''))}
            keyboardType="numeric"
            placeholder={f.placeholder}
          />
        );

      case 'time':
        return <TimeInput value={str(value)} onCommit={onSet} placeholder={f.placeholder ?? 'HH:MM'} />;

      case 'time_range': {
        // 시작·종료를 각각 HHMM 으로 받는다(웹 TimeRangeInput 과 같은 규칙·같은 저장 구조).
        // 입력 자체는 TimeInput 로컬 버퍼가 담당하고, 저장 값은 유효 시각만 들어온다.
        const v = parseTimeRange(value);
        const minutes = timeRangeMinutes(value);
        const onPart = (part: 'start' | 'end') => (t: string) => {
          onSet({ ...parseTimeRange(value), [part]: t });
        };
        return (
          <View className="gap-1.5">
            <View className="flex-row items-center gap-2">
              <View className="flex-1">
                <TimeInput value={v.start ?? ''} onCommit={onPart('start')} placeholder="시작 HHMM" />
              </View>
              <Text className="text-[13px] text-cd-faint">~</Text>
              <View className="flex-1">
                <TimeInput value={v.end ?? ''} onCommit={onPart('end')} placeholder="종료 HHMM" />
              </View>
            </View>
            {minutes != null ? (
              <Text className="text-[11.5px] text-cd-faint">
                {Math.floor(minutes / 60)}시간{minutes % 60 > 0 ? ` ${minutes % 60}분` : ''}
              </Text>
            ) : null}
          </View>
        );
      }

      case 'select':
      case 'radio': {
        const opts = f.options ?? [];
        if (opts.length <= 3) {
          return (
            <View className="flex-row flex-wrap gap-2">
              {opts.map((o) => (
                <Chip key={o} label={o} active={str(value) === o} onPress={() => onSet(o)} />
              ))}
            </View>
          );
        }
        return (
          <Pressable
            onPress={() => setSheet('select')}
            className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
            <Text className={`text-[14px] ${value ? 'text-cd-text' : 'text-cd-faint'}`}>{str(value) || '선택'}</Text>
            <Ionicons name="chevron-down" size={16} color={c.faint} />
          </Pressable>
        );
      }

      case 'checkbox': {
        const arr = Array.isArray(value) ? (value as string[]) : [];
        return (
          <View className="flex-row flex-wrap gap-2">
            {(f.options ?? []).map((o) => (
              <Chip
                key={o}
                label={o}
                active={arr.includes(o)}
                onPress={() => onSet(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}
              />
            ))}
          </View>
        );
      }

      case 'date':
        return (
          <Pressable
            onPress={() => setSheet('date')}
            className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
            <Text className={`text-[14px] ${value ? 'text-cd-text' : 'text-cd-faint'}`}>
              {str(value) || 'YYYY-MM-DD'}
            </Text>
            <Ionicons name="calendar-outline" size={17} color={c.faint} />
          </Pressable>
        );

      case 'period': {
        const v = rec(value);
        const from = str(v.from);
        const to = str(v.to);
        return (
          <Pressable
            onPress={() => setSheet('period')}
            className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
            <Text className={`text-[14px] ${from ? 'text-cd-text' : 'text-cd-faint'}`}>
              {from ? `${from} ~ ${to || from}` : periodAutoDays != null ? '시작일 선택' : '기간 선택'}
            </Text>
            <Ionicons name="calendar-outline" size={17} color={c.faint} />
          </Pressable>
        );
      }

      case 'user_select': {
        const people = Array.isArray(value)
          ? (value as { employeeId: string; name: string }[])
          : rec(value).employeeId
            ? [value as { employeeId: string; name: string }]
            : [];
        return (
          <View className="gap-2">
            {people.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {people.map((p) => (
                  <Pressable
                    key={p.employeeId}
                    onPress={() => {
                      const next = people.filter((x) => x.employeeId !== p.employeeId);
                      onSet(f.multiple ? next : (next[0] ?? null));
                    }}
                    className="flex-row items-center gap-1 rounded-full bg-cd-primary-soft px-2.5 py-1 active:opacity-70">
                    <Text className="text-[12px] font-semibold text-cd-primary">{p.name}</Text>
                    <Ionicons name="close" size={12} color={c.primary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => setSheet('org')}
              className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
              <Text className="text-[14px] text-cd-faint">{f.multiple ? '인원 추가' : '인원 선택'}</Text>
              <Ionicons name="person-add-outline" size={16} color={c.faint} />
            </Pressable>
          </View>
        );
      }

      case 'contact_select': {
        const people = Array.isArray(value)
          ? (value as { id: string; name: string; title?: string | null; facilityName?: string | null }[])
          : [];
        return (
          <View className="gap-2">
            {people.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {people.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => onSet(people.filter((x) => x.id !== p.id))}
                    className="flex-row items-center gap-1 rounded-full bg-cd-primary-soft px-2.5 py-1 active:opacity-70">
                    <Text className="text-[12px] font-semibold text-cd-primary">
                      {p.name}
                      {p.facilityName ? ` (${p.facilityName})` : ''}
                    </Text>
                    <Ionicons name="close" size={12} color={c.primary} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              onPress={() => setSheet('entity')}
              className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
              <Text className="text-[14px] text-cd-faint">담당자 추가</Text>
              <Ionicons name="search-outline" size={16} color={c.faint} />
            </Pressable>
          </View>
        );
      }

      case 'company_select':
      case 'contract_select':
      case 'asset_select': {
        const v = rec(value);
        const shown = f.type === 'contract_select' ? str(v.title) : str(v.name);
        const manual = v.manual === true;
        return (
          <Pressable
            onPress={() => setSheet('entity')}
            className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
            <View className="flex-1 flex-row items-center gap-1.5">
              <Text numberOfLines={1} className={`text-[14px] ${shown ? 'text-cd-text' : 'text-cd-faint'}`}>
                {shown || f.placeholder || '검색해서 선택'}
              </Text>
              {manual ? <Badge label="직접 입력" tone="neutral" /> : null}
            </View>
            <Ionicons name="search-outline" size={16} color={c.faint} />
          </Pressable>
        );
      }

      case 'leave_type':
        return <LeaveTypeField value={value} onSet={onSet} onOpen={() => setSheet('leave')} open={sheet === 'leave'} onClose={() => setSheet(null)} />;

      default:
        return <Input value={str(value)} onChangeText={onSet} placeholder={f.placeholder} />;
    }
  };

  const entityKind: EntityKind =
    f.type === 'contract_select' ? 'contract' : f.type === 'contact_select' ? 'contact' : f.type === 'asset_select' ? 'asset' : 'company';

  const onEntity = (o: EntityOption) => {
    if (f.type === 'company_select') {
      onSet({ name: o.label, facilityId: o.id, manual: false });
    } else if (f.type === 'contract_select') {
      onSet({ title: o.label, contractId: o.id, manual: false });
    } else if (f.type === 'asset_select') {
      onSet({ assetId: o.id, name: o.label });
    } else {
      const cur = Array.isArray(value) ? (value as { id: string }[]) : [];
      if (!cur.some((p) => p.id === o.id)) {
        onSet([...cur, { id: o.id, name: str(o.raw.personName), title: o.raw.title ?? null, facilityName: o.raw.facilityName ?? null }]);
      }
    }
    // 자동 채움 — 웹과 같은 규칙(region 은 시도+시군구 결합).
    for (const rule of f.fillMap ?? []) {
      const raw = o.raw as Record<string, unknown>;
      const val =
        rule.source === 'region'
          ? [str(raw.regionSido), str(raw.regionSigungu)].filter(Boolean).join(' ')
          : rule.source === 'contractAmount' && raw.contractAmount != null
            ? Number(raw.contractAmount).toLocaleString('ko-KR')
            : str(raw[rule.source]);
      if (!val) continue;
      const target = allFields?.find((x) => x.key === rule.target);
      // 업체명 채움에는 계약상대의 사업장 id 를 실어 보낸다(업체 필드가 다시 검색을 띄우지 않도록).
      const ref = rule.source === 'counterpartyName' ? { facilityId: str(raw.counterpartyFacilityId) || null } : undefined;
      onFill?.(rule.target, buildFillValue(target, val, ref));
    }
  };

  return (
    <View className="gap-1.5">
      {label}
      {body()}

      {/* 시트들 */}
      <DatePickerSheet
        visible={sheet === 'date'}
        value={str(value) || null}
        onConfirm={(from) => onSet(from)}
        onClose={() => setSheet(null)}
      />
      <DatePickerSheet
        visible={sheet === 'period'}
        // 규정상 일수가 정해진 휴가(경조·반차 등)는 종료일을 고를 수 없다 — 시작일만 받고
        // autoDays 로 종료일을 계산해 시트 안에서도 실제 기간을 보여 준다.
        mode={periodAutoDays != null ? 'single' : 'range'}
        autoDays={periodAutoDays ?? undefined}
        title={`${f.label} 선택`}
        value={str(rec(value).from) || null}
        valueTo={str(rec(value).to) || null}
        onConfirm={(from, to) => onSet({ from, to })}
        onClose={() => setSheet(null)}
      />
      <Sheet visible={sheet === 'select'} onClose={() => setSheet(null)} title={f.label}>
        {/* 옵션 수는 양식에 따라 무제한 — 휴가 종류 시트와 같은 스크롤 패턴(잘림 방지). */}
        <ScrollView style={{ maxHeight: 480, flexShrink: 1 }}>
          <View className="gap-1 pb-2">
          {(f.options ?? []).map((o) => (
            <Pressable
              key={o}
              onPress={() => {
                onSet(o);
                setSheet(null);
              }}
              className={`rounded-xl px-4 py-3 active:opacity-70 ${str(value) === o ? 'bg-cd-primary-soft' : ''}`}>
              <Text className={`text-[15px] ${str(value) === o ? 'font-extrabold text-cd-primary' : 'text-cd-text'}`}>{o}</Text>
            </Pressable>
          ))}
          </View>
        </ScrollView>
      </Sheet>
      <OrgPickerSheet
        visible={sheet === 'org'}
        title={f.label}
        multi={f.multiple}
        onSelect={(emp) => {
          const cur = Array.isArray(value)
            ? (value as { employeeId: string; name: string }[])
            : rec(value).employeeId
              ? [value as { employeeId: string; name: string }]
              : [];
          const next = cur.some((p) => p.employeeId === emp.employeeId)
            ? cur
            : [...cur, { employeeId: emp.employeeId, name: emp.name }];
          onSet(f.multiple ? next : (next[next.length - 1] ?? null));
        }}
        onClose={() => setSheet(null)}
      />
      <EntityPickerSheet
        visible={sheet === 'entity'}
        kind={entityKind}
        assetKind={f.assetKind}
        title={f.label}
        onSelect={onEntity}
        onManual={
          f.type === 'company_select'
            ? (t) => onSet({ name: t, manual: true })
            : f.type === 'contract_select'
              ? (t) => onSet({ title: t, manual: true })
              : undefined
        }
        onClose={() => setSheet(null)}
      />
      {/* contract_select 가 업체에 연동될 때의 안내(웹은 목록을 바꿔 보여준다) */}
      {f.type === 'contract_select' && linkedFacilityId ? (
        <Text className="text-[11.5px] text-cd-faint">선택한 업체의 계약에서 찾습니다.</Text>
      ) : null}
    </View>
  );
}

/** 휴가 종류 — 규정 카탈로그(DB)에서 받아 차감 일수와 함께 보여준다. */
function LeaveTypeField({
  value,
  onSet,
  onOpen,
  open,
  onClose,
}: {
  value: unknown;
  onSet: (v: unknown) => void;
  onOpen: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { data } = useApi<{ types: { key: string; label: string; deduct: 'full' | 'half' | null; days: number | null }[] }>(
    '/api/approval/leave-types',
    { cache: true }
  );
  const types = data?.types ?? [];
  const cur = types.find((t) => t.key === str(value));

  return (
    <>
      <Pressable
        onPress={onOpen}
        className="min-h-[46px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3 active:opacity-70">
        <Text className={`text-[14px] ${cur ? 'text-cd-text' : 'text-cd-faint'}`}>{cur?.label ?? '휴가 종류 선택'}</Text>
        <Ionicons name="chevron-down" size={16} color={c.faint} />
      </Pressable>
      <Sheet visible={open} onClose={onClose} title="휴가 종류">
        {/* 종류가 시트 최대 높이(85%)를 넘으면 잘리므로 스크롤 영역으로 감싼다(2026-08-10 사용자 리포트).
            flexShrink 1 — Sheet 의 shrink 컨테이너 안에서 기기 높이에 맞게 줄어들며 스크롤. */}
        <ScrollView style={{ maxHeight: 480, flexShrink: 1 }}>
          <View className="gap-1 pb-2">
            {types.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => {
                onSet(t.key);
                onClose();
              }}
              className={`flex-row items-center gap-2 rounded-xl px-4 py-3 active:opacity-70 ${
                t.key === str(value) ? 'bg-cd-primary-soft' : ''
              }`}>
              <Text className={`flex-1 text-[15px] ${t.key === str(value) ? 'font-extrabold text-cd-primary' : 'text-cd-text'}`}>
                {t.label}
              </Text>
              {/* 웹 렌더러와 동일 표기 — 경조사류(부여 N일)가 "차감 없음"으로만 보이던 것 정정. */}
              {t.deduct === 'full' ? (
                <Badge label="연차 차감" tone="neutral" />
              ) : t.deduct === 'half' ? (
                <Badge label="0.5일 차감" tone="neutral" />
              ) : t.days != null ? (
                <Badge label={`부여 ${t.days}일`} tone="success" />
              ) : (
                <Badge label="차감 없음" tone="success" />
              )}
            </Pressable>
            ))}
          </View>
        </ScrollView>
      </Sheet>
    </>
  );
}
