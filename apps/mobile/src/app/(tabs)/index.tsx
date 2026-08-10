import { useCallback, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  ActionTile,
  Avatar,
  Badge,
  Card,
  CardRow,
  HeaderIconButton,
  ScreenHeader,
  SkeletonList,
  StatTile,
  TileGrid,
} from '@/components/ui';
import { HOME_WIDGET_NODES, MOBILE_WIDGET_ORDER } from '@/components/home/widgets';
import { WeatherWidget } from '@/components/home/weather/WeatherWidget';
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

/** 담당자 아이콘의 퍼플 — cd 토큰에 없는 색이라 웹 `--cd-av-2` 와 같은 값을 직접 쓴다. */
const AV_PURPLE = { light: '#7a6bb8', dark: '#b0a2e0' };

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
 * 홈 — 모바일 홈 개편 핸드오프(확정안 2a "소프트 플랫").
 *
 * 구성: 헤더(인사말) → 날씨 위젯 → KPI 6종(데스크탑 HomeStats 와 같은 소스) → 빠른 실행
 *       → 경과 미입력 → 사용자 위젯 → 최근 공지.
 * 화면 부품은 전부 `components/ui` 의 공용 컴포넌트다 — 이 화면의 스타일이 앱 전체의 기본이라
 * 여기서 로컬로 정의하면 다른 화면이 따라올 수 없다.
 */
