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

const fmtH = (min: number) => {
  const h = Math.round((min / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

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

  // 초과근무: 기사용·잔여 시간을 자동으로 채운다(웹 DraftBoard 와 같은 계산).
  const usage = otUsage.data;
  const applyHours = Number(values.apply_hours) > 0 ? Number(values.apply_hours) : 0;
  const otHint = useMemo(() => {
    if (!isOvertime || !usage) return null;
    const usedMin = usage.requestedMinutes;
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
          className={`flex-row items-center gap-2.5 border-t border-cd-grid-line py-3 active:opacity-60 ${ok ? '' : 'opacity-50'}`}>
          <View className="flex-1">
            <Text numberOfLines={1} className="text-[13px] font-semibold text-cd-body">
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
                  {fields.map((f) => (
                    <FormField
                      key={f.key}
                      field={f}
                      value={values[f.key]}
                      onSet={(v) => setValue(f.key, v)}
                      onFill={(target, v) => setValue(target, v)}
                      linkedFacilityId={linkedFacilityId}
                    />
                  ))}
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
