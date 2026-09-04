import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Button, Card, CardRow, EmptyState, ScreenHeader, Sheet, SkeletonList } from '@/components/ui';
import { MonthCalendar, type CalendarBar } from '@/components/calendar/MonthCalendar';
import { OrgPickerSheet } from '@/components/pickers/OrgPickerSheet';
import { apiJson } from '@/lib/api';
import { openAttachment } from '@/lib/open-attachment';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';
import {
  CALENDAR_TAG_LABELS,
  CALENDAR_KIND_LABELS,
  DEFAULT_CALENDAR_PREFS,
  ENTRY_ACTIONS,
  SCHEDULE_FORMS,
  TAG_ORDER,
  TAG_TINT,
  type CalendarAccess,
  type CalendarEntry,
  type CalendarEvent,
  type CalendarPrefs,
  type CalendarRefs,
  type CalendarTagKey,
} from '@/lib/calendar/types';

/**
 * 일정 — 데스크탑 `/calendar`(G6-C)의 모바일 이식.
 *
 * 태그 칩(복수 토글·서버 저장) → 월 캘린더(카테고리 색 바) → 카테고리별 목록.
 * 웹은 캘린더 바를 누르면 하단 카드로 스크롤·강조하지만, 모바일에서는 **상세 시트**를 연다
 * (좁은 화면에서 스크롤 점프는 맥락을 잃는다 — 축소 대신 재배치 원칙).
 *
 * 새 일정 등록은 **기안으로 보낸다** — 출장·교육·휴가는 전부 결재 문서가 원천이고,
 * 일정은 그 문서의 투영이다(웹과 같은 원칙). 영업 스케줄만 예외로 직접 등록한다(P5).
 * 회의·면접·미팅(219)은 결재 없이 직접 등록한다(/calendar-entry) — 웹 날짜 셀 메뉴와 같은 구성.
 */

const monthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;

