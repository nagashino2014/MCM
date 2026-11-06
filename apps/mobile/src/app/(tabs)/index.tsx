import { ShellBackground } from '@/theme/ShellBackground';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Avatar,
  Badge,
  Card,
  CardRow,
  HeaderIconButton,
  KpiStrip,
  PullRefresh,
  ScreenHeader,
  SkeletonList,
  type KpiItem,
} from '@/components/ui';
import { TAB_BAR_INSET } from '@/components/ui/GlassTabBar';
import { useWideLayout } from '@/lib/use-wide-layout';
import { HOME_WIDGET_NODES, MOBILE_WIDGET_ORDER, TodoTodayWidget } from '@/components/home/widgets';
import { WeatherWidget } from '@/components/home/weather/WeatherWidget';
import { AttendanceLeaveCard } from '@/components/home/AttendanceLeaveCard';
import { HomeCalendarCard } from '@/components/home/HomeCalendarCard';
import { QuickActionsCard } from '@/components/home/QuickActionsCard';
import { useApi } from '@/lib/use-api';
import { useAuth } from '@/lib/auth-context';
import { useNavBadges } from '@/lib/use-nav-badges';
import { fmtDate } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

interface Activity {
  activityId: string;
  projectTitle?: string;
  facilityName?: string;
  scheduledAt?: string | null;
}
interface PendingReport {
  projectId: string;
  title: string;
  facilityName?: string | null;
  activities?: unknown[];
}
interface BoardPost {
  postId: string;
  title: string;
  authorName?: string | null;
  createdAt: string;
  unread?: boolean;
  pinnedNow?: boolean;
}
interface HomeLayout {
  layout?: { hidden?: string[] };
  available?: { key: string; label: string }[];
  /** 빠른 실행 타일 구성(계정별). null·없음 = 기본 구성. */
  quickActions?: string[] | null;
}
/** 홈 목록 카드용 최소 필드(결재함·메일함의 응답 일부). */
interface ApprovalDoc {
  docId: string;
  title: string;
  formName: string;
  drafterName: string | null;
  urgent?: boolean;
  submittedAt: string | null;
}
interface MailItem {
  messageId: string;
  subject: string;
  fromAddr: string | null;
  sentAt: string | null;
  createdAt: string;
  isRead: boolean;
}

/**
 * 넓은 창(2열)에서 목록 카드 본문의 고정 높이 = 행 3건(2026-11-06 사용자 요청) — 결재 대기·안읽은 메일·오늘 할 일·최근 공지.
 * 건수가 없거나 적어도 카드 높이가 같아 좌우 열의 줄이 흔들리지 않는다. CardRow(제목 22 + 설명 18 + 위아래 24 + 구분선) 3행.
 */
const HOME_LIST_BODY_H = 200;

