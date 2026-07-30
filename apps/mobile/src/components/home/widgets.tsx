import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge, Card } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { fmtDate } from '@/lib/format';
import { useTheme } from '@/theme/useTheme';

/**
 * 홈 위젯(M6) — 데스크탑 홈의 사용자 배치 카드(lib/home/widgets.ts)를 모바일에 옮긴 것.
 *
 * 표시 여부는 홈 화면이 `/api/home/layout` 의 available(권한)·hidden(웹에서 끈 카드)으로
 * 정한다. 여기 각 카드는 데이터가 없으면 스스로 렌더를 생략한다(빈 카드로 자리를 먹지 않게).
 * 데스크탑에만 어울리는 카드(수금/발행 요약·인텔·임시 사업장)는 옮기지 않았다.
 */

const won = (n?: number | null) => (n == null ? '-' : `${Math.round(n / 10000).toLocaleString()}만`);

/** 목록형 카드의 공통 행. */
function Row({
  title,
  meta,
  right,
  onPress,
  first,
}: {
  title: string;
  meta?: string;
  right?: string;
  onPress?: () => void;
  first?: boolean;
}) {
  const { c } = useTheme();
  const body = (
    <>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-[14px] font-bold text-cd-text">
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} className="text-[11px] text-cd-faint">
            {meta}
          </Text>
        ) : null}
      </View>
      {right ? <Text className="text-[12px] font-bold text-cd-muted">{right}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={14} color={c.faint} /> : null}
    </>
  );
  const cls = `flex-row items-center gap-2 ${first ? '' : 'border-t border-cd-border pt-2 mt-2'}`;
  return onPress ? (
    <Pressable onPress={onPress} className={`${cls} active:opacity-70`}>
      {body}
    </Pressable>
  ) : (
    <View className={cls}>{body}</View>
  );
}

/** 수신 문서(연차 촉진 고지 등) — 회신이 필요한 것만 띄운다. */
export function LeaveNoticeWidget() {
  const router = useRouter();
  const { data } = useApi<{ notices: { noticeId: string; round: number; title: string; deadline: string; submittedAt?: string | null }[] }>(
    '/api/home/leave-notices',
    { cache: true }
  );
  const pending = (data?.notices ?? []).filter((n) => !n.submittedAt);
  if (!pending.length) return null;
  return (
    <Card title="수신 문서" right={<Badge label={`${pending.length}`} tone="warning" />}>
      {pending.map((n, i) => (
        <Row
          key={n.noticeId}
          first={i === 0}
          title={n.title || `연차 사용 촉진 ${n.round}차 고지`}
          meta={`회신 기한 ${n.deadline}`}
          onPress={() => router.push('/leave')}
        />
      ))}
    </Card>
  );
}

/** 업무보고 할 일 — 재보고 요청과 이번 주 작성 대상. */
export function WorkPlanWidget() {
  const { data } = useApi<{
    rebound?: { reportId: string; subjectLabel: string | null; reviewerComment: string | null }[];
    thisWeek?: { contractId: string; contractTitle: string; lastReportDate: string | null }[];
  }>('/api/home/work-plan-todo', { cache: true });
  const rebound = data?.rebound ?? [];
  const week = data?.thisWeek ?? [];
  if (!rebound.length && !week.length) return null;
  return (
    <Card title="업무보고 할 일">
      {rebound.map((r, i) => (
        <Row
          key={r.reportId}
          first={i === 0}
          title={r.subjectLabel ?? '재보고 요청'}
          meta={r.reviewerComment ?? '재보고가 요청되었습니다'}
          right="재보고"
        />
      ))}
      {week.slice(0, 3).map((w, i) => (
        <Row
          key={w.contractId}
          first={i === 0 && rebound.length === 0}
          title={w.contractTitle}
          meta={w.lastReportDate ? `최근 보고 ${w.lastReportDate}` : '보고 이력 없음'}
        />
      ))}
    </Card>
  );
}

/** 세금계산서 발행 요청 — 내 계약의 미요청 대금단위. */
export function InvoiceRequestWidget() {
  const { data } = useApi<{
    contracts: {
      contractId: string;
      contractTitle: string | null;
      milestones: { milestoneId: string; stageLabel: string | null; amount: number | null; requested: boolean }[];
    }[];
  }>('/api/home/invoice-requests/mine', { cache: true });
  const rows = (data?.contracts ?? []).flatMap((c) =>
    (c.milestones ?? [])
      .filter((m) => !m.requested)
      .map((m) => ({ ...m, contractTitle: c.contractTitle, contractId: c.contractId }))
  );
  if (!rows.length) return null;
  return (
    <Card title="발행 요청 대상">
      {rows.slice(0, 4).map((m, i) => (
        <Row
          key={m.milestoneId}
          first={i === 0}
          title={m.contractTitle ?? '계약'}
          meta={m.stageLabel ?? ''}
          right={won(m.amount)}
        />
      ))}
    </Card>
  );
}

