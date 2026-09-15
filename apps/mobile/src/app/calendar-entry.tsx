import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ActionBar, Button, Chip, ConfirmSheet, Input, ScreenHeader, Textarea, useToast } from '@/components/ui';
import { OrgPickerSheet, type OrgEmployee } from '@/components/pickers/OrgPickerSheet';
import { apiFetch, apiJson } from '@/lib/api';
import { openAttachment } from '@/lib/open-attachment';
import { useTheme } from '@/theme/useTheme';
import {
  CALENDAR_ENTRY_KIND_LABELS,
  type CalendarEntry,
  type CalendarEntryInput,
  type CalendarEntryKind,
  type CalendarPerson,
} from '@/lib/calendar/types';

/**
 * 회의·면접·미팅 일정 등록/편집/상세(219) — 웹 CalendarEntryModal 의 모바일 이식.
 * 진입: /calendar-entry?kind=meeting|interview|visit&date=YYYY-MM-DD (신규) 또는 ?entryId= (편집·상세).
 * 권한(회의=관리자·임원, 면접=면접 관리자, 미팅=누구나)은 서버가 판정한다 — canEdit=false 면 읽기 전용.
 * 면접 이력서(PDF)는 등록 후 첨부되고, 참석자는 열기(캐시 다운로드 → 공유 시트)로 본다.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 숫자를 이어 치면 구분자가 붙는다 — 20260901 → 2026-09-01, 0930 → 09:30 (웹 CdDateInput/TimeInput 과 같은 손맛). */
const fmtDate = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
};
const fmtTime = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
};

interface ContractOption {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
}

