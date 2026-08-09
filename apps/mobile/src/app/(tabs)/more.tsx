import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Avatar, ListRow, Screen, SectionTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

const ROLE_LABEL: Record<string, string> = {
  admin: '관리자',
  editor: '편집',
  viewer: '조회',
};

// 더보기 — 탭에 없는 기능의 진입점. 영업 화면(일정·사업장·담당자)은 여기로 내려왔다(§5.2).
export default function MoreScreen() {
  const router = useRouter();
  const { user } = useAuth();

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

      <SectionTitle>소통</SectionTitle>
      <ListRow
        icon="megaphone-outline"
        title="공지·주소록"
        subtitle="사내 공지·주소록·조직도"
        onPress={() => router.push('/(tabs)/collab')}
      />

      <SectionTitle>영업</SectionTitle>
      <ListRow
        icon="trending-up-outline"
        title="영업 활동"
        subtitle="영업건·일정 등록, 경과 입력"
        onPress={() => router.push('/sales')}
      />
      <ListRow
        icon="calendar-outline"
        title="일정"
        subtitle="출장·교육·휴가·영업 캘린더"
        onPress={() => router.push('/schedule')}
      />
      <ListRow
        icon="business-outline"
        title="사업장"
        subtitle="검색·요약 조회"
        onPress={() => router.push('/facilities')}
      />
      <ListRow
        icon="people-outline"
        title="담당자"
        subtitle="연락처·전화·문자"
        onPress={() => router.push('/contacts')}
      />
      <ListRow
        icon="briefcase-outline"
        title="공공입찰"
        subtitle="사업분야 매칭 공고·마감 임박"
        onPress={() => router.push('/bids')}
      />
      <ListRow
        icon="camera-outline"
        title="명함 촬영"
        subtitle="촬영 → AI 인식 → 담당자 등록"
        onPress={() => router.push('/card')}
      />

      <SectionTitle>근무</SectionTitle>
      <ListRow
        icon="calendar-outline"
        title="근태·휴가"
        subtitle="연차 잔여·주 초과근무·신청"
        onPress={() => router.push('/leave')}
      />
      <ListRow
        icon="time-outline"
        title="내 근태"
        subtitle="주별 근무시간·초과근무"
        onPress={() => router.push('/attendance')}
      />

      <SectionTitle>기타</SectionTitle>
      <ListRow
        icon="settings-outline"
        title="설정"
        subtitle="앱 잠금·알림·계정"
        onPress={() => router.push('/settings')}
      />
    </Screen>
  );
}