/** 발행 요청 수신함 — 회계 담당(billing.receivable.manage)에게만 보인다. */
export function InvoiceInboxWidget() {
  const { data } = useApi<{
    items: {
      milestoneId: string;
      contractTitle: string | null;
      facilityName: string | null;
      stageLabel: string | null;
      amount: number | null;
      requestedByName: string | null;
    }[];
  }>('/api/home/invoice-requests/inbox', { cache: true });
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <Card title="발행 요청 수신함" right={<Badge label={`${items.length}`} tone="primary" />}>
      {items.slice(0, 5).map((it, i) => (
        <Row
          key={it.milestoneId}
          first={i === 0}
          title={it.facilityName ?? it.contractTitle ?? '계약'}
          meta={`${it.stageLabel ?? ''}${it.requestedByName ? ` · ${it.requestedByName} 요청` : ''}`}
          right={won(it.amount)}
        />
      ))}
    </Card>
  );
}

/** 내 참여 용역 진행. */
export function MyServicesWidget() {
  const { data } = useApi<{
    services: {
      contractId: string;
      contractTitle: string;
      counterpartyName: string;
      lastStage: string | null;
      lastPct: number | null;
      completed: boolean;
    }[];
  }>('/api/home/my-services', { cache: true });
  const rows = (data?.services ?? []).filter((s) => !s.completed);
  if (!rows.length) return null;
  return (
    <Card title="내 참여 용역">
      {rows.slice(0, 4).map((s, i) => (
        <Row
          key={s.contractId}
          first={i === 0}
          title={s.contractTitle}
          meta={`${s.counterpartyName}${s.lastStage ? ` · ${s.lastStage}` : ''}`}
          right={s.lastPct != null ? `${Math.round(s.lastPct)}%` : undefined}
        />
      ))}
    </Card>
  );
}

/** 투찰 마감 임박. */
export function UpcomingBidsWidget() {
  const { data } = useApi<{
    bids: { projectId: string; projectTitle: string | null; facilityName: string | null; bidEnd: string | null }[];
  }>('/api/sales/upcoming-bids', { cache: true });
  const rows = data?.bids ?? [];
  if (!rows.length) return null;
  return (
    <Card title="투찰 마감 임박">
      {rows.slice(0, 4).map((b, i) => (
        <Row
          key={b.projectId}
          first={i === 0}
          title={b.projectTitle ?? b.facilityName ?? '입찰'}
          meta={b.facilityName ?? ''}
          right={b.bidEnd ? fmtDate(b.bidEnd) : undefined}
        />
      ))}
    </Card>
  );
}

/** 경과 미입력 — 상세는 일정 화면에서 처리한다. */
export function PendingProgressWidget() {
  const router = useRouter();
  const { data } = useApi<{ reports: { activities?: unknown[] }[] }>('/api/sales/pending-reports', {
    cache: true,
  });
  const count = (data?.reports ?? []).reduce((s, r) => s + (r.activities?.length ?? 0), 0);
  if (!count) return null;
  return (
    <Card title="경과 미입력" onPress={() => router.push('/schedule')}>
      <Text className="text-[13px] text-cd-muted">
        경과를 입력하지 않은 활동이 <Text className="font-bold text-cd-text">{count}건</Text>{' '}
        있습니다.
      </Text>
    </Card>
  );
}

/** 홈에서 쓰는 위젯 키 → 컴포넌트. 데스크탑 카탈로그(lib/home/widgets.ts)의 key 와 맞춘다. */
export const HOME_WIDGET_NODES: Record<string, () => React.ReactNode> = {
  leaveNotice: LeaveNoticeWidget,
  workPlan: WorkPlanWidget,
  invoiceRequest: InvoiceRequestWidget,
  invoiceInbox: InvoiceInboxWidget,
  myServices: MyServicesWidget,
  upcomingBids: UpcomingBidsWidget,
  pendingProgress: PendingProgressWidget,
};

/** 모바일에서 보여줄 순서 — 데스크탑 배치(사용자 자유 배치)와 달리 중요도 고정 순서다. */
export const MOBILE_WIDGET_ORDER = [
  'leaveNotice',
  'invoiceInbox',
  'invoiceRequest',
  'workPlan',
  'pendingProgress',
  'myServices',
  'upcomingBids',
];
