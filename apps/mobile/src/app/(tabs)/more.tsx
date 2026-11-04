import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, Screen, Sheet } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useApi } from '@/lib/use-api';
import { useInstallPrompt } from '@/lib/use-install-prompt';
import { useTheme } from '@/theme/useTheme';
import { SHADOW_CARD } from '@/theme/tokens';

const ROLE_LABEL: Record<string, string> = {
  admin: '관리자',
  editor: '편집',
  viewer: '조회',
};

// 전체 메뉴(구 더보기) — 핸드오프 4b "2열 태그 버튼": 카드 타일 + 그림자 스퀘클 + 카테고리 컬러.
// 섹션 구조·명칭·이동 대상은 현행 유지, 부제만 2열 폭에 맞게 축약(전체 명칭은 각 화면에서).
export default function MoreScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { c, dark } = useTheme();
  const purple = dark ? '#a78bfa' : '#7a5fd0';
  // 할 일 부제 "오늘 N건 · 지연 N" — 홈 위젯과 같은 /api/home/todo-today(캐시).
  const todo = useApi<{ counts: { overdue: number; today: number } }>('/api/home/todo-today', { cache: true });
  const todoSub = todo.data ? `오늘 ${todo.data.counts.today}건 · 지연 ${todo.data.counts.overdue}` : '오늘 · 예정 · 보드';
  // PC 앱으로 설치(PWA, 2026-11-04) — 브라우저 탭에서만 보인다(위젯 iframe·이미 설치된 앱 창에서는 숨김).
  // 브라우저가 설치 프롬프트를 주지 않는 경우(이미 설치·조건 미충족)는 주소창 설치 아이콘 안내 시트를 띄운다.
  const install = useInstallPrompt();
  const [installGuide, setInstallGuide] = useState(false);
  const onInstall = async () => {
    if (!(await install.install())) setInstallGuide(true);
  };

  const sections: {
    label: string;
    items: { icon: keyof typeof Ionicons.glyphMap; tone: string; title: string; subtitle: string; onPress: () => void }[];
  }[] = [
    {
      label: '소통',
      items: [
        {
          icon: 'megaphone-outline',
          tone: c.primary,
          title: '공지·주소록',
          subtitle: '공지·주소록·조직도',
          onPress: () => router.push('/(tabs)/collab'),
        },
        {
          icon: 'mail-outline',
          tone: c.secondary,
          title: '메일',
          subtitle: '회사 메일함',
          onPress: () => router.push('/(tabs)/mail'),
        },
        {
          icon: 'checkbox-outline',
          tone: purple,
          title: '전자결재',
          subtitle: '결재함·기안',
          onPress: () => router.push('/(tabs)/approval'),
        },
        // 사내 설문(참여) — 외부 설문·배포 이미지는 웹 전용이라 넣지 않는다.
        {
          icon: 'clipboard-outline',
          tone: c.warning,
          title: '설문',
          subtitle: '사내 설문 참여',
          onPress: () => router.push('/surveys'),
        },
      ],
    },
    {
      label: '영업',
      items: [
        { icon: 'trending-up-outline', tone: c.success, title: '영업 활동', subtitle: '등록·경과 입력', onPress: () => router.push('/sales') },
        { icon: 'calendar-outline', tone: c.warning, title: '일정', subtitle: '통합 캘린더', onPress: () => router.push('/schedule') },
        { icon: 'business-outline', tone: c.secondary, title: '사업장', subtitle: '검색·요약 조회', onPress: () => router.push('/facilities') },
        { icon: 'people-outline', tone: purple, title: '담당자', subtitle: '연락처·전화·문자', onPress: () => router.push('/contacts') },
        { icon: 'briefcase-outline', tone: c.primaryStrong, title: '공공입찰', subtitle: '매칭 공고·마감 임박', onPress: () => router.push('/bids') },
        // 명함·영수증 촬영은 카메라 전용 — 데스크탑 위젯·웹 데모에서는 진입점을 숨긴다(WID-P0).
        ...(Platform.OS !== 'web'
          ? [
              {
                icon: 'camera-outline' as const,
                tone: c.primary,
                title: '명함 촬영',
                subtitle: 'AI 인식·담당자 등록',
                onPress: () => router.push('/card'),
              },
              {
                icon: 'receipt-outline' as const,
                tone: c.error,
                title: '영수증',
                subtitle: '촬영 · 보관함',
                onPress: () => router.push('/receipt-menu'),
              },
            ]
          : []),
      ],
    },
    {
      label: '업무',
      items: [
        {
          icon: 'checkmark-done-outline',
          tone: c.primary,
          title: '할 일',
          subtitle: todoSub,
          onPress: () => router.push('/todo'),
        },
        {
          icon: 'paper-plane-outline',
          tone: c.accent,
          title: '발행 요청',
          subtitle: '세금계산서 발행 요청·수신함',
          onPress: () => router.push('/invoice-requests'),
        },
        {
          icon: 'clipboard-outline',
          tone: c.primaryStrong,
          title: '업무보고',
          subtitle: '용역 추진 보고 작성·확인',
          onPress: () => router.push('/work-reports'),
        },
      ],
    },
    {
      label: '근무',
      items: [
        { icon: 'calendar-outline', tone: c.success, title: '근태·휴가', subtitle: '연차·초과근무·신청', onPress: () => router.push('/leave') },
        { icon: 'time-outline', tone: c.warning, title: '내 근태', subtitle: '주별 근무시간', onPress: () => router.push('/attendance') },
      ],
    },
    {
      label: '기타',
      items: [
        { icon: 'book-outline', tone: c.primary, title: '사용 매뉴얼', subtitle: '기능 설명·검색', onPress: () => router.push('/manual') },
        { icon: 'settings-outline', tone: c.muted, title: '설정', subtitle: '앱 잠금·알림·계정', onPress: () => router.push('/settings') },
        ...(install.available
          ? [{ icon: 'download-outline' as const, tone: c.secondary, title: 'PC 앱으로 설치', subtitle: '설치 파일 없이 브라우저가 설치', onPress: () => void onInstall() }]
          : []),
      ],
    },
  ];

  return (
    <Screen scroll padded={false} inTab>
      <View className="flex-row items-center gap-3 border-b border-cd-border bg-cd-card px-4 py-4">
        <Avatar name={user?.name} size="lg" />
        <View className="flex-1">
          <Text className="text-[16px] font-semibold text-cd-text">{user?.name ?? '사용자'}</Text>
          <Text className="mt-0.5 text-[12px] text-cd-muted">
            {user?.email ?? ''}
            {user?.role ? ` · ${ROLE_LABEL[user.role] ?? user.role}` : ''}
          </Text>
        </View>
      </View>

      <View className="px-4 pb-6">
        {sections.map((s) => (
          <View key={s.label}>
            <Text className="pb-2 pt-5 text-[12px] font-medium text-cd-muted">{s.label}</Text>
            <View className="flex-row flex-wrap gap-2">
              {s.items.map((it) => (
                <MenuTile key={it.title} {...it} />
              ))}
            </View>
          </View>
        ))}
      </View>
      <Sheet visible={installGuide} onClose={() => setInstallGuide(false)} title="PC 앱으로 설치">
        <Text className="text-[14px] leading-[21px] text-cd-text">
          브라우저 주소창 오른쪽의 설치 아이콘(⊕ 또는 ‘앱 설치’)을 누르면 설치 파일 없이 바로 설치됩니다. Edge 는 오른쪽 위 ··· 메뉴 → 앱 → 이 사이트를
          앱으로 설치, Chrome 은 ⋮ 메뉴 → 전송, 저장 및 공유 → 앱 설치에서도 할 수 있습니다.
        </Text>
        <Text className="mt-2 text-[12px] text-cd-muted">설치된 앱 창에서는 이 항목이 보이지 않습니다. 트레이 상주·항상 위 고정이 필요하면 웹 홈의 데스크탑 위젯(exe)을 쓰세요.</Text>
      </Sheet>
    </Screen>
  );
}

