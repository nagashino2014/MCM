import type { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';

import type { CdPalette } from '@/theme/tokens';

/**
 * 홈 "빠른 실행" 타일 목록(2026-11-06 사용자 요청: 누구나 자기 홈의 타일을 넣고 뺄 수 있게).
 *
 * - 여기가 **고를 수 있는 기능의 단일 원천**이다. 서버(`/api/home/layout` 의 quickActions)는 고른 키의 순서만 보관한다.
 * - 기능을 추가하면 이 목록에 한 줄을 더한다. 키는 한 번 정하면 바꾸지 않는다(저장된 구성이 가리킨다).
 * - `nativeOnly` 는 카메라가 필요한 기능 — 데스크탑 위젯·PWA(웹)에서는 목록에도 타일에도 나오지 않는다.
 * - 권한이 없는 화면을 골라도 그 화면이 스스로 "권한 없음"을 보여준다(전체 메뉴와 같은 규칙).
 */
export type QuickTone = 'primary' | 'error' | 'success' | 'warning' | 'secondary' | 'purple' | 'primaryStrong' | 'muted';

export interface QuickAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: QuickTone;
  /** expo-router 경로. */
  route: string;
  nativeOnly?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { key: 'card', label: '명함', icon: 'camera-outline', tone: 'primary', route: '/card', nativeOnly: true },
  { key: 'receipt', label: '영수증', icon: 'receipt-outline', tone: 'error', route: '/receipt-menu', nativeOnly: true },
  { key: 'leave', label: '휴가', icon: 'paper-plane-outline', tone: 'success', route: '/leave' },
  { key: 'schedule', label: '일정', icon: 'calendar-outline', tone: 'warning', route: '/schedule' },
  { key: 'facilities', label: '사업장', icon: 'business-outline', tone: 'secondary', route: '/facilities' },
  { key: 'contacts', label: '담당자', icon: 'people-outline', tone: 'purple', route: '/contacts' },
  { key: 'todo', label: '할 일', icon: 'checkmark-done-outline', tone: 'primary', route: '/todo' },
  { key: 'sales', label: '영업 활동', icon: 'trending-up-outline', tone: 'success', route: '/sales' },
  { key: 'bids', label: '공공입찰', icon: 'briefcase-outline', tone: 'primaryStrong', route: '/bids' },
  { key: 'workReports', label: '업무보고', icon: 'clipboard-outline', tone: 'warning', route: '/work-reports' },
  { key: 'invoice', label: '발행 요청', icon: 'document-text-outline', tone: 'secondary', route: '/invoice-requests' },
  { key: 'attendance', label: '내 근태', icon: 'time-outline', tone: 'warning', route: '/attendance' },
  { key: 'board', label: '공지', icon: 'megaphone-outline', tone: 'primary', route: '/(tabs)/collab' },
  { key: 'surveys', label: '설문', icon: 'bar-chart-outline', tone: 'purple', route: '/surveys' },
  { key: 'manual', label: '매뉴얼', icon: 'book-outline', tone: 'primary', route: '/manual' },
  { key: 'settings', label: '설정', icon: 'settings-outline', tone: 'muted', route: '/settings' },
];

/** 기본 구성 — 편집하기 전의 타일(2026-11-04 까지의 고정 6개와 같다). */
export const DEFAULT_QUICK_KEYS = ['card', 'receipt', 'leave', 'schedule', 'facilities', 'contacts'];

/** 한 번에 둘 수 있는 타일 수. */
export const MAX_QUICK_TILES = 8;

/** 이 기기에서 쓸 수 있는 기능만(웹은 카메라 기능 제외). */
export function availableQuickActions(): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => !a.nativeOnly || Platform.OS !== 'web');
}

/** 저장된 키 목록(null = 기본) → 이 기기에서 그릴 타일. 모르는 키·쓸 수 없는 키는 건너뛴다. */
export function resolveQuickActions(saved: string[] | null | undefined): QuickAction[] {
  const usable = availableQuickActions();
  const keys = Array.isArray(saved) ? saved : DEFAULT_QUICK_KEYS;
  return keys
    .map((k) => usable.find((a) => a.key === k))
    .filter((a): a is QuickAction => !!a)
    .slice(0, MAX_QUICK_TILES);
}

/** 담당자 아이콘의 퍼플 — cd 토큰에 없는 색이라 웹 `--cd-av-2` 와 같은 값을 직접 쓴다. */
const AV_PURPLE = { light: '#7a6bb8', dark: '#b0a2e0' };

export function quickToneColor(tone: QuickTone, c: CdPalette, dark: boolean): string {
  if (tone === 'purple') return dark ? AV_PURPLE.dark : AV_PURPLE.light;
  return c[tone];
}
