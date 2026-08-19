import { Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme/useTheme';

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
                title: '영수증 촬영',
                subtitle: '개인카드 경비 증빙 스톡',
                onPress: () => router.push('/receipt'),
              },
              {
                icon: 'file-tray-full-outline' as const,
                tone: c.error,
                title: '영수증 보관함',
                subtitle: '찍어 둔 영수증 확인·수정',
                onPress: () => router.push('/receipts'),
              },
            ]
          : []),
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
        { icon: 'settings-outline', tone: c.muted, title: '설정', subtitle: '앱 잠금·알림·계정', onPress: () => router.push('/settings') },
      ],
    },
  ];

  return (
    <Screen scroll padded={false}>
      <View className="flex-row items-center gap-3 border-b border-cd-border bg-cd-card px-4 py-4">
        <Avatar name={user?.name} size="lg" />
        <View className="flex-1">
          <Text className="text-[17px] font-extrabold text-cd-text">{user?.name ?? '사용자'}</Text>
          <Text className="text-[12px] text-cd-faint">
            {user?.email ?? ''}
            {user?.role ? ` · ${ROLE_LABEL[user.role] ?? user.role}` : ''}
          </Text>
        </View>
      </View>

      <View className="px-[18px] pb-6">
        {sections.map((s) => (
          <View key={s.label}>
            <Text className="pb-2 pt-4 text-[11.5px] font-bold text-cd-muted">{s.label}</Text>
            <View className="flex-row flex-wrap gap-2">
              {s.items.map((it) => (
                <MenuTile key={it.title} {...it} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

/** 2열 메뉴 타일(핸드오프 4b) — 카드 + 42px 그림자 스퀘클 + 제목/부제. */
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
  return (
    <Pressable
      onPress={onPress}
      // 2열: 부모 폭 - gap(8) 의 절반. 홀수 개 섹션도 반칸 유지(핸드오프 — 풀폭 아님).
      style={{ width: '48.8%' }}
      className="flex-row items-center gap-2.5 rounded-card border border-cd-border bg-cd-card p-[13px] active:opacity-70">
      <View
        className="h-[42px] w-[42px] items-center justify-center rounded-[15px] border border-cd-border bg-cd-card"
        style={{
          shadowColor: '#3C4696',
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          elevation: 3,
        }}>
        <Ionicons name={icon} size={19} color={tone} />
      </View>
      <View className="flex-1">
        <Text numberOfLines={1} className="text-[13px] font-bold text-cd-text">
          {title}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-[10.5px] text-cd-faint">
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}
