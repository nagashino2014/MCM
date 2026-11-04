import { useWindowDimensions } from 'react-native';

import { IS_WEB_RAIL, WIDE_MIN_WIDTH } from './platform';

/**
 * 넓은 배치 여부(2026-11-04 설계안 §6-3) — 데스크탑 위젯·PWA(좌측 레일 환경)에서 창 폭이 WIDE_MIN_WIDTH 이상일 때만 참.
 * 참이면 대화(·메일·결재)는 왼쪽 목록 + 오른쪽 상세 2분할, 홈은 2열로 그린다. 네이티브·좁은 창은 항상 거짓(모바일 흐름 그대로).
 */
export function useWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return IS_WEB_RAIL && width >= WIDE_MIN_WIDTH;
}
