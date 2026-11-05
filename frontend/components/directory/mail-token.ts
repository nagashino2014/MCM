/** 메일 쓰기 딥링크용 수신자 토큰 — "이름 직함 <주소>, " 형태로 넘겨야 작성 화면에서 칩으로 잡힌다. */
export function mailToken(name: string, title: string | null | undefined, address: string): string {
  const label = [name, title].filter(Boolean).join(" ");
  return `${label} <${address}>, `;
}
