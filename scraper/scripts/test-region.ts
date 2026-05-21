/**
 * extractRegion / SIGUNGU 사전 매칭 정상성 빠른 검증.
 * - DB 백필 전에 실제 신고/경계 케이스들을 단발성으로 확인하기 위한 단순 스크립트.
 * - 정식 단위테스트가 도입되면 제거 가능.
 */

import { extractRegion } from "../lib/ieps/region";

const cases: { input: string | null; expectSido: string | null; expectSigungu: string | null; note: string }[] = [
  // 신고 A — 도시환경(주) 연천군 (공백 압축된 실제 DB 값)
  { input: "경기도연천군양연로402번길244", expectSido: "경기도", expectSigungu: "연천군", note: "신고 A: 공백 없는 주소 + 연천군 직후 한글" },
  // 신고 B — 제주 5건 (공백 압축)
  { input: "제주특별자치도서귀포시대정읍일주서로3000번길137-19", expectSido: "제주특별자치도", expectSigungu: "서귀포시", note: "신고 B: 제주 서귀포시" },
  { input: "제주특별자치도제주시원당로133", expectSido: "제주특별자치도", expectSigungu: "제주시", note: "신고 B: 제주시 (단축 시명)" },
  { input: "제주특별자치시도제주시한림읍 한림중앙로159", expectSido: "제주특별자치도", expectSigungu: "제주시", note: "신고 B: 오타(자치시도)·공백 혼합" },
  // 애경산업 — 시도가 주소에 두 번 등장
  { input: "대전광역시 대덕구 대화로 32번길 174(대화동) (대전광역시 대덕구 대화동 63-1)", expectSido: "대전광역시", expectSigungu: "대덕구", note: "주소 끝에 시도 재등장하는 케이스" },
  // 애경케미칼 대전공장 — 공백 압축 + 시도 재등장
  { input: "대전광역시대덕구대화로32번길174(대화동) (대전광역시대덕구대화동63-1)", expectSido: "대전광역시", expectSigungu: "대덕구", note: "공백 압축 + 시도 재등장" },
  // 포항시 합성형 → primary "포항시"
  { input: "경상북도 포항시 남구 호동 호동로 25", expectSido: "경상북도", expectSigungu: "포항시", note: "포항시+남구 합성형 매칭 → 시 단위" },
  { input: "경상북도포항시남구호동호동로25", expectSido: "경상북도", expectSigungu: "포항시", note: "포항시 공백 압축" },
  // 수원 합성형
  { input: "경기도 수원시 장안구 정자로 88", expectSido: "경기도", expectSigungu: "수원시", note: "수원시+장안구 합성형" },
  { input: "경기도수원시장안구정자로88", expectSido: "경기도", expectSigungu: "수원시", note: "수원시 공백 압축" },
  // 강원특별자치도 + 시군구 사전(강원 키) 매칭
  { input: "강원특별자치도 춘천시 봉의로 1", expectSido: "강원특별자치도", expectSigungu: "춘천시", note: "강원특별자치도 → 강원 사전" },
  { input: "강원도 동해시 천곡로 1", expectSido: "강원도", expectSigungu: "동해시", note: "강원도 → 강원 사전" },
  // 청양군 (애경케미칼 청양2공장)
  { input: "충청남도 청양군 정산면 충의로 1547-95", expectSido: "충청남도", expectSigungu: "청양군", note: "공백 있는 정상 주소" },
  // null / 빈 값
  { input: null, expectSido: null, expectSigungu: null, note: "null 주소" },
  { input: "", expectSido: null, expectSigungu: null, note: "빈 문자열" },
  // 시도만 있고 시군구 매칭 실패 케이스
  { input: "세종특별자치시 한누리대로 1234", expectSido: "세종특별자치시", expectSigungu: null, note: "세종 — 시군구 사전 비어있음(정상)" },
  // 약식 시도 + 공백
  { input: "서울 강남구 테헤란로 1", expectSido: "서울특별시", expectSigungu: "강남구", note: "약식 시도 + 강남구" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = extractRegion(c.input);
  const okSido = got.sido === c.expectSido;
  const okSgg = got.sigungu === c.expectSigungu;
  const ok = okSido && okSgg;
  const status = ok ? "PASS" : "FAIL";
  if (ok) pass++; else fail++;
  const fmt = (v: string | null): string => (v === null ? "null" : `"${v}"`);
  console.log(
    `[${status}] (${c.note})\n` +
      `  in   : ${c.input === null ? "(null)" : `"${c.input}"`}\n` +
      `  got  : sido=${fmt(got.sido)}  sigungu=${fmt(got.sigungu)}\n` +
      `  want : sido=${fmt(c.expectSido)}  sigungu=${fmt(c.expectSigungu)}`
  );
}

console.log(`\n총 ${cases.length}건 — PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
