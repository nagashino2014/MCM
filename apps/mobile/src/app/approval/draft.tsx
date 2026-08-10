import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  ActionBar,
  Badge,
  Button,
  Card,
  CardRow,
  Chip,
  EmptyState,
  Input,
  ScreenHeader,
  SkeletonList,
  useToast,
} from '@/components/ui';
import { FormField } from '@/components/approval/FormField';
import { OvertimeConsentSheet } from '@/components/approval/OvertimeConsentSheet';
import { OrgPickerSheet } from '@/components/pickers/OrgPickerSheet';
import { apiJson } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/useTheme';
import {
  PINNED_FORM_IDS,
  draftableOnMobile,
  parseTimeRange,
  timeRangeMinutes,
  undraftableReason,
  type ApprovalFieldDef,
  type ApprovalForm,
  type LinePreset,
  type LineStep,
} from '@/lib/approval/form-types';
import type { OvertimeConsent } from '@/lib/approval/overtime-consent';

/**
 * 전자결재 기안 — 양식 선택 → 작성 → 결재선 → 상신.
 *
 * 웹 `ApprovalDraftBoard` 대응. 값 형태·검증은 웹과 같아야 하고(같은 문서를 두 앱이 읽는다),
 * 필드 key 는 서버 양식 정의를 그대로 따른다(하드코딩 금지 — 관리자가 빌더에서 바꾼다).
 *
 * 진입: `/approval/draft` (양식 선택부터) 또는 `?formId=...` (해당 양식으로 바로).
 * `?date=YYYY-MM-DD` 를 주면 첫 date/period 필드에 프리필한다(일정 화면에서 날짜를 눌러 들어올 때).
 */

interface Watcher {
  userId: string;
  name: string;
  kind: 'ref' | 'view';
}

const OVERTIME_FORM_ID = 'frm-overtime-request';
const LEAVE_FORM_ID = 'frm-leave-request';

/**
 * 필드의 가로 폭 비중(%) — 짧은 입력은 같은 행에 나란히 놓기 위한 근거.
 * 웹 양식은 row/span 으로 표 레이아웃을 표현하지만 모바일 폭에서는 3열이 들어가지 않는다.
 * 그래서 **같은 row 안에서 폭 합이 100 을 넘지 않을 때만** 나란히 놓는다
 * (예: 국내 출장 신청 row3 = 이용차량 / 이용시간 + 출장 출발 시각).
 */
function widthOf(f: ApprovalFieldDef): number {
  switch (f.type) {
    case 'time':
      return 40;
    case 'date':
    case 'number':
    case 'currency':
      return 50;
    case 'radio':
    case 'select':
      return (f.options?.length ?? 0) <= 3 ? 60 : 100;
    default:
      return 100;
  }
}

/** 같은 row 의 필드를 폭 합 100 이하로 묶어 화면 행을 만든다(static 은 항상 단독). */
function packRows(fields: ApprovalFieldDef[]): ApprovalFieldDef[][] {
  const out: ApprovalFieldDef[][] = [];
  let cur: ApprovalFieldDef[] = [];
  let acc = 0;
  let curRow = -1;
  for (const f of fields) {
    const w = widthOf(f);
    const solo = f.type === 'static' || f.type === 'table' || w >= 100;
    const joinable = cur.length > 0 && !solo && f.row === curRow && acc + w <= 100;
    if (joinable) {
      cur.push(f);
      acc += w;
      continue;
    }
    if (cur.length) out.push(cur);
    cur = [f];
    acc = solo ? 100 : w;
    curRow = f.row ?? 0;
  }
  if (cur.length) out.push(cur);
  return out;
}

const fmtH = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

