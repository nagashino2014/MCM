/*
 * 회사소개서 이름 가리기(마스킹판) — 디자인 시스템 README §콘텐츠 원칙: 이름 가운데 글자를 ○ 로(이○억).
 * 클라이언트 안전(순수 함수).
 */

const HANGUL_NAME = /^[가-힣○]{2,5}$/;

/** 사람 이름 가리기 — 두 글자는 뒤 글자, 세 글자 이상은 첫·끝 글자를 남긴다. 이미 가린 이름·한글이 아닌 이름은 그대로. */
export function maskName(name: string): string {
  const n = name.trim();
  if (!HANGUL_NAME.test(n) || n.includes("○")) return n;
  if (n.length === 2) return n[0] + "○";
  return n[0] + "○".repeat(n.length - 2) + n[n.length - 1];
}

/** 자유 글(조직도 아래 줄 등)에서 알려진 사람 이름만 골라 가린다(일반 낱말은 건드리지 않는다). */
export function maskNamesIn(text: string, names: string[]): string {
  let out = text;
  const list = [...new Set(names.map((x) => x.trim()).filter((x) => HANGUL_NAME.test(x) && !x.includes("○")))].sort((a, b) => b.length - a.length);
  for (const n of list) out = out.split(n).join(maskName(n));
  return out;
}

/**
 * 마스킹판 마지막 단계 — 그린 본문 HTML 전체에서 실명을 한 번 더 가린다(쪽마다 다르지 않게 일괄, 블루프린트 §6-6).
 * 데이터 단계에서 이미 가렸어도 스튜디오에서 손으로 적은 글·조직도 아래 줄 같은 자유 글에 남은 이름을 잡는다.
 * 두 글자 이름은 일반 낱말(예: 이수·정진)과 겹치기 쉬워 여기서는 세 글자 이상만 — 두 글자 이름은 데이터 단계 가리기가 맡는다.
 */
export function maskNamesInHtml(html: string, names: string[]): string {
  const full = names.map((x) => x.trim()).filter((x) => x.length >= 3);
  if (!full.length) return html;
  // 태그 사이 글자와 속성 값(alt 등) 모두 — 태그 이름·속성 이름은 영문이라 한글 이름과 겹치지 않는다
  return maskNamesIn(html, full);
}

/** 사진 없는 변형의 이니셜(성) */
export function initialOf(name: string): string {
  return name.trim().slice(0, 1) || "·";
}
