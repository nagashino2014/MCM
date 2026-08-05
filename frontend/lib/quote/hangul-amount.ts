// 한글 금액 표기 유틸 — 견적서 "一金 이억삼천만 원정" 관행 재현 (클라/서버 공용, 의존성 없음)

const DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL_UNITS = ["", "십", "백", "천"];
const BIG_UNITS = ["", "만", "억", "조"];

/**
 * 숫자 → 한글 금액(관행 표기: 1억2천 → "일억이천만", 선행 "일"은 십/백/천 앞에서 생략).
 * 실물 견적서 표기("이억", "구백이십만", "이십일억오천만")를 따른다.
 */
export function toHangulAmount(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return "영";
  const groups: number[] = [];
  let rest = v;
  while (rest > 0) {
    groups.push(rest % 10000);
    rest = Math.floor(rest / 10000);
  }
  const parts: string[] = [];
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    if (!g) continue;
    let s = "";
    const ds = [Math.floor(g / 1000), Math.floor((g % 1000) / 100), Math.floor((g % 100) / 10), g % 10];
    for (let i = 0; i < 4; i++) {
      const d = ds[i];
      if (!d) continue;
      const unit = SMALL_UNITS[3 - i];
      // 관행: 십/백/천 앞의 '일' 생략 (일천→천). 만 단위 그룹 선두도 동일(일만→만 은 예외적으로 '일'을 붙이는
      // 관행도 있으나 실물 견적서("이십일억")는 생략형이므로 생략형 채택.
      s += (d === 1 && unit ? "" : DIGITS[d]) + unit;
    }
    parts.push(s + BIG_UNITS[gi]);
  }
  return parts.join("");
}

/** 견적금액 행 표기: "一金 이억 원정 (₩200,000,000)" 조합용 */
export function hangulAmountLine(n: number): { hangul: string; formatted: string } {
  return { hangul: toHangulAmount(n), formatted: `₩${Math.floor(n).toLocaleString("ko-KR")}` };
}
