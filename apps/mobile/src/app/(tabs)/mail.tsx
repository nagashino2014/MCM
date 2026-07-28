import { Screen, EmptyState } from '@/components/ui';

// 메일 탭 — M3 에서 폴더·목록·뷰어·답장으로 채운다.
export default function MailScreen() {
  return (
    <Screen>
      <EmptyState
        icon="mail-outline"
        title="메일함 준비 중"
        description={'다음 단계에서 받은편지함 조회와\n답장·첨부 확인이 열립니다.'}
      />
    </Screen>
  );
}
