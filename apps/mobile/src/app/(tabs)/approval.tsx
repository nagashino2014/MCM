import { Screen, EmptyState } from '@/components/ui';

// 전자결재 탭 — M2 에서 결재함(대기/예정/내 기안)·상세·승인/반려로 채운다.
export default function ApprovalScreen() {
  return (
    <Screen>
      <EmptyState
        icon="checkbox-outline"
        title="결재함 준비 중"
        description={'다음 단계에서 결재 대기 문서 조회와\n승인·반려 처리가 열립니다.'}
      />
    </Screen>
  );
}
