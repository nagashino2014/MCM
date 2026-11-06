import type { Ionicons } from '@expo/vector-icons';

/**
 * 대화방 문서 공유 카드(2026-11-06) — 입력창의 [문서 공유]로 보내는 사내 기록.
 * 서버(lib/chat/queries.ts buildUserSharedRecord)가 받는 종류와 같다. 앱에 상세 화면이 있는 것만 넣는다
 * (계약은 앱에 화면이 없어 제외). 브리핑 카드(intel_briefing)는 영업 브리핑 공유가 따로 만든다.
 */
export type ChatShareType = 'approval_doc' | 'todo' | 'facility';

export interface ChatShare {
  type: ChatShareType;
  id: string;
  title: string;
}

export const CHAT_SHARE_TYPES: ChatShareType[] = ['approval_doc', 'todo', 'facility'];

export const CHAT_SHARE_LABELS: Record<ChatShareType, string> = {
  approval_doc: '결재 문서',
  todo: '할 일',
  facility: '사업장',
};

export const CHAT_SHARE_ICONS: Record<ChatShareType, keyof typeof Ionicons.glyphMap> = {
  approval_doc: 'checkmark-done-outline',
  todo: 'checkbox-outline',
  facility: 'business-outline',
};

export function isChatShareType(v: string): v is ChatShareType {
  return (CHAT_SHARE_TYPES as string[]).includes(v);
}

/** 글 없이 카드만 보낼 때의 본문 — 방 목록 미리보기·알림, 그리고 카드를 모르는 옛 앱에는 이 글이 보인다. */
export function shareFallbackBody(share: { type: ChatShareType; title: string }): string {
  return `[${CHAT_SHARE_LABELS[share.type]}] ${share.title}`;
}