export default function HomeScreen() {
  const { user } = useAuth();
  const { c, dark } = useTheme();
  const router = useRouter();
  const badges = useNavBadges();

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

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${WD[now.getDay()]}요일`;

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }} className="flex-1 bg-cd-bg">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadAll} tintColor={c.faint} />}>
        <ScreenHeader
          title={`${user?.name ?? '사용자'}님, 안녕하세요`}
          subtitle={dateStr}
          right={
            <>
              <HeaderIconButton icon="notifications-outline" onPress={() => router.push('/notifications')} />
              <Avatar name={user?.name} size="md" />
            </>
          }
        />

        <View className="gap-3.5 px-[18px]">
          <WeatherWidget />

          {/* KPI 6종 — 데스크탑 HomeStats 와 같은 항목·소스. 권한이 없어 못 받은 항목은 빠진다. */}
          <TileGrid columns={3}>
            <StatTile
              key="approval"
              label="결재 대기"
              value={badges.approvalPending}
              delta="내 차례"
              tone={c.error}
              onPress={() => router.push('/(tabs)/approval')}
            />
            <StatTile
              key="mail"
              label="안읽은 메일"
              value={badges.mailUnread}
              delta="확인 필요"
              tone={c.primary}
              onPress={() => router.push('/(tabs)/mail')}
            />
            <StatTile
              key="schedule"
              label="오늘 일정"
              value={today.length}
              delta={firstAt ? `${firstAt} 시작` : '확인 필요'}
              tone={c.success}
              onPress={() => router.push('/schedule')}
            />
            <StatTile
              key="progress"
              label="경과 미입력"
              value={pendingCount}
              delta="확인 필요"
              tone={c.warning}
              onPress={() => router.push('/sales')}
            />
            {inboxCount == null ? null : (
              <StatTile key="invoice" label="발행 요청" value={inboxCount} delta="확인 필요" tone={c.secondary} />
            )}
            {workTodo == null ? null : (
              <StatTile
                key="workPlan"
                label="업무보고"
                value={workTodo}
                delta={rebound > 0 ? `재작성 ${rebound}건` : '확인 필요'}
                tone={c.error}
              />
            )}
          </TileGrid>

          {/* 빠른 실행 — 탭에 없는 기능으로 1탭 진입 */}
          <Card title="빠른 실행">
            <View className="mt-1.5 flex-row justify-between">
              {/* 명함 촬영은 카메라가 필요해 데스크탑 위젯·웹 데모에서는 숨긴다(WID-P0). */}
              {Platform.OS !== 'web' ? (
                <ActionTile icon="camera-outline" label="명함" tone={c.primary} onPress={() => router.push('/card')} />
              ) : null}
              <ActionTile
                icon="paper-plane-outline"
                label="휴가"
                tone={c.success}
                onPress={() => router.push('/leave')}
              />
              <ActionTile
                icon="calendar-outline"
                label="일정"
                tone={c.warning}
                onPress={() => router.push('/schedule')}
              />
              <ActionTile
                icon="business-outline"
                label="사업장"
                tone={c.secondary}
                onPress={() => router.push('/facilities')}
              />
              <ActionTile
                icon="people-outline"
                label="담당자"
                tone={dark ? AV_PURPLE.dark : AV_PURPLE.light}
                onPress={() => router.push('/contacts')}
              />
            </View>
          </Card>

          {/* 결재 대기 → 안읽은 메일 → 오늘 일정(사용자 요청 2026-08-10, 빠른 실행 다음 고정 순서).
              비어 있어도 자리를 지킨다 — 홈에서 "오늘 볼 것"이 한 번에 잡히게 하기 위함이다. */}
          <Card
            title="결재 대기"
            badge={approvalDocs.length ? <Badge label={`${approvalDocs.length}`} tone="error" /> : undefined}
            action={{ label: '결재함', onPress: () => router.push('/(tabs)/approval') }}>
            {approvals.loading && !approvals.data ? (
              <SkeletonList count={2} />
            ) : approvalDocs.length === 0 ? (
              <Text className="py-3 text-[13px] text-cd-faint">결재할 문서가 없습니다.</Text>
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
          </Card>

          <Card
            title="안읽은 메일"
            badge={unreadMails.length ? <Badge label={`${unreadMails.length}`} tone="primary" /> : undefined}
            action={{ label: '메일함', onPress: () => router.push('/(tabs)/mail') }}>
            {mails.loading && !mails.data ? (
              <SkeletonList count={2} />
            ) : unreadMails.length === 0 ? (
              <Text className="py-3 text-[13px] text-cd-faint">안읽은 메일이 없습니다.</Text>
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
          </Card>

          {/* 오늘 일정 — KPI 와 같은 소스(영업 활동 일정) */}
          <Card
            title="오늘 일정"
            badge={today.length ? <Badge label={`${today.length}`} tone="success" /> : undefined}
            action={{ label: '일정', onPress: () => router.push('/schedule') }}>
            {today.length === 0 ? (
              <Text className="py-3 text-[13px] text-cd-faint">오늘 예정된 일정이 없습니다.</Text>
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

          {/* 경과 미입력 — 건수만이 아니라 어떤 건인지 보여준다 */}
          {pendingCount > 0 ? (
            <Card
              title="경과 미입력"
              badge={<Badge label={`${pendingCount}`} tone="warning" />}
              action={{ label: '경과 입력', onPress: () => router.push('/sales') }}>
              <View className="mt-1 gap-2">
                {reports.slice(0, 3).map((r) => (
                  <View key={r.projectId} className="rounded-xl border border-cd-border bg-cd-surface px-3">
                    <CardRow
                      first
                      title={r.title}
                      meta={r.facilityName ?? undefined}
                      accent={c.warning}
                      right={<Badge label={`${r.activities?.length ?? 0}건`} tone="warning" />}
                      onPress={() => router.push('/sales')}
                    />
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {/* 위젯 — 각 카드는 데이터가 없으면 스스로 렌더를 생략한다 */}
          {widgetKeys.map((k) => {
            const Node = HOME_WIDGET_NODES[k];
            return <Node key={k} />;
          })}

          {/* 최근 공지 */}
          <Card title="최근 공지" action={{ label: '전체보기', onPress: () => router.push('/(tabs)/collab') }}>
            {board.loading && !posts.length ? (
              <SkeletonList count={2} />
            ) : posts.length === 0 ? (
              <Text className="py-3 text-[13px] text-cd-faint">등록된 공지가 없습니다.</Text>
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
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