export default function CalendarEntryScreen() {
  const params = useLocalSearchParams<{ kind?: string; date?: string; entryId?: string }>();
  const router = useRouter();
  const toast = useToast();
  const { c } = useTheme();

  const entryId = params.entryId || null;
  const [entry, setEntry] = useState<CalendarEntry | null>(null);
  const [loading, setLoading] = useState(!!entryId);
  const kind: CalendarEntryKind = (entry?.kind ?? (params.kind as CalendarEntryKind) ?? 'visit') as CalendarEntryKind;
  const editable = entry ? entry.canEdit : true;

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(params.date && DAY_RE.test(params.date) ? params.date : '');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState(() => (!params.entryId && params.kind === 'meeting' ? '회의실' : ''));
  const [attendees, setAttendees] = useState<CalendarPerson[]>([]);
  const [note, setNote] = useState('');
  const [canceled, setCanceled] = useState(false);
  // 면접
  const [candidateName, setCandidateName] = useState('');
  const [postingId, setPostingId] = useState('');
  const [postingTitle, setPostingTitle] = useState('');
  const [postings, setPostings] = useState<{ postingId: string; title: string }[]>([]);
  const [resumeFile, setResumeFile] = useState<{ uri: string; name: string } | null>(null);
  // 미팅
  const [visitors, setVisitors] = useState('');
  const [contractId, setContractId] = useState<string | null>(null);
  const [contractTitle, setContractTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [contractQ, setContractQ] = useState('');
  const [contractOpts, setContractOpts] = useState<ContractOption[]>([]);

  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null);

  // 편집·상세: 서버 본문 로드
  useEffect(() => {
    if (!entryId) return;
    let alive = true;
    apiJson<{ entry: CalendarEntry }>(`/api/calendar/entries/${encodeURIComponent(entryId)}`)
      .then(({ entry: e }) => {
        if (!alive) return;
        setEntry(e);
        setTitle(e.title);
        setDate(e.date);
        setStartTime(e.startTime ?? '');
        setEndTime(e.endTime ?? '');
        setLocation(e.location ?? '');
        setAttendees(e.attendees);
        setNote(e.note ?? '');
        setCanceled(e.isCanceled);
        setCandidateName(e.extra.candidateName ?? '');
        setPostingId(e.extra.postingId ?? '');
        setPostingTitle(e.extra.postingTitle ?? '');
        setVisitors(e.extra.visitors ?? '');
        setContractId(e.extra.contractId ?? null);
        setContractTitle(e.extra.contractTitle ?? '');
        setTopic(e.extra.topic ?? '');
      })
      .catch((err: Error) => toast.show(err.message || '일정을 불러오지 못했습니다.', 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  // 면접 — 채용공고 목록(면접 관리자만 성공)
  useEffect(() => {
    if (kind !== 'interview' || !editable) return;
    apiJson<{ postings: { postingId: string; title: string }[] }>('/api/calendar/postings')
      .then((d) => setPostings(d.postings ?? []))
      .catch(() => {});
  }, [kind, editable]);

  // 미팅 — 용역 검색(2자 이상, 디바운스)
  useEffect(() => {
    const q = contractQ.trim();
    const t = setTimeout(() => {
      if (kind !== 'visit' || q.length < 2) {
        setContractOpts([]);
        return;
      }
      apiJson<{ items: ContractOption[] }>(`/api/contracts?q=${encodeURIComponent(q)}&limit=10`)
        .then((d) => setContractOpts(Array.isArray(d.items) ? d.items : []))
        .catch(() => setContractOpts([]));
    }, 200);
    return () => clearTimeout(t);
  }, [kind, contractQ]);

  const heading = useMemo(() => {
    const k = CALENDAR_ENTRY_KIND_LABELS[kind];
    if (!entryId) return `${k} 일정 등록`;
    return editable ? `${k} 일정 편집` : `${k} 일정`;
  }, [kind, entryId, editable]);

  const toggleAttendee = useCallback((emp: OrgEmployee) => {
    setAttendees((prev) =>
      prev.some((p) => p.employeeId === emp.employeeId)
        ? prev.filter((p) => p.employeeId !== emp.employeeId)
        : [...prev, { employeeId: emp.employeeId, name: emp.name, positionName: emp.positionName, deptName: null }]
    );
  }, []);

  const pickResume = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    if (!/\.pdf$/i.test(a.name) && a.mimeType !== 'application/pdf') {
      toast.show('PDF 파일만 첨부할 수 있습니다.', 'error');
      return;
    }
    setResumeFile({ uri: a.uri, name: a.name });
  };

  const uploadResume = async (id: string, file: { uri: string; name: string }) => {
    const fd = new FormData();
    fd.append('file', new File(file.uri) as unknown as Blob, file.name);
    const res = await apiFetch(`/api/calendar/entries/${encodeURIComponent(id)}/resume`, { method: 'POST', body: fd });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error ?? '이력서 업로드에 실패했습니다.');
    }
  };

  const save = async () => {
    if (!editable) return;
    if (!DAY_RE.test(date)) {
      toast.show('날짜를 YYYY-MM-DD 로 입력하세요.', 'error');
      return;
    }
    const input: CalendarEntryInput = {
      kind,
      title: title.trim(),
      date,
      startTime: startTime || null,
      endTime: endTime || null,
      location: location.trim() || null,
      attendeeIds: attendees.map((p) => p.employeeId),
      note: note.trim() || null,
      extra:
        kind === 'interview'
          ? { candidateName: candidateName.trim(), postingId: postingId || null, postingTitle: postingTitle.trim() }
          : kind === 'visit'
            ? { visitors: visitors.trim(), contractId, contractTitle: contractTitle.trim(), topic: topic.trim() }
            : {},
      isCanceled: entry?.ruleId ? canceled : undefined,
    };
    setBusy('save');
    try {
      const { entry: saved } = await apiJson<{ entry: CalendarEntry }>(
        entryId ? `/api/calendar/entries/${encodeURIComponent(entryId)}` : '/api/calendar/entries',
        { method: entryId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
      );
      if (kind === 'interview' && resumeFile) {
        try {
          await uploadResume(saved.entryId, resumeFile);
        } catch (err) {
          toast.show(`일정은 저장됐지만 ${(err as Error).message}`, 'error');
          router.back();
          return;
        }
      }
      toast.show(entryId ? '일정을 수정했습니다.' : '일정을 등록했습니다.', 'success');
      router.back();
    } catch (err) {
      toast.show((err as Error).message || '저장에 실패했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!entryId) return;
    setBusy('delete');
    try {
      const d = await apiJson<{ canceled: boolean }>(`/api/calendar/entries/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      toast.show(d.canceled ? '정기 회의를 미시행으로 표시했습니다.' : '일정을 삭제했습니다.', 'success');
      setConfirm(false);
      router.back();
    } catch (err) {
      toast.show((err as Error).message || '삭제에 실패했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const openResume = async () => {
    if (!entry?.extra.resume) return;
    try {
      await openAttachment(`/api/calendar/entries/${encodeURIComponent(entry.entryId)}/resume?disposition=attachment`, entry.extra.resume.fileName);
    } catch (err) {
      toast.show((err as Error).message || '이력서를 열 수 없습니다.', 'error');
    }
  };

  const ro = !editable;
  const label = (k: string) => <Text className="text-[13px] font-bold text-cd-muted">{k}</Text>;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader title={heading} back variant="sub" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {loading ? (
            <Text className="text-[13px] text-cd-faint">불러오는 중…</Text>
          ) : (
            <>
              {entry?.ruleId ? (
                <View className="rounded-xl border border-cd-border bg-cd-card px-3.5 py-3 gap-2">
                  <Text className="text-[12.5px] text-cd-muted">
                    정기 회의 회차입니다{entry.isModified ? ' (조정됨)' : ''}. 날짜·시간을 바꾸면 이 회차만 조정됩니다.
                  </Text>
                  {editable ? (
                    <Pressable onPress={() => setCanceled((v) => !v)} className="flex-row items-center gap-2 active:opacity-70">
                      <Ionicons name={canceled ? 'checkbox' : 'square-outline'} size={20} color={canceled ? c.primary : c.faint} />
                      <Text className="text-[14px] font-bold text-cd-text">이 회차 미시행</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {kind === 'meeting' ? (
                <Input label="회의명" value={title} editable={!ro} onChangeText={setTitle} placeholder="주간회의 / 간부간담회 / 임시회의" />
              ) : null}
              {kind === 'meeting' && !ro ? (
                <View className="flex-row flex-wrap gap-2">
                  {['주간회의', '간부간담회'].map((n) => (
                    <Chip key={n} label={n} active={title === n} onPress={() => setTitle(n)} />
                  ))}
                </View>
              ) : null}

              {kind === 'interview' ? (
                <>
                  <Input label="면접자 성명" value={candidateName} editable={!ro} onChangeText={setCandidateName} />
                  {!ro && postings.length ? (
                    <View className="gap-1.5">
                      {label('채용 공고')}
                      <View className="flex-row flex-wrap gap-2">
                        {postings.map((p) => (
                          <Chip
                            key={p.postingId}
                            label={p.title}
                            active={postingId === p.postingId}
                            onPress={() => {
                              if (postingId === p.postingId) {
                                setPostingId('');
                              } else {
                                setPostingId(p.postingId);
                                setPostingTitle(p.title);
                              }
                            }}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {ro || !postingId ? (
                    <Input label="채용 공고명" value={postingTitle} editable={!ro} onChangeText={setPostingTitle} placeholder="공고를 고르거나 직접 입력" />
                  ) : null}
                </>
              ) : null}

              {kind === 'visit' ? (
                <>
                  <Input label="방문자" value={visitors} editable={!ro} onChangeText={setVisitors} placeholder="예: ○○산업 김○○ 팀장 외 2명" />
                  <View className="gap-1.5">
                    {label('관련 업무')}
                    {contractId ? (
                      <View className="flex-row items-center gap-2 rounded-xl border px-3.5 py-3" style={{ borderColor: c.primary, backgroundColor: '#e3edfc' }}>
                        <Ionicons name="document-text-outline" size={16} color={c.primary} />
                        <Text className="flex-1 text-[14px] font-bold text-cd-text" numberOfLines={1}>{contractTitle}</Text>
                        {!ro ? (
                          <Pressable hitSlop={8} onPress={() => { setContractId(null); setContractTitle(''); }}>
                            <Ionicons name="close" size={16} color={c.faint} />
                          </Pressable>
                        ) : null}
                      </View>
                    ) : ro ? (
                      <Input value={topic || contractTitle || '-'} editable={false} />
                    ) : (
                      <>
                        <Input value={contractQ} onChangeText={setContractQ} placeholder="용역명으로 검색(2자 이상)…" />
                        {contractOpts.map((o) => (
                          <Pressable
                            key={o.contractId}
                            onPress={() => { setContractId(o.contractId); setContractTitle(o.contractTitle); setContractQ(''); setContractOpts([]); }}
                            className="rounded-xl border border-cd-border bg-cd-card px-3.5 py-2.5 active:opacity-70">
                            <Text className="text-[13.5px] font-bold text-cd-text" numberOfLines={1}>{o.contractTitle}</Text>
                            {o.counterpartyName ? <Text className="text-[11.5px] text-cd-faint">{o.counterpartyName}</Text> : null}
                          </Pressable>
                        ))}
                        <Input value={topic} onChangeText={setTopic} placeholder="관련 용역이 없으면 업무 내용을 직접 입력" />
                      </>
                    )}
                  </View>
                </>
              ) : null}

              <Input label={kind === 'interview' ? '면접일' : kind === 'visit' ? '미팅일' : '회의일'} value={date} editable={!ro} keyboardType="number-pad" onChangeText={(v) => setDate(fmtDate(v))} placeholder="YYYY-MM-DD" />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input label="시작" value={startTime} editable={!ro} keyboardType="number-pad" onChangeText={(v) => setStartTime(fmtTime(v))} placeholder="HH:MM" />
                </View>
                <View className="flex-1">
                  <Input label="종료" value={endTime} editable={!ro} keyboardType="number-pad" onChangeText={(v) => setEndTime(fmtTime(v))} placeholder="HH:MM" />
                </View>
              </View>
              <Input label={kind === 'interview' ? '면접장소' : kind === 'visit' ? '미팅장소' : '회의장소'} value={location} editable={!ro} onChangeText={setLocation} placeholder="회의실" />

              {/* 참석자 — 조직도에서 고르면 성명/직함 태그가 쌓인다 */}
              <View className="gap-1.5">
                {label('참석자')}
                <View className="flex-row flex-wrap gap-1.5 min-h-[40px] rounded-xl border border-cd-border bg-cd-card p-2">
                  {attendees.length ? (
                    attendees.map((p) => (
                      <Pressable
                        key={p.employeeId}
                        disabled={ro}
                        onPress={() => setAttendees((prev) => prev.filter((x) => x.employeeId !== p.employeeId))}
                        className="flex-row items-center gap-1 rounded-full px-2.5 py-1"
                        style={{ backgroundColor: '#e3edfc' }}>
                        <Text className="text-[12.5px] font-bold" style={{ color: '#2f6fd8' }}>
                          {p.name}
                          {p.positionName ? <Text className="font-medium"> {p.positionName}</Text> : null}
                        </Text>
                        {!ro ? <Ionicons name="close" size={12} color="#2f6fd8" /> : null}
                      </Pressable>
                    ))
                  ) : (
                    <Text className="self-center px-1 text-[12.5px] text-cd-faint">{ro ? '참석자 없음' : '참석자를 지정하세요.'}</Text>
                  )}
                </View>
                {!ro ? <Button label="조직도에서 참석자 선택" variant="soft" onPress={() => setPicker(true)} /> : null}
              </View>

              {/* 면접 이력서 */}
              {kind === 'interview' ? (
                <View className="gap-1.5">
                  {label('이력서(PDF)')}
                  {entry?.extra.resume ? (
                    <Pressable onPress={openResume} className="flex-row items-center gap-2 rounded-xl border border-cd-border bg-cd-card px-3.5 py-3 active:opacity-70">
                      <Ionicons name="document-attach-outline" size={17} color={c.primary} />
                      <Text className="flex-1 text-[14px] font-bold text-cd-text" numberOfLines={1}>{entry.extra.resume.fileName}</Text>
                      <Text className="text-[11.5px] text-cd-faint">{(entry.extra.resume.size / 1024 / 1024).toFixed(1)}MB · 열기</Text>
                    </Pressable>
                  ) : (
                    <Text className="text-[12.5px] text-cd-faint">{editable ? '첨부된 이력서가 없습니다.' : '이력서가 없습니다.'}</Text>
                  )}
                  {editable ? (
                    <View className="flex-row items-center gap-2">
                      <Button label={entry?.extra.resume ? '이력서 교체' : '이력서 첨부'} variant="soft" onPress={pickResume} />
                      {resumeFile ? (
                        <Text className="flex-1 text-[12.5px] text-cd-muted" numberOfLines={1}>{resumeFile.name} (저장 시 업로드)</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Textarea label="비고" value={note} editable={!ro} onChangeText={setNote} minHeight={90} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {!loading && editable ? (
        <ActionBar>
          {entryId ? <Button label={entry?.ruleId ? '미시행' : '삭제'} variant="danger" onPress={() => setConfirm(true)} /> : null}
          <Button label={entryId ? '저장' : '등록'} loading={busy === 'save'} onPress={save} />
        </ActionBar>
      ) : null}

      <OrgPickerSheet
        visible={picker}
        title="참석자 선택"
        hint="회의·면접·미팅에 참석하는 회사 직원을 고르세요. 여러 명을 고를 수 있습니다."
        multi
        selectedIds={attendees.map((p) => p.employeeId)}
        onSelect={toggleAttendee}
        onClose={() => setPicker(false)}
      />
      <ConfirmSheet
        visible={confirm}
        title={entry?.ruleId ? '이 회차를 미시행으로 표시할까요?' : '일정을 삭제할까요?'}
        message={entry?.ruleId ? '캘린더에서 사라지고 목록에 "미시행"으로 남습니다.' : '참석자 알림은 다시 보내지 않습니다.'}
        confirmLabel={entry?.ruleId ? '미시행 처리' : '삭제'}
        danger
        loading={busy === 'delete'}
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </SafeAreaView>
  );
}