export default function ScheduleScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tags, setTags] = useState<CalendarTagKey[]>([...DEFAULT_CALENDAR_PREFS.tags]);
  const [refs, setRefs] = useState<CalendarRefs>({ ...DEFAULT_CALENDAR_PREFS.refs });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  /** 직접 등록 일정(회의·면접·미팅)의 본문 — 상세 시트에서 장소·참석자·공고·이력서를 보여주기 위해 따로 받는다. */
  const [entry, setEntry] = useState<CalendarEntry | null>(null);
  useEffect(() => {
    const id = detail?.entryId;
    if (!id) return;
    let alive = true;
    apiJson<{ entry: CalendarEntry }>(`/api/calendar/entries/${encodeURIComponent(id)}`)
      .then((d) => alive && setEntry(d.entry))
      .catch(() => {
        /* 본문 실패 시 이벤트 정보만 표시 */
      });
    return () => {
      alive = false;
    };
  }, [detail?.entryId]);
  const closeDetail = () => {
    setDetail(null);
    setEntry(null);
  };
  const [newFor, setNewFor] = useState<string | null>(null);
  const [refsOpen, setRefsOpen] = useState(false);

  // 설정 로드(1회) — 이후 태그·선택 대상 변경 시 서버에 저장한다.
  useEffect(() => {
    let alive = true;
    apiJson<CalendarPrefs>('/api/calendar/prefs')
      .then((p) => {
        if (!alive) return;
        if (Array.isArray(p.tags) && p.tags.length) setTags(p.tags);
        if (p.refs) setRefs(p.refs);
      })
      .catch(() => {
        /* 설정 실패는 기본값으로 */
      })
      .finally(() => alive && setPrefsLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const savePrefs = useCallback(
    (next: Partial<CalendarPrefs>) => {
      if (!prefsLoaded) return;
      void apiJson('/api/calendar/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {
        /* 저장 실패는 조용히 — 화면 상태는 유지된다 */
      });
    },
    [prefsLoaded]
  );

  const month = monthKey(cur.y, cur.m);
  const { data, loading, refreshing, reload } = useApi<{ events: CalendarEvent[]; salesDenied?: boolean; access?: CalendarAccess }>(
    `/api/calendar?month=${month}&tags=${tags.join(',')}`,
    { cache: true }
  );
  const events = data?.events ?? [];
  const access: CalendarAccess = data?.access ?? { meeting: false, interview: false };

  // 등록/편집 화면에서 돌아오면 다시 읽는다(첫 포커스는 useApi 가 이미 로드하므로 건너뜀).
  // ⚠ useApi 의 reload 는 렌더마다 새 함수다 — 의존성에 넣으면 useFocusEffect 가 매 렌더 재실행돼
  //   reload→리렌더→reload 무한 루프(상단 새로고침 표시 반복·시트 미표시·아바타 점멸, 09-04 실기기 실측).
  //   ref 로 최신 reload 를 들고 콜백은 고정한다.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void reloadRef.current();
    }, [])
  );

  const bars: CalendarBar[] = useMemo(
    () =>
      events.filter((e) => !e.canceled).map((e) => ({
        id: e.id,
        startDate: e.startDate,
        endDate: e.endDate,
        title: e.title,
        color: TAG_TINT[e.tag].pillBg,
        ink: TAG_TINT[e.tag].text,
      })),
    [events]
  );

  /** 카테고리별 묶음 — 켜둔 태그 순서대로. */
  const grouped = useMemo(() => {
    const map = new Map<CalendarTagKey, CalendarEvent[]>();
    for (const e of events) {
      const arr = map.get(e.tag) ?? [];
      arr.push(e);
      map.set(e.tag, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    }
    return TAG_ORDER.filter((t) => tags.includes(t) && map.has(t)).map((t) => ({ tag: t, list: map.get(t)! }));
  }, [events, tags]);

  const toggleTag = (t: CalendarTagKey) => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    if (!next.length) return; // 전부 끄면 볼 게 없다
    setTags(next);
    savePrefs({ tags: next });
  };

  const period = (e: CalendarEvent) =>
    `${e.startDate}${e.endDate && e.endDate !== e.startDate ? ` ~ ${e.endDate}` : ''}${
      e.startTime ? ` ${e.startTime}${e.endTime ? `~${e.endTime}` : ''}` : ''
    }`;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScreenHeader
        title="일정"
        subtitle={`${cur.y}년 ${cur.m + 1}월`}
        back
        variant="sub"
        right={
          <Pressable
            onPress={() => setRefsOpen(true)}
            hitSlop={8}
            className="flex-row items-center gap-1.5 rounded-full border border-cd-border bg-cd-card px-[13px] py-2 active:opacity-70">
            <Ionicons name="people-outline" size={14} color="#565e82" />
            <Text className="text-[12px] font-semibold" style={{ color: '#565e82' }}>
              참조 지정
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={c.faint} />}>
        {/* 필터 칩 — 선택은 카테고리 컬러 틴트, 비선택은 흰 배경(핸드오프 3a).
            회의·면접(219) 추가로 7개가 되어 폰트·패딩을 줄여 375 폭에서도 1행에 맞춘다(사용자 요청). */}
        <View className="flex-row flex-nowrap justify-between gap-[4px]">
          {TAG_ORDER.map((t) => {
            const on = tags.includes(t);
            const off = t === 'sales' && data?.salesDenied;
            const tint = TAG_TINT[t];
            return (
              <Pressable
                key={t}
                onPress={() => !off && toggleTag(t)}
                // 권한 없음(off)은 반투명 대신 불투명 감쇠색(2026-08-10 규칙).
                className="flex-row items-center gap-[3px] rounded-full px-[8px] py-[6px] active:opacity-70"
                style={{
                  backgroundColor: on ? tint.bg : c.card,
                  borderWidth: on ? 0 : 1,
                  borderColor: c.border,
                }}>
                <View
                  style={{ backgroundColor: off ? '#c3c8da' : tint.dot }}
                  className="h-[6px] w-[6px] rounded-full"
                />
                <Text
                  className={`text-[11px] ${on ? 'font-bold' : 'font-semibold'}`}
                  style={{ color: off ? '#c3c8da' : on ? tint.text : '#9aa0b8' }}>
                  {CALENDAR_TAG_LABELS[t]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <MonthCalendar
          events={bars}
          year={cur.y}
          month0={cur.m}
          onMonthChange={(y, m) => setCur({ y, m })}
          onEventPress={(bar) => setDetail(events.find((e) => e.id === bar.id) ?? null)}
          onDayPress={(iso) => setNewFor(iso)}
        />

        {loading && !events.length ? (
          <SkeletonList count={3} />
        ) : !grouped.length ? (
          <EmptyState icon="calendar-outline" title="이 달에 표시할 일정이 없습니다" />
        ) : (
          grouped.map(({ tag, list }) => (
            <Card
              key={tag}
              title={CALENDAR_TAG_LABELS[tag]}
              badge={
                <View className="rounded-full px-2 py-[2px]" style={{ backgroundColor: '#f3f4fa' }}>
                  <Text className="text-[11px] font-bold" style={{ color: '#878ea8' }}>
                    {list.length}
                  </Text>
                </View>
              }
              icon={<View style={{ backgroundColor: TAG_TINT[tag].dot }} className="h-2 w-2 rounded-full" />}>
              <View className="mt-1">
                {list.map((e, i) => (
                  <CardRow
                    key={e.id}
                    first={i === 0}
                    title={e.title}
                    meta={`${CALENDAR_KIND_LABELS[e.kind]} · ${period(e)}`}
                    onPress={() => setDetail(e)}
                  />
                ))}
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {/* 일정 상세 — 종류별 항목(회의/면접/미팅=장소·참석자·부가정보, 휴가=휴가자·사유, 출장·교육=대상·내용 …).
          본문 높이는 화면의 55% 로 **고정**(내용이 적어도 같은 높이, 넘치면 내부 스크롤)해 버튼이 잘리지 않게 한다(사용자 피드백 09-04). 버튼은 footer 슬롯. */}
      <Sheet
        visible={!!detail}
        onClose={closeDetail}
        title={detail?.title ?? '일정'}
        footer={
          detail?.entryId ? (
            <View className="flex-1">
              <Button
                label={detail.canEdit ? '일정 편집' : '일정 상세'}
                variant={detail.canEdit ? 'primary' : 'soft'}
                onPress={() => {
                  const id = detail.entryId as string;
                  closeDetail();
                  router.push({ pathname: '/calendar-entry', params: { entryId: id } });
                }}
              />
            </View>
          ) : detail?.docId ? (
            <View className="flex-1">
              <Button
                label="결재 문서 보기"
                onPress={() => {
                  const id = detail.docId as string;
                  closeDetail();
                  router.push({ pathname: '/approval/[docId]', params: { docId: id } });
                }}
              />
            </View>
          ) : undefined
        }>
        {detail ? <DetailBody ev={detail} entry={detail.entryId && entry?.entryId === detail.entryId ? entry : null} /> : null}
      </Sheet>

      {/* 날짜 탭 → 새 일정(기안으로) */}
      <Sheet visible={!!newFor} onClose={() => setNewFor(null)} title={`${newFor ?? ''} 일정 추가`}>
        <View className="gap-1 pb-2">
          <Text className="pb-1 text-[12.5px] text-cd-faint">
            출장·교육·휴가 일정은 결재 문서에서 만들어집니다. 양식을 고르면 날짜가 채워집니다.
          </Text>
          {SCHEDULE_FORMS.map((f) => (
            <Pressable
              key={f.formId}
              onPress={() => {
                const date = newFor;
                setNewFor(null);
                router.push({ pathname: '/approval/draft', params: { formId: f.formId, date: date ?? '' } });
              }}
              className="flex-row items-center gap-2 rounded-xl px-4 py-3 active:opacity-70">
              <Ionicons name="create-outline" size={17} color={c.primary} />
              <Text className="flex-1 text-[15px] text-cd-text">{f.label}</Text>
              <Ionicons name="chevron-forward" size={15} color={c.faint} />
            </Pressable>
          ))}
          {/* 직접 등록(219) — 회의는 관리자·임원, 면접은 면접 관리자, 미팅은 누구나 */}
          <View className="my-1 h-px bg-cd-border" />
          <Text className="pb-1 text-[12.5px] text-cd-faint">회의·면접·미팅은 캘린더에 바로 등록됩니다. 참석자에게 알림이 갑니다.</Text>
          {ENTRY_ACTIONS.map((a) => {
            const allowed = a.needs ? access[a.needs] : true;
            return (
              <Pressable
                key={a.kind}
                disabled={!allowed}
                onPress={() => {
                  const date = newFor;
                  setNewFor(null);
                  router.push({ pathname: '/calendar-entry', params: { kind: a.kind, date: date ?? '' } });
                }}
                className="flex-row items-center gap-2 rounded-xl px-4 py-3 active:opacity-70"
                style={{ opacity: allowed ? 1 : 0.4 }}>
                <Ionicons name="calendar-outline" size={17} color={c.primary} />
                <View className="flex-1">
                  <Text className="text-[15px] text-cd-text">{a.label}</Text>
                  <Text className="text-[11.5px] text-cd-faint">{a.hint}</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={c.faint} />
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      {/* '선택' 태그 대상 지정 */}
      <OrgPickerSheet
        visible={refsOpen}
        title="참조 대상 지정"
        hint="여기서 고른 인원의 일정이 '선택' 태그로 함께 표시됩니다."
        multi
        selectedIds={refs.employeeIds}
        onSelect={(emp) => {
          const next: CalendarRefs = refs.employeeIds.includes(emp.employeeId)
            ? { ...refs, employeeIds: refs.employeeIds.filter((id) => id !== emp.employeeId) }
            : { ...refs, employeeIds: [...refs.employeeIds, emp.employeeId] };
          setRefs(next);
          savePrefs({ refs: next });
          if (!tags.includes('refs')) toggleTag('refs');
        }}
        onClose={() => {
          setRefsOpen(false);
          void reload();
        }}
      />
    </SafeAreaView>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1">
      <Text className="text-[12px] font-bold text-cd-faint">{label}</Text>
      {children}
    </View>
  );
}
function Txt({ v }: { v: string | null | undefined }) {
  return <Text className="text-[14px] leading-6 text-cd-text">{v && v.trim() ? v : '-'}</Text>;
}

/** 상세 시트 본문 — 일정 종류에 맞는 항목만 배치한다. */
function DetailBody({ ev, entry }: { ev: CalendarEvent; entry: CalendarEntry | null }) {
  const { c } = useTheme();
  // 고정 높이 — 종류마다 항목 수가 달라도 시트 크기가 흔들리지 않게 한다(사용자 요청: 비고정 → 고정).
  const fixedH = Math.round(Dimensions.get('window').height * 0.55);
  const period = `${ev.startDate}${ev.endDate && ev.endDate !== ev.startDate ? ` ~ ${ev.endDate}` : ''}${
    ev.startTime ? ` ${ev.startTime}${ev.endTime ? `~${ev.endTime}` : ''}` : ''
  }`;
  const people = entry?.attendees ?? ev.people;
  const isEntry = ev.kind === 'meeting' || ev.kind === 'interview' || ev.kind === 'visit';
  // 휴가는 제목이 "[종류] : [휴가자]" — 대상 인원 배열이 비어 있어 제목에서 이름을 꺼낸다.
  const leaveName = ev.kind === 'leave' ? ev.title.split(' : ').slice(1).join(' : ') : '';
  const peopleLabel =
    ev.kind === 'leave' ? '휴가자' : ev.kind === 'trip' ? '출장자' : ev.kind === 'vehicle' ? '이용자' : ev.kind === 'sales' ? '담당' : isEntry ? '참석자' : '대상';
  const summaryLabel =
    ev.kind === 'leave' ? '사유' : ev.kind === 'trip' ? '목적' : ev.kind === 'vehicle' ? '이용시간' : ev.kind === 'meeting' ? '비고' : ev.kind === 'interview' ? '채용 공고' : ev.kind === 'visit' ? '방문자·관련 업무' : '내용';
  const location = entry?.location ?? ev.location ?? null;

  return (
    <ScrollView style={{ height: fixedH }} contentContainerStyle={{ gap: 14, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center gap-2">
        <Badge label={CALENDAR_KIND_LABELS[ev.kind]} tone="neutral" />
        <Text className="text-[14px] font-semibold text-cd-text">{period}</Text>
        {ev.canceled ? <Badge label="미시행" tone="neutral" /> : null}
      </View>

      {isEntry ? (
        <Row label="장소">
          <Txt v={location} />
        </Row>
      ) : null}

      {ev.kind === 'interview' ? (
        <Row label="채용 공고">
          <Txt v={entry?.extra.postingTitle ?? ev.summary} />
        </Row>
      ) : null}
      {ev.kind === 'visit' ? (
        <>
          <Row label="방문자">
            <Txt v={entry?.extra.visitors ?? ev.summary} />
          </Row>
          <Row label="관련 업무">
            <Txt v={entry ? entry.extra.contractTitle || entry.extra.topic : null} />
          </Row>
        </>
      ) : null}

      <Row label={peopleLabel}>
        {people.length ? (
          <View className="flex-row flex-wrap gap-1.5">
            {people.map((p) => (
              <View key={p.employeeId} className="rounded-full px-2.5 py-1" style={{ backgroundColor: '#e3edfc' }}>
                <Text className="text-[12.5px] font-bold" style={{ color: '#2f6fd8' }}>
                  {p.name}
                  {p.positionName ? <Text className="font-medium"> {p.positionName}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Txt v={leaveName || (isEntry ? '참석자 없음' : null)} />
        )}
      </Row>

      {ev.kind === 'interview' ? (
        <Row label="이력서">
          {entry?.extra.resume ? (
            <Pressable
              onPress={() => {
                const r = entry.extra.resume!;
                void openAttachment(`/api/calendar/entries/${encodeURIComponent(entry.entryId)}/resume?disposition=attachment`, r.fileName).catch(() => {});
              }}
              className="flex-row items-center gap-2 rounded-xl border border-cd-border bg-cd-card px-3.5 py-2.5 active:opacity-70">
              <Ionicons name="document-attach-outline" size={16} color={c.primary} />
              <Text className="flex-1 text-[13.5px] font-bold text-cd-text" numberOfLines={1}>{entry.extra.resume.fileName}</Text>
              <Text className="text-[11.5px] text-cd-faint">열기</Text>
            </Pressable>
          ) : (
            <Txt v={entry ? null : '불러오는 중…'} />
          )}
        </Row>
      ) : null}

      {ev.kind === 'meeting' || ev.kind === 'visit' ? (
        <Row label="비고">
          <Txt v={entry ? entry.note : ev.kind === 'meeting' ? ev.summary : null} />
        </Row>
      ) : ev.kind !== 'interview' ? (
        <Row label={summaryLabel}>
          <Txt v={ev.summary} />
        </Row>
      ) : null}
    </ScrollView>
  );
}
