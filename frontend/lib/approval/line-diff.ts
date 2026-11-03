// 줄 단위 비교(LCS) — 계약서 버전 비교(336)에서 조문 본문 차이를 표시한다. 순수 함수(클라이언트·서버 공용).

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** a(이전) → b(이후) 줄 비교. 조문 본문은 수십 줄 규모라 O(n·m) 표로 충분하다. */
export function diffLines(a: string, b: string): DiffLine[] {
  // 빈 본문(추가·삭제된 조문의 반대편)은 줄 0개 — 빈 줄 하나로 세면 '−'/'+' 빈 줄이 생긴다
  const x = a === "" ? [] : a.split("\n");
  const y = b === "" ? [] : b.split("\n");
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: x[i++] });
    } else {
      out.push({ kind: "add", text: y[j++] });
    }
  }
  while (i < n) out.push({ kind: "del", text: x[i++] });
  while (j < m) out.push({ kind: "add", text: y[j++] });
  return out;
}
