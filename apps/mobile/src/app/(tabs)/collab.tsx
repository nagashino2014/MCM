import { Screen, EmptyState } from '@/components/ui';

// 소통 탭 — M4 에서 공지·게시판 + 주소록·조직도 세그먼트로 채운다.
export default function CollabScreen() {
  return (
    <Screen>
      <EmptyState
        icon="megaphone-outline"
        title="공지·주소록 준비 중"
        description={'다음 단계에서 전사 공지·부서 게시판과\n임직원 주소록·조직도가 열립니다.'}
      />
    </Screen>
  );
}
