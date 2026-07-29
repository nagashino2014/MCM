/**
 * 평문 → 최소 HTML 변환(서버 공용).
 *
 * 모바일 앱은 본문을 평문으로 보낸다(블루프린트 §9.1) — 메일·게시판 모두 이 함수로
 * 이스케이프 후 줄바꿈만 살려 저장한다. 앱이 보낸 문자열은 신뢰하지 않는다.
 */
export function escapeHtml(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function plainToHtml(plain: string): string {
  return `<div>${escapeHtml(plain).replace(/\r?\n/g, "<br />")}</div>`;
}