/** ISO 날짜 + n 달력일(주말·공휴일 제외 없음 — 웹 DraftBoard 의 addDays 와 동일 규칙). */
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 양끝 포함 달력일수(웹 DraftBoard 의 dayCount 와 동일). */
const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function DraftScreen() {
  const params = useLocalSearchParams<{ formId?: string; date?: string }>();
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();
  const { user } = useAuth();

  const [formId, setFormId] = useState<string | null>(params.formId ?? null);
  const forms = useApi<{ forms: ApprovalForm[] }>('/api/approval/forms', { cache: true });
  const form = useApi<{ form: ApprovalForm }>(formId ? `/api/approval/forms/${formId}` : '/api/approval/forms', {
    skip: !formId,
  });
  const presets = useApi<{ presets: LinePreset[] }>('/api/approval/line-presets', { cache: true });

  const [title, setTitle] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [line, setLine] = useState<LineStep[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [picker, setPicker] = useState<null | 'line' | 'watcher'>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'submit'>(null);
  /** 임시저장으로 만들어진 문서 id — 재상신 때 이 값을 써야 이중 상신이 안 난다. */
  const docIdRef = useRef<string | null>(null);
  const consentRef = useRef<OvertimeConsent | null>(null);

  const def = form.data?.form ?? null;
  const fields = useMemo(
    () => [...(def?.fields ?? [])].sort((a, b) => (a.row ?? 0) - (b.row ?? 0)),
    [def?.fields]
  );

  // 양식을 고르면 제목 기본값을 채운다(웹과 같은 규칙 — 사용자가 고칠 수 있다).
  useEffect(() => {
    if (def && !title) setTitle(def.name);
  }, [def, title]);

  // 날짜 프리필 — 첫 date/period 필드에 넣는다.
  useEffect(() => {
    if (!params.date || !fields.length) return;
    const d = fields.find((f) => f.type === 'date' || f.type === 'period');
    if (!d) return;
    setValues((prev) =>
      prev[d.key] ? prev : { ...prev, [d.key]: d.type === 'period' ? { from: params.date, to: params.date } : params.date }
    );
  }, [params.date, fields]);

  // 결재선 프리셋이 하나뿐이면 자동 적용(모바일에서 가장 흔한 경우).
  useEffect(() => {
    const list = presets.data?.presets ?? [];
    if (!line.length && list.length === 1) setLine(list[0].steps);
  }, [presets.data, line.length]);

  // ── 양식별 특수 로직 ─────────────────────────────────────
  const isOvertime = formId === OVERTIME_FORM_ID;
  const isLeave = formId === LEAVE_FORM_ID;

  /** 초과근무 신청 주 — 기간 필드의 시작일. */
  const otFrom = useMemo(() => {
    if (!isOvertime) return null;
    const pf = fields.find((f) => f.type === 'period');
    const v = pf ? (values[pf.key] as { from?: string } | undefined) : undefined;
    return v?.from && /^\d{4}-\d{2}-\d{2}$/.test(v.from) ? v.from : null;
  }, [isOvertime, fields, values]);

  const otUsage = useApi<{
    weekStart: string;
    weekEnd: string;
    requestedMinutes: number;
    attendanceOvertimeMinutes: number;
    limitMinutes: number;
  }>(otFrom ? `/api/approval/overtime/week-usage?date=${otFrom}` : '/api/approval/forms', { skip: !otFrom });

  const leaveMine = useApi<{ granted?: number; used?: number; remaining?: number }>(
    isLeave ? `/api/approval/leave?me=1&year=${new Date().getFullYear()}` : '/api/approval/forms',
    { skip: !isLeave }
  );

  // 휴가: 종류·시작일 → 종료일·사용일수 자동 부여(웹 DraftBoard :229-273 이식).
  // 고정 부여일수 종류(결혼 5일 등)는 종료일 = 시작일 + (days-1) "달력일", use_days = days.
  // 가변 종류(연차·병가 등)는 종료일까지 입력되면 use_days 만 자동 카운트. 값 형태는 웹과 동일
  // (use_days 는 문자열) — 서버 leave.ts 최종 산정·precheck 잔여검증과의 호환 조건.
  const leaveTypes = useApi<{
    types: { key: string; label: string; deduct: 'full' | 'half' | null; days: number | null }[];
  }>('/api/approval/leave-types', { cache: true, skip: !isLeave });

  const leavePeriodKey = isLeave ? fields.find((f) => f.type === 'period')?.key : undefined;
  const leaveItem = useMemo(() => {
    if (!isLeave) return null;
    const types = leaveTypes.data?.types ?? [];
    const ltKey = fields.find((f) => f.type === 'leave_type')?.key;
    const v = ltKey ? values[ltKey] : undefined;
    if (typeof v !== 'string' || !v) return null;
    // 웹 findInCatalog 와 같은 폴백: key → label(구버전 문서) → "반차" 문자열.
    return (
      types.find((t) => t.key === v) ??
      types.find((t) => t.label === v) ??
      (v.includes('반차') ? types.find((t) => t.key === 'half_am') : undefined) ??
      null
    );
  }, [isLeave, leaveTypes.data, fields, values]);

  /** 반차 = 하루·0.5일 차감. 고정 부여일수(경조 등)는 days. 둘 다 종료일을 사용자가 못 고른다. */
  const leaveFixedDays = leaveItem ? (leaveItem.deduct === 'half' ? 1 : leaveItem.days) : null;

  const leaveHint = useMemo(() => {
    if (!isLeave || !leaveItem || !leavePeriodKey) return null;
    const period = (values[leavePeriodKey] as { from?: string; to?: string } | undefined) ?? {};
    if (!period.from || !DAY_RE.test(period.from)) {
      return leaveItem.days != null
        ? { text: `${leaveItem.label} — 부여 ${leaveItem.days}일 (시작일을 지정하면 종료일이 자동 설정됩니다)`, over: false }
        : leaveItem.deduct === 'half'
          ? { text: `${leaveItem.label} — 0.5일 차감(하루 안에서 사용)`, over: false }
          : null;
    }
    if (leaveItem.deduct === 'half') {
      return { text: `${leaveItem.label} — 0.5일 차감(하루 안에서 사용)`, over: false };
    }
    if (leaveItem.days != null) {
      const to = addDays(period.from, leaveItem.days - 1);
      return { text: `${leaveItem.label} — 부여 ${leaveItem.days}일 · 종료일 자동 설정(${to})`, over: false };
    }
    if (period.to && DAY_RE.test(period.to)) {
      const cnt = dayCount(period.from, period.to);
      if (cnt <= 0) return { text: '종료일이 시작일보다 빠릅니다.', over: true };
      const remaining = leaveMine.data?.remaining;
      const over = !!leaveItem.deduct && typeof remaining === 'number' && cnt > remaining;
      return { text: `사용 ${cnt}일${over ? ` · ⚠ 잔여 연차(${remaining}일) 초과` : ''}`, over };
    }
    return { text: `${leaveItem.label} — 시작·종료일을 지정하면 사용일수가 계산됩니다`, over: false };
  }, [isLeave, leaveItem, leavePeriodKey, values, leaveMine.data]);

  /** 직전 휴가 종류 — 종류가 바뀌었을 때만 기간·일수를 새 규정으로 재설정한다. */
  const prevLeaveTypeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isLeave || !leavePeriodKey) return;
    if (!leaveItem) {
      prevLeaveTypeRef.current = null;
      return;
    }
    // 첫 평가(문서 로드·임시저장 이어쓰기)는 변경으로 보지 않는다 — 저장된 값을 지우면 안 된다.
    const typeChanged = prevLeaveTypeRef.current !== null && prevLeaveTypeRef.current !== leaveItem.key;
    prevLeaveTypeRef.current = leaveItem.key;

    const period = (values[leavePeriodKey] as { from?: string; to?: string } | undefined) ?? {};
    if (!period.from || !DAY_RE.test(period.from)) return;

    if (leaveItem.deduct === 'half') {
      // 반차: 종료일=시작일, 사용일수 0.5(서버 차감과 일치).
      if (period.to !== period.from || String(values.use_days ?? '') !== '0.5') {
        setValues((prev) => ({ ...prev, [leavePeriodKey]: { from: period.from, to: period.from }, use_days: '0.5' }));
      }
      return;
    }
    if (leaveItem.days != null) {
      const to = addDays(period.from, leaveItem.days - 1);
      if (period.to !== to || String(values.use_days ?? '') !== String(leaveItem.days)) {
        setValues((prev) => ({
          ...prev,
          [leavePeriodKey]: { from: period.from, to },
          use_days: String(leaveItem.days),
        }));
      }
      return;
    }
    if (typeChanged) {
      // 고정·반차 → 가변 전환: 이전 종료일이 남지 않게 하루로 초기화(사용자가 다시 지정).
      setValues((prev) => ({ ...prev, [leavePeriodKey]: { from: period.from, to: period.from }, use_days: '1' }));
      return;
    }
    if (period.to && DAY_RE.test(period.to)) {
      const cnt = dayCount(period.from, period.to);
      if (cnt > 0 && String(values.use_days ?? '') !== String(cnt)) {
        setValues((prev) => ({ ...prev, use_days: String(cnt) }));
      }
    }
  }, [isLeave, leaveItem, leavePeriodKey, values]);

  // 초과근무: 기사용·잔여 시간을 자동으로 채운다(웹 DraftBoard 와 같은 계산).
  const usage = otUsage.data;
  const applyHours = Number(values.apply_hours) > 0 ? Number(values.apply_hours) : 0;
  const otHint = useMemo(() => {
    if (!isOvertime || !usage) return null;
    // 기사용 = 같은 주의 기존 신청 합과 근태 실적 중 큰 값(웹 DraftBoard 와 동일 — 신청이 아직
    // 근태에 안 잡힌 미래 주 대응). 근태 실적을 빼면 두 앱의 기사용시간이 어긋난다.
    const usedMin = Math.max(usage.requestedMinutes, usage.attendanceOvertimeMinutes);
    const applyMin = Math.round(applyHours * 60);
    const remainMin = Math.max(0, usage.limitMinutes - usedMin - applyMin);
    return {
      used: fmtH(usedMin),
      remain: fmtH(remainMin),
      over: usedMin + applyMin > usage.limitMinutes,
      totalMin: usedMin + applyMin,
      excessMin: Math.max(0, usedMin + applyMin - usage.limitMinutes),
      text: `이번 주 기사용 ${fmtH(usedMin)}h + 신청 ${fmtH(applyMin)}h · 잔여 ${fmtH(remainMin)}h`,
    };
  }, [isOvertime, usage, applyHours]);

  useEffect(() => {
    if (!otHint) return;
    if (String(values.used_hours ?? '') !== otHint.used || String(values.remain_hours ?? '') !== otHint.remain) {
      setValues((prev) => ({ ...prev, used_hours: otHint.used, remain_hours: otHint.remain }));
    }
  }, [otHint, values.used_hours, values.remain_hours]);

  // 초과근무: 시간 범위(time_range) → 신청시간 자동 계산(웹 DraftBoard 와 같은 규칙).
  // 범위가 실제로 바뀔 때만 채워, 휴게시간 제외 등 수기 조정값과 문서 로드값을 덮지 않는다.
  const otRangeKey = isOvertime ? fields.find((f) => f.type === 'time_range')?.key : undefined;
  const otRangeValue = otRangeKey ? values[otRangeKey] : undefined;
  const otRangeSigRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isOvertime || !otRangeKey) return;
    const minutes = timeRangeMinutes(otRangeValue);
    const sig = minutes == null ? '' : String(minutes);
    const first = otRangeSigRef.current === undefined;
    if (otRangeSigRef.current === sig) return;
    otRangeSigRef.current = sig;
    if (first || minutes == null) return;
    const hours = String(Math.round((minutes / 60) * 100) / 100);
    setValues((prev) => (String(prev.apply_hours ?? '') === hours ? prev : { ...prev, apply_hours: hours }));
  }, [isOvertime, otRangeKey, otRangeValue]);

  /** contract_select 를 업체 선택에 연동(웹과 동일). */
  const linkedFacilityId = useMemo(() => {
    const cf = fields.find((f) => f.type === 'company_select');
    const v = cf ? (values[cf.key] as { facilityId?: string; manual?: boolean } | undefined) : undefined;
    return v?.facilityId && !v.manual ? v.facilityId : null;
  }, [fields, values]);

  const setValue = (key: string, v: unknown) => setValues((prev) => ({ ...prev, [key]: v }));

  const missing = (): ApprovalFieldDef | null => {
    for (const f of fields) {
      if (!f.required || f.type === 'static') continue;
      const v = values[f.key];
      const empty =
        v == null ||
        v === '' ||
        (Array.isArray(v) && v.length === 0) ||
        (f.type === 'period' && !(v as { from?: string }).from) ||
        // 시간 범위는 한쪽만 있으면 소요 시간을 알 수 없어 미입력으로 본다(웹과 동일).
        (f.type === 'time_range' && (() => { const r = parseTimeRange(v); return !r.start || !r.end; })()) ||
        (f.type === 'company_select' && !(v as { name?: string }).name) ||
        (f.type === 'contract_select' && !(v as { title?: string }).title) ||
        (f.type === 'asset_select' && !(v as { assetId?: string }).assetId);
      if (empty) return f;
    }
    return null;
  };

  const post = async (action: 'save' | 'submit') => {
    const fv: Record<string, unknown> = { ...values };
    if (consentRef.current) fv._overtime_consent = consentRef.current;
    const res = await apiJson<{ docId: string }>('/api/approval/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        docId: docIdRef.current,
        formId,
        title: title.trim() || def?.name || '',
        urgent,
        fieldValues: fv,
        line: line.map((s) => ({
          stepType: s.stepType,
          assigneeUserId: s.assigneeUserId,
          assigneeName: s.assigneeName ?? undefined,
          assigneePosition: s.assigneePosition ?? undefined,
        })),
        watchers: watchers.map((w) => ({ userId: w.userId, name: w.name, kind: w.kind })),
      }),
    });
    docIdRef.current = res.docId;
    return res.docId;
  };

  const onSave = async () => {
    setBusy('save');
    try {
      await post('save');
      toast.show('임시저장했습니다.', 'success');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async () => {
    const m = missing();
    if (m) {
      toast.show(`${m.label}을(를) 입력하세요.`, 'error');
      return;
    }
    if (!line.length) {
      toast.show('결재선에 결재자를 1명 이상 추가하세요.', 'error');
      return;
    }
    // 12h 초과는 동의(전자서명)가 없으면 서버가 상신을 거부한다 — 먼저 동의 시트를 띄운다.
    if (isOvertime && otHint?.over && usage) {
      const cur = consentRef.current;
      if (!cur || cur.weekStart !== usage.weekStart) {
        setConsentOpen(true);
        return;
      }
    }
    setBusy('submit');
    try {
      const docId = await post('submit');
      toast.show('상신했습니다.', 'success');
      router.replace({ pathname: '/approval/[docId]', params: { docId } });
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  // ── 1단계: 양식 선택 ─────────────────────────────────────
  if (!formId) {
    const all = forms.data?.forms ?? [];
    const pinned = PINNED_FORM_IDS.map((id) => all.find((f) => f.formId === id)).filter(Boolean) as ApprovalForm[];
    const rest = all.filter((f) => f.useYn !== false && !PINNED_FORM_IDS.includes(f.formId));

    const Row = ({ f }: { f: ApprovalForm }) => {
      const ok = draftableOnMobile(f);
      return (
        <Pressable
          onPress={() => (ok ? setFormId(f.formId) : toast.show(undraftableReason(f) ?? '', 'error'))}
          // 웹 전용 양식은 반투명 대신 글자색 감쇠(불투명) — 겹침 가시성 문제(2026-08-10 규칙).
          className="flex-row items-center gap-2.5 border-t border-cd-grid-line py-3 active:opacity-60">
          <View className="flex-1">
            <Text
              numberOfLines={1}
              className={`text-[13px] font-semibold ${ok ? 'text-cd-body' : 'text-cd-faint'}`}>
              {f.name}
            </Text>
            {f.description ? (
              <Text numberOfLines={1} className="mt-[2px] text-[11.5px] text-cd-faint">
                {f.description}
              </Text>
            ) : null}
          </View>
          {ok ? (
            <Ionicons name="chevron-forward" size={14} color={c.faint} />
          ) : (
            <Badge label={undraftableReason(f) ?? '웹 전용'} tone="neutral" />
          )}
        </Pressable>
      );
    };

    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-cd-bg">
        <ScreenHeader title="기안 작성" subtitle="양식을 선택하세요" back />
        <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}>
          {forms.loading && !all.length ? (
            <SkeletonList count={3} />
          ) : !all.length ? (
            <EmptyState icon="documents-outline" title="양식을 불러오지 못했습니다" />
          ) : (
            <>
              {pinned.length ? (
                <Card title="자주 쓰는 양식">
                  <View className="mt-1">
                    {pinned.map((f) => (
                      <Row key={f.formId} f={f} />
                    ))}
                  </View>
                </Card>
              ) : null}
              <Card title="전체 양식">
                <View className="mt-1">
                  {rest.map((f) => (
                    <Row key={f.formId} f={f} />
                  ))}
                </View>
              </Card>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 2단계: 작성 ──────────────────────────────────────────
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-cd-bg">
      <ScreenHeader
        title={def?.name ?? '기안 작성'}
        subtitle={params.formId ? undefined : '양식 변경하려면 뒤로'}
        back
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
        keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          {form.loading && !def ? (
            <SkeletonList count={4} />
          ) : !def ? (
            <EmptyState icon="document-outline" title="양식을 불러오지 못했습니다" />
          ) : (
            <>
              <Card title="문서 정보">
                <View className="mt-1 gap-3">
                  <View className="gap-1.5">
                    <Text className="text-[13px] font-bold text-cd-muted">제목</Text>
                    <Input value={title} onChangeText={setTitle} placeholder="제목" />
                  </View>
                  <Pressable onPress={() => setUrgent((v) => !v)} className="flex-row items-center gap-2 active:opacity-70">
                    <Ionicons
                      name={urgent ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={urgent ? c.error : c.faint}
                    />
                    <Text className="text-[13px] text-cd-body">긴급</Text>
                  </Pressable>
                </View>
              </Card>

              {/* 양식별 안내 — 휴가 잔여 / 초과근무 주 사용량 */}
              {isLeave && leaveMine.data?.remaining != null ? (
                <View className="rounded-xl bg-cd-primary-soft px-3 py-2.5">
                  <Text className="text-[12.5px] font-bold text-cd-primary">
                    올해 잔여 연차 {leaveMine.data.remaining}일 (총 {leaveMine.data.granted ?? '-'}일 · 사용{' '}
                    {leaveMine.data.used ?? '-'}일)
                  </Text>
                </View>
              ) : null}
              {isLeave && leaveHint ? (
                <View className={`rounded-xl px-3 py-2.5 ${leaveHint.over ? 'bg-cd-error-soft' : 'bg-cd-surface'}`}>
                  <Text className={`text-[12.5px] font-bold ${leaveHint.over ? 'text-cd-error' : 'text-cd-muted'}`}>
                    {leaveHint.text}
                  </Text>
                </View>
              ) : null}
              {isOvertime && otHint ? (
                <View className={`rounded-xl px-3 py-2.5 ${otHint.over ? 'bg-cd-error-soft' : 'bg-cd-surface'}`}>
                  <Text className={`text-[12.5px] font-bold ${otHint.over ? 'text-cd-error' : 'text-cd-muted'}`}>
                    {otHint.text}
                  </Text>
                  {otHint.over ? (
                    <Text className="mt-1 text-[11.5px] text-cd-error">
                      주 12시간을 초과합니다 — 상신 시 특별휴가 전환 동의(전자서명)가 필요합니다.
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <Card title="내용">
                <View className="mt-1 gap-3.5">
                  {packRows(fields).map((row) =>
                    row.length === 1 ? (
                      <FormField
                        key={row[0].key}
                        field={row[0]}
                        value={values[row[0].key]}
                        onSet={(v) => setValue(row[0].key, v)}
                        onFill={(target, v) => setValue(target, v)}
                        linkedFacilityId={linkedFacilityId}
                        allFields={fields}
                        allValues={values}
                        readOnly={isOvertime && (row[0].key === 'used_hours' || row[0].key === 'remain_hours')}
                        periodAutoDays={row[0].type === 'period' ? leaveFixedDays : null}
                      />
                    ) : (
                      <View key={row.map((f) => f.key).join('|')} className="flex-row gap-2.5">
                        {row.map((f) => (
                          <View key={f.key} style={{ flex: widthOf(f) }}>
                            <FormField
                              field={f}
                              value={values[f.key]}
                              onSet={(v) => setValue(f.key, v)}
                              onFill={(target, v) => setValue(target, v)}
                              linkedFacilityId={linkedFacilityId}
                              allFields={fields}
                              allValues={values}
                              // 기사용·잔여시간은 주 사용량에서 자동 계산 — 편집을 허용하면
                              // effect 가 즉시 되돌려 "입력이 안 되는" 혼란만 남는다(2026-08-10).
                              readOnly={isOvertime && (f.key === 'used_hours' || f.key === 'remain_hours')}
                              periodAutoDays={f.type === 'period' ? leaveFixedDays : null}
                            />
                          </View>
                        ))}
                      </View>
                    )
                  )}
                </View>
              </Card>

              {/* 결재선 */}
              <Card
                title="결재선"
                badge={line.length ? <Badge label={`${line.length}`} tone="primary" /> : undefined}
                action={{ label: '결재자 추가', onPress: () => setPicker('line') }}>
                <View className="mt-1">
                  {presets.data?.presets?.length ? (
                    <View className="mb-2 flex-row flex-wrap gap-2">
                      {presets.data.presets.map((p) => (
                        <Chip key={p.presetId} label={p.name} onPress={() => setLine(p.steps)} />
                      ))}
                    </View>
                  ) : null}
                  {line.length === 0 ? (
                    <Text className="py-2 text-[13px] text-cd-faint">
                      결재자를 추가하세요. 웹에서 저장한 결재선이 있으면 위에서 고를 수 있습니다.
                    </Text>
                  ) : (
                    line.map((s, i) => (
                      <CardRow
                        key={`${s.assigneeUserId}-${i}`}
                        first={i === 0}
                        title={`${i + 1}. ${s.assigneeName ?? s.assigneeUserId}`}
                        meta={s.assigneePosition ?? undefined}
                        right={
                          <View className="flex-row items-center gap-2">
                            <Pressable
                              onPress={() =>
                                setLine((prev) =>
                                  prev.map((x, xi) =>
                                    xi === i ? { ...x, stepType: x.stepType === 'agree' ? 'approve' : 'agree' } : x
                                  )
                                )
                              }
                              className="active:opacity-60">
                              <Badge label={s.stepType === 'agree' ? '합의' : '승인'} tone="primary" />
                            </Pressable>
                            <Pressable onPress={() => setLine((prev) => prev.filter((_, xi) => xi !== i))} hitSlop={8}>
                              <Ionicons name="close" size={16} color={c.faint} />
                            </Pressable>
                          </View>
                        }
                      />
                    ))
                  )}
                </View>
              </Card>

              {/* 참조 */}
              <Card
                title="참조"
                badge={watchers.length ? <Badge label={`${watchers.length}`} tone="neutral" /> : undefined}
                action={{ label: '참조자 추가', onPress: () => setPicker('watcher') }}>
                <View className="mt-1 flex-row flex-wrap gap-1.5">
                  {watchers.length === 0 ? (
                    <Text className="py-1 text-[13px] text-cd-faint">필요 시 참조자를 지정합니다.</Text>
                  ) : (
                    watchers.map((w) => (
                      <Pressable
                        key={w.userId}
                        onPress={() => setWatchers((prev) => prev.filter((x) => x.userId !== w.userId))}
                        className="flex-row items-center gap-1 rounded-full bg-cd-surface px-2.5 py-1 active:opacity-70">
                        <Text className="text-[12px] font-semibold text-cd-muted">{w.name}</Text>
                        <Ionicons name="close" size={12} color={c.faint} />
                      </Pressable>
                    ))
                  )}
                </View>
              </Card>
            </>
          )}
        </ScrollView>

        {def ? (
          <ActionBar>
            <Button variant="ghost" label="임시저장" onPress={onSave} loading={busy === 'save'} />
            <Button label="상신" onPress={onSubmit} loading={busy === 'submit'} />
          </ActionBar>
        ) : null}
      </KeyboardAvoidingView>

      <OrgPickerSheet
        visible={picker === 'line'}
        title="결재자 추가"
        hint="추가한 순서대로 결재가 진행됩니다. 합의/승인은 목록에서 바꿉니다."
        onSelect={(emp) => {
          if (!emp.userId) {
            toast.show('앱 계정이 없는 직원은 결재자로 지정할 수 없습니다.', 'error');
            return;
          }
          setLine((prev) =>
            prev.some((s) => s.assigneeUserId === emp.userId)
              ? prev
              : [
                  ...prev,
                  {
                    stepType: 'approve',
                    assigneeUserId: emp.userId as string,
                    assigneeName: emp.name,
                    assigneePosition: emp.positionName,
                  },
                ]
          );
        }}
        onClose={() => setPicker(null)}
      />
      <OrgPickerSheet
        visible={picker === 'watcher'}
        title="참조자 추가"
        multi
        selectedIds={[]}
        onSelect={(emp) => {
          if (!emp.userId) return;
          setWatchers((prev) =>
            prev.some((w) => w.userId === emp.userId)
              ? prev
              : [...prev, { userId: emp.userId as string, name: emp.name, kind: 'ref' }]
          );
        }}
        onClose={() => setPicker(null)}
      />

      {usage && otHint ? (
        <OvertimeConsentSheet
          visible={consentOpen}
          weekStart={usage.weekStart}
          weekEnd={usage.weekEnd}
          totalMinutes={otHint.totalMin}
          excessMinutes={otHint.excessMin}
          limitMinutes={usage.limitMinutes}
          defaultSigner={user?.name ?? ''}
          onAgree={(consent) => {
            consentRef.current = consent;
            setConsentOpen(false);
            void onSubmit();
          }}
          onClose={() => setConsentOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}
