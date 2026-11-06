/**
 * 대화방 멘션(@이름) — 입력 중 후보 질의와 본문 강조에 쓰는 순수 함수(2026-11-06).
 * 멘션은 본문의 `@이름` 글자 그대로다. 서버(lib/chat/queries.ts listMentionedMembers)도 같은 규칙으로 방 멤버 이름과 맞춰 알림 대상을 정한다.
 */

/** 입력 끝의 `@질의` — 후보 목록을 띄울 조건. 없으면 null. 질의는 빈 문자열일 수 있다(`@` 만 친 상태). */
export function mentionQueryAtEnd(text: string): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,20})$/.exec(text);
  if (!m) return null;
  return { start: m.index + m[1].length, query: m[2] };
}

/** 입력 끝의 `@질의` 를 `@이름 ` 으로 바꾼다. */
export function applyMention(text: string, start: number, name: string): string {
  return `${text.slice(0, start)}@${name} `;
}

export interface MentionSegment {
  text: string;
  mention: boolean;
}

/**
 * 본문을 멘션/일반 조각으로 나눈다. 방 멤버 이름과 일치하는 `@이름` 만 멘션이다(메일 주소 등은 일반 글).
 * 긴 이름부터 맞춘다("김철" 이 "@김철수" 에 걸리지 않게).
 */
export function splitMentions(body: string, names: string[]): MentionSegment[] {
  const sorted = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!sorted.length || !body.includes('@')) return [{ text: body, mention: false }];
  const out: MentionSegment[] = [];
  let plain = '';
  let i = 0;
  while (i < body.length) {
    const hit = body[i] === '@' ? sorted.find((n) => body.startsWith(n, i + 1)) : undefined;
    if (hit) {
      if (plain) out.push({ text: plain, mention: false });
      plain = '';
      out.push({ text: `@${hit}`, mention: true });
      i += hit.length + 1;
    } else {
      plain += body[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}
