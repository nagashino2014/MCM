/**
 * 메일 목록 날짜 표시(10-16 사용자 요청)
 * - 지금부터 24시간 이내: "오전 09:05" / "오후 03:12"
 * - 그 밖: "YY.MM.DD" (예: 26.10.14)
 */
export function fmtListDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const diff = now.getTime() - d.getTime();
  // 미래 시각(서버·발신자 시계 차이)도 24시간 안쪽이면 시각으로 보여 준다.
  if (Math.abs(diff) < 24 * 60 * 60 * 1000) {
    const h = d.getHours();
    return `${h < 12 ? "오전" : "오후"} ${p(h % 12 || 12)}:${p(d.getMinutes())}`;
  }
  return `${p(d.getFullYear() % 100)}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}