/**
 * 2열 메뉴 타일 — KESI Frosted(2026-11-03): 카드 규격(흰 면 + card-border + 반경 10 + 1단 그림자) 안에
 * 개편 전과 같은 42px 그림자 스퀘클 + **기능별 색 아이콘**(`tone`) + 제목 14/500 + 부제 12 ink-muted(2026-11-04 사용자 결정 — 아이콘은 개편 전 디자인).
 */
function MenuTile({
  icon,
  tone,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const { c, dark } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // 2열: 부모 폭 - gap(8) 의 절반. 홀수 개 섹션도 반칸 유지(풀폭 아님).
      // 옛 타일과 같은 높이(아이콘 42 + 안쪽 14 = 70) — 11-04 "빡빡하다" 피드백으로 40/12 에서 되돌림.
      style={[{ width: '48.8%', borderColor: c.cardBorder, padding: 14 }, dark ? SHADOW_CARD.dark : SHADOW_CARD.light]}
      className="flex-row items-center gap-3 rounded-lg border bg-cd-card active:opacity-80">
      {/* 아이콘 스퀘클 — UI 개편 전 디자인 복원(42px · radius 15 · 카드 면 + 테두리 + 옅은 그림자, 기능별 색 아이콘) */}
      <View
        style={[{ width: 42, height: 42, borderRadius: 15, borderWidth: 1, borderColor: c.border, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, { shadowColor: '#3C4696', shadowOpacity: 0.12, elevation: 3 }]}
        className="items-center justify-center bg-cd-card">
        <Ionicons name={icon} size={19} color={tone} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-[14px] font-medium text-cd-text">
          {title}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[12px] text-cd-muted">
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