const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** ISO → KST "HH:mm" (데스크탑 HomeStats 와 같은 규칙). */
function hhmm(dt?: string | null): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`;
}

/** 오늘(KST) 일정만. */
function todayOnly(list: Activity[]): Activity[] {
  const key = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return list.filter((a) => {
    if (!a.scheduledAt) return false;
    const d = new Date(a.scheduledAt);
    if (Number.isNaN(d.getTime())) return false;
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) === key;
  });
}

/**
 * 홈 — KESI Frosted(2026-11-03): 베이지 바탕 위 흰 카드, 요약 스트립, 중립 아이콘.
 *
 * 구성: 헤더(인사말) → 날씨 위젯 → 요약 스트립 2줄(데스크탑 HomeStats 와 같은 소스, KPI 타일 대신) → 빠른 실행
 *       → 경과 미입력 → 사용자 위젯 → 최근 공지.
 * 화면 부품은 전부 `components/ui` 의 공용 컴포넌트다 — 이 화면의 스타일이 앱 전체의 기본이라
 * 여기서 로컬로 정의하면 다른 화면이 따라올 수 없다.
 *
 * 넓은 창(데스크탑 위젯·PWA, 폭 ≥ 900, 2026-11-06 사용자 요청) — 세로 한 줄을 그대로 늘리지 않고 **좌우 2열**로 나눈다.
 *   왼쪽: 날씨 → 요약 스트립 → 빠른 실행 → 결재 대기 → 안읽은 메일 (→ 사용자 위젯)
 *   오른쪽: 캘린더+오늘 일정 한 카드(높이 = 왼쪽의 날씨+요약 스트립) → 경과 미입력(영업 담당자) 또는 근태·휴가(그 외) → 오늘 할 일 → 최근 공지
 * 카드 부품은 한 벌이고 배치만 다르다. 좁은 창·네이티브는 아래 한 줄 순서 그대로다.
 */
export default function HomeScreen() {
  const { user } = useAuth();
  const { c } = useTheme();
  const router = useRouter();
  const badges = useNavBadges();
  const wide = useWideLayout();
  /** 넓은 창에서 왼쪽 열의 "날씨 + 요약 스트립" 높이 — 오른쪽 캘린더 카드를 같은 높이로 맞춘다. */
  const [topH, setTopH] = useState<number | null>(null);
  /** 넓은 창에서 빠른 실행 카드의 높이 — 오른쪽 근태·휴가 카드를 같은 높이로 맞춘다. */
  const [quickH, setQuickH] = useState<number | null>(null);
  /** 넓은 창의 목록 카드 본문 — 3건 높이 고정. 좁은 창·네이티브는 내용 높이 그대로. */
  const listBody = wide ? { minHeight: HOME_LIST_BODY_H } : undefined;

  const upcoming = useApi<{ activities: Activity[] }>('/api/sales/upcoming-activities', { cache: true });
  const pending = useApi<{ reports: PendingReport[] }>('/api/sales/pending-reports', { cache: true });
  const board = useApi<{ posts: BoardPost[] }>('/api/board?scope=company', { cache: true });
  const home = useApi<HomeLayout>('/api/home/layout', { cache: true });
  const inbox = useApi<{ items: { milestoneId: string }[] }>('/api/home/invoice-requests/inbox', { cache: true });
  const workPlan = useApi<{ rebound?: { count: number }; thisWeek?: { count: number } }>('/api/home/work-plan-todo', {
    cache: true,
  });
  // 홈에서 바로 보는 목록 3종(사용자 요청 2026-08-10) — 각 탭과 같은 데이터원을 쓴다.
  const approvals = useApi<{ docs: ApprovalDoc[] }>('/api/approval/docs?box=pending', { cache: true });
  const mails = useApi<{ items: MailItem[] }>('/api/mail/messages?folder=inbox&limit=20&offset=0', {
    cache: true,
  });

  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef({ upcoming, pending, board, home, inbox, workPlan, badges, approvals, mails });
  latest.current = { upcoming, pending, board, home, inbox, workPlan, badges, approvals, mails };

  const reloadAll = useCallback(async () => {
    setRefreshing(true);
    const l = latest.current;
    await Promise.all([
      l.upcoming.reload(),
      l.pending.reload(),
      l.board.reload(),
      l.home.reload(),
      l.inbox.reload(),
      l.workPlan.reload(),
      l.approvals.reload(),
      l.mails.reload(),
    ]);
    l.badges.reload();
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const l = latest.current;
      l.badges.reload();
      void l.board.reload();
      void l.upcoming.reload();
      void l.pending.reload();
      void l.approvals.reload();
      void l.mails.reload();
    }, [])
  );

  const activities = upcoming.data?.activities ?? [];
  const today = useMemo(() => todayOnly(activities), [activities]);
  const firstAt = useMemo(
    () =>
      today
        .map((a) => hhmm(a.scheduledAt))
        .filter((v): v is string => !!v)
        .sort()[0],
    [today]
  );
  const reports = pending.data?.reports ?? [];
  const pendingCount = reports.reduce((s, r) => s + (r.activities?.length ?? 0), 0);
  const approvalDocs = approvals.data?.docs ?? [];
  const unreadMails = useMemo(() => (mails.data?.items ?? []).filter((m) => !m.isRead), [mails.data]);
  const posts = board.data?.posts ?? [];
  const inboxCount = inbox.data?.items?.length ?? null;
  const rebound = workPlan.data?.rebound?.count ?? 0;
  const workTodo = workPlan.data ? rebound + (workPlan.data.thisWeek?.count ?? 0) : null;

  /** 권한(available)과 사용자 설정(hidden)을 통과한 위젯만, 고정 순서로.
   *  경과 미입력은 전용 카드가 대신하므로 위젯 목록에서 뺀다(중복 방지). */
  const widgetKeys = useMemo(() => {
    const allowed = new Set((home.data?.available ?? []).map((a) => a.key));
    const hidden = new Set(home.data?.layout?.hidden ?? []);
    return MOBILE_WIDGET_ORDER.filter(
      (k) =>
        k !== 'pendingProgress' &&
        (allowed.size === 0 || allowed.has(k)) &&
        !hidden.has(k) &&
        HOME_WIDGET_NODES[k]
    );
  }, [home.data]);

  // 영업 담당자(영업 제설정에서 지정 → 영업 메뉴 권한 sales.view) 여부 — 홈 위젯 권한 목록에 '경과 미입력'이 있으면 영업 담당자다
  // (대표이사·관리자 포함). 넓은 창 오른쪽 둘째 카드를 고르는 기준이며, 권한 목록을 받기 전에는 그 자리를 비워 둔다.
  const isSales = (home.data?.available ?? []).some((a) => a.key === 'pendingProgress');

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일`;

  // 요약 스트립 — 숫자 색은 지금 문제인 것(결재 대기·경과 미입력·재작성)에만. 권한이 없어 못 받은 항목은 빠진다.
  const kpiFirst: KpiItem[] = [
    { key: 'approval', label: '결재 대기', value: badges.approvalPending ?? 0, hint: badges.approvalPending ? '내 차례' : undefined, tone: 'danger', onPress: () => router.push('/(tabs)/approval') },
    { key: 'mail', label: '안읽은 메일', value: badges.mailUnread ?? 0, onPress: () => router.push('/(tabs)/mail') },
    { key: 'schedule', label: '오늘 일정', value: today.length, hint: firstAt ? `${firstAt} 시작` : undefined, onPress: () => router.push('/schedule') },
  ];
  const kpiSecond: KpiItem[] = [
    { key: 'progress', label: '경과 미입력', value: pendingCount, tone: 'warning', onPress: () => router.push('/sales') },
    ...(inboxCount == null ? [] : [{ key: 'invoice', label: '발행 요청', value: inboxCount, onPress: () => router.push('/invoice-requests') } satisfies KpiItem]),
    ...(workTodo == null
      ? []
      : [{ key: 'workPlan', label: '업무보고', value: workTodo, hint: rebound > 0 ? `재작성 ${rebound}` : undefined, tone: 'danger', onPress: () => router.push('/work-reports') } satisfies KpiItem]),
  ];

  // ── 카드 조각 — 한 벌을 만들어 두고 배치(1열·2열)만 바꾼다 ──
  const kpiNode = (
    <>
          {/* 요약 스트립 2줄 — KPI 타일 금지(Frosted). 한 카드 안 묶음 3개, 세로 hairline 으로만 나눈다. */}
          <View className="gap-2">
            <KpiStrip items={kpiFirst} />
            <KpiStrip items={kpiSecond} />
          </View>
    </>
  );
  const quickNode = (
    // 빠른 실행 — 계정별로 타일을 넣고 뺄 수 있다(2026-11-06). 넓은 창에서는 높이를 재서 오른쪽 근태·휴가 카드를 맞춘다.
    <QuickActionsCard
      saved={home.data?.quickActions}
      onSaved={() => void home.reload()}
      onLayout={wide ? (e) => setQuickH(Math.round(e.nativeEvent.layout.height)) : undefined}
    />
  );
  const approvalNode = (
    <>
          {/* 결재 대기 → 안읽은 메일 → 오늘 일정(사용자 요청 2026-08-10, 빠른 실행 다음 고정 순서).
              비어 있어도 자리를 지킨다 — 홈에서 "오늘 볼 것"이 한 번에 잡히게 하기 위함이다. */}
          <Card
            title="결재 대기"
            badge={approvalDocs.length ? <Badge label={`${approvalDocs.length}`} tone="error" /> : undefined}
            action={{ label: '결재함', onPress: () => router.push('/(tabs)/approval') }}>
            <View style={listBody}>
              {approvals.loading && !approvals.data ? (
                <SkeletonList count={2} />
              ) : approvalDocs.length === 0 ? (
                <Text className="py-2 text-[14px] text-cd-muted">결재할 문서가 없습니다.</Text>
              ) : (
                <View>
                  {approvalDocs.slice(0, 3).map((d, i) => (
                    <CardRow
                      key={d.docId}
                      first={i === 0}
                      strong
                      title={d.title}
                      meta={`${d.formName}${d.drafterName ? ` · ${d.drafterName}` : ''}${
                        d.submittedAt ? ` · ${fmtDate(d.submittedAt)}` : ''
                      }`}
                      right={d.urgent ? <Badge label="긴급" tone="error" /> : undefined}
                      onPress={() => router.push({ pathname: '/approval/[docId]', params: { docId: d.docId } })}
                    />
                  ))}
                </View>
              )}
          
            </View>
          </Card>
    </>
  );
  const mailNode = (
    <>
          <Card
            title="안읽은 메일"
            badge={unreadMails.length ? <Badge label={`${unreadMails.length}`} tone="primary" /> : undefined}
            action={{ label: '메일함', onPress: () => router.push('/(tabs)/mail') }}>
            <View style={listBody}>
              {mails.loading && !mails.data ? (
                <SkeletonList count={2} />
              ) : unreadMails.length === 0 ? (
                <Text className="py-2 text-[14px] text-cd-muted">안읽은 메일이 없습니다.</Text>
              ) : (
                <View>
                  {unreadMails.slice(0, 3).map((m, i) => (
                    <CardRow
                      key={m.messageId}
                      first={i === 0}
                      strong
                      title={m.subject || '(제목 없음)'}
                      meta={`${m.fromAddr ?? '-'} · ${fmtDate(m.sentAt ?? m.createdAt)}`}
                      onPress={() =>
                        router.push({ pathname: '/mail/[messageId]', params: { messageId: m.messageId } })
                      }
                    />
                  ))}
                </View>
              )}
          
            </View>
          </Card>
    </>
  );
  const todayNode = (
    <>
          {/* 오늘 일정 — KPI 와 같은 소스(영업 활동 일정) */}
          <Card
            title="오늘 일정"
            badge={today.length ? <Badge label={`${today.length}`} tone="success" /> : undefined}
            action={{ label: '일정', onPress: () => router.push('/schedule') }}>
            {today.length === 0 ? (
              <Text className="py-2 text-[14px] text-cd-muted">오늘 예정된 일정이 없습니다.</Text>
            ) : (
              <View>
                {today.slice(0, 3).map((a, i) => (
                  <CardRow
                    key={a.activityId}
                    first={i === 0}
                    title={a.projectTitle ?? '(제목 없음)'}
                    meta={[hhmm(a.scheduledAt), a.facilityName].filter(Boolean).join(' · ')}
                    accent={c.success}
                    onPress={() => router.push('/schedule')}
                  />
                ))}
              </View>
            )}
          </Card>
    </>
  );
  const pendingNode = (keepEmpty: boolean) => (
    <>
          {/* 경과 미입력 — 건수만이 아니라 어떤 건인지 보여준다. keepEmpty(넓은 창의 영업 담당자 자리)면 0건이어도 카드를 둔다. */}
          {pendingCount > 0 || keepEmpty ? (
            <Card
              title="경과 미입력"
              badge={pendingCount > 0 ? <Badge label={`${pendingCount}`} tone="warning" /> : undefined}
              action={{ label: '경과 입력', onPress: () => router.push('/sales') }}>
              {pendingCount === 0 ? (
                <Text className="py-2 text-[14px] text-cd-muted">경과를 입력할 건이 없습니다.</Text>
              ) : (
                /* 카드 안 카드 금지 — 행(hairline)으로 나눈다 */
                <View>
                  {reports.slice(0, 3).map((r, i) => (
                    <CardRow
                      key={r.projectId}
                      first={i === 0}
                      title={r.title}
                      meta={r.facilityName ?? undefined}
                      right={<Badge label={`${r.activities?.length ?? 0}건`} tone="warning" />}
                      onPress={() => router.push('/sales')}
                    />
                  ))}
                </View>
              )}
            </Card>
          ) : null}
    </>
  );
  const widgetsNode = (
    <>
          {/* 위젯 — 각 카드는 데이터가 없으면 스스로 렌더를 생략한다 */}
          {widgetKeys.map((k) => {
            const Node = HOME_WIDGET_NODES[k];
            return <Node key={k} />;
          })}
    </>
  );
  const noticeNode = (
    <>
          {/* 최근 공지 */}
          <Card title="최근 공지" action={{ label: '전체보기', onPress: () => router.push('/(tabs)/collab') }}>
            <View style={listBody}>
              {board.loading && !posts.length ? (
                <SkeletonList count={2} />
              ) : posts.length === 0 ? (
                <Text className="py-2 text-[14px] text-cd-muted">등록된 공지가 없습니다.</Text>
              ) : (
                <View>
                  {posts.slice(0, 3).map((p, i) => (
                    <CardRow
                      key={p.postId}
                      first={i === 0}
                      strong={p.unread}
                      title={p.title}
                      meta={`${p.authorName ?? '-'} · ${fmtDate(p.createdAt)}`}
                      onPress={() => router.push({ pathname: '/board/[postId]', params: { postId: p.postId } })}
                    />
                  ))}
                </View>
              )}
          
            </View>
          </Card>
    </>
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-transparent">
      <ShellBackground />
      <ScrollView
        className="flex-1"
        // 글라스 탭 바 뒤로 콘텐츠가 이어지도록 바 높이만큼 더 띄운다.
        contentContainerStyle={{ paddingBottom: 32 + TAB_BAR_INSET }}
        refreshControl={<PullRefresh refreshing={refreshing} onRefresh={reloadAll} tintColor={c.faint} />}>
        <ScreenHeader
          title={`${user?.name ?? '사용자'}님, 안녕하세요`}
          subtitle={dateStr}
          right={
            <>
              <HeaderIconButton icon="notifications-outline" label="알림" onPress={() => router.push('/notifications')} />
              <Avatar name={user?.name} size="md" />
            </>
          }
        />

        {wide ? (
          // 넓은 창 — 좌우 2열. 각 열은 위에서 아래로 쌓이고 서로 높이를 맞추지 않는다(오른쪽 첫 카드만 왼쪽 위 묶음과 같은 높이).
          <View className="flex-row gap-4 px-4" style={{ alignItems: 'flex-start' }}>
            <View className="gap-4" style={{ flex: 1, minWidth: 0 }}>
              <View className="gap-4" onLayout={(e) => setTopH(Math.round(e.nativeEvent.layout.height))}>
                <WeatherWidget />
                {kpiNode}
              </View>
              {quickNode}
              {approvalNode}
              {mailNode}
              {widgetsNode}
            </View>
            <View className="gap-4" style={{ flex: 1, minWidth: 0 }}>
              <HomeCalendarCard height={topH ?? undefined} />
              {home.data ? isSales ? pendingNode(true) : <AttendanceLeaveCard height={quickH ?? undefined} /> : null}
              {/* 오늘 할 일(H12) */}
              <TodoTodayWidget bodyMinHeight={HOME_LIST_BODY_H} />
              {noticeNode}
            </View>
          </View>
        ) : (
          <View className="gap-4 px-4">
            <WeatherWidget />
            {kpiNode}
            {quickNode}
            {approvalNode}
            {mailNode}
            {todayNode}
            {pendingNode(false)}
            {widgetsNode}
            {noticeNode}
            {/* 오늘 할 일(H12) — 기존 카드 순서 뒤에 둔다. 웹 available 목록에 todoToday 가 없어 레지스트리 대신 직접 렌더. */}
            <TodoTodayWidget />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
