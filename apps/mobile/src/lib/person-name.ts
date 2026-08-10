/**
 * 표시명에서 사람 이름만 뽑는다 — 아바타 이니셜용.
 *
 * 메일 발신자·수신자는 "㈜재영물산 이재연", "이재영 부장", "kaikan00@koensain.app" 처럼
 * 회사명·직급이 섞여 온다. 그대로 이니셜을 만들면 아바타 원 안에 회사명까지 들어가
 * 세 줄로 뭉개진다(2026-08-10 보낸편지함 실측).
 */

/** 직급·직책 토큰(사내 규정 + 외부 명함에서 흔한 것). 이름 판별에서 제외한다. */
const TITLES = new Set([
  '회장', '부회장', '사장', '부사장', '전무', '상무', '이사', '감사', '고문', '대표', '대표이사',
  '본부장', '실장', '센터장', '소장', '원장', '국장', '부장', '차장', '팀장', '파트장', '과장',
  '계장', '대리', '주임', '사원', '기사', '반장', '조장', '주무관', '담당', '매니저',
  '수석', '책임', '선임', '연구원', '책임연구원', '선임연구원', '수석연구원',
  '기자', '논설실장', '교수', '박사', '변호사', '회계사', '세무사', '노무사',
]);

/** 회사 표식 — 이 토큰만 남으면 사람 이름이 아니다. */
const ORG_MARKS = /^(주식회사|유한회사|재단법인|사단법인|㈜|\(주\)|\(유\)|co\.?|ltd\.?|inc\.?)$/i;

export function personName(display?: string | null): string {
  let s = (display ?? '').trim();
  if (!s) return '';
  // "이름 <주소>" 는 이름부만, 순수 주소는 로컬파트.
  const angled = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(s);
  if (angled) s = angled[1].trim();
  else if (s.includes('@') && !/\s/.test(s)) s = s.split('@')[0];

  // 회사 표식과 괄호 안 부가정보 제거: "재영물산(주) 이재영" → "재영물산 이재영"
  s = s.replace(/㈜|\(주\)|\(유\)|주식회사|유한회사/g, ' ').replace(/\([^)]*\)/g, ' ');

  const tokens = s
    .split(/[\s·,／/]+/)
    .map((t) => t.trim())
    .filter((t) => t && !ORG_MARKS.test(t) && !TITLES.has(t));
  if (!tokens.length) return s.trim();

  // 한글 이름은 2~4자. 회사명(대개 5자 이상)과 갈리는 가장 단순하고 안전한 기준이다.
  const korean = tokens.filter((t) => /^[가-힣]{2,4}$/.test(t));
  if (korean.length) return korean[korean.length - 1];
  return tokens[tokens.length - 1];
}
