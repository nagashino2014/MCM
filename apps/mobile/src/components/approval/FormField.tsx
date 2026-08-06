import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Chip, HtmlView, Input, Sheet, Textarea } from '@/components/ui';
import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { EntityPickerSheet, type EntityKind, type EntityOption } from '@/components/pickers/EntityPickerSheet';
import { OrgPickerSheet } from '@/components/pickers/OrgPickerSheet';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';
import type { ApprovalFieldDef } from '@/lib/approval/form-types';

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
    .replace(/&amp;/g, '&')
    .trim();
}
/** 굵게·목록·표 등 모바일에서 재현할 수 없는 서식이 들어 있는가. */
function hasRichMarkup(html: string): boolean {
  return /<(strong|b|em|i|u|ul|ol|li|table|img|a|h[1-6])\b/i.test(html);
}

export function FormField({ field: f, value, onSet, onFill, linkedFacilityId }: Props) {
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
              <View className="overflow-hidden rounded-xl border border-cd-border">
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
        return (
          <Input
            value={str(value)}
            onChangeText={(t: string) => {
              // HHMM 4자리를 자동으로 HH:MM 으로(웹 AutoTimeInput 과 같은 규칙).
              const d = t.replace(/[^\d]/g, '').slice(0, 4);
              onSet(d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d);
            }}
            keyboardType="numeric"
            placeholder={f.placeholder ?? 'HH:MM'}
          />
        );

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
              {from ? `${from} ~ ${to || from}` : '기간 선택'}
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
      if (val) onFill?.(rule.target, val);
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
        mode="range"
        title={`${f.label} 선택`}
        value={str(rec(value).from) || null}
        valueTo={str(rec(value).to) || null}
        onConfirm={(from, to) => onSet({ from, to })}
        onClose={() => setSheet(null)}
      />
      <Sheet visible={sheet === 'select'} onClose={() => setSheet(null)} title={f.label}>
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
              {t.deduct ? (
                <Badge label={t.deduct === 'half' ? '0.5일 차감' : `${t.days ?? 1}일 차감`} tone="neutral" />
              ) : (
                <Badge label="차감 없음" tone="success" />
              )}
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}
