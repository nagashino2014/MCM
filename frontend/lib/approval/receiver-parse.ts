/**
 * 접견인 자유 입력 파서 — 미계약 업체(직접 입력)일 때 `성명 직함, 성명 직함` 한 줄을 사람 목록으로 바꾼다.
 * (2026-11-11 사용자 요청: 계약 전 업체는 담당자 마스터에 사람이 없어 상신이 막혔다)
 *
 * 관대하게 읽는다:
 *  - 구분: 쉼표(, ，、)·세미콜론·슬래시·줄바꿈
 *  - `홍길동 부장` / `홍길동부장` / `홍길동(부장)` / `부장 홍길동` / `홍길동 부장님`
 *  - 직함이 없으면 성명만
 * 틀리게 읽을 수 있으므로 화면은 인식 결과를 그대로 미리 보여 준다(자동 단정 금지).
 *
 * ⚠ apps/mobile/src/lib/approval/receiver-parse.ts 와 같은 내용이다 — 한쪽을 고치면 다른 쪽도 고친다.
 */

export interface ParsedReceiver {
  name: string;
  title: string;
}

/** 붙여 쓴 직함을 떼어 낼 때 쓰는 목록 — 긴 것부터 대조한다. */
const TITLES = [
  "대표이사", "부대표", "대표", "회장", "부회장", "사장", "부사장", "전무이사", "상무이사", "전무", "상무", "이사",
  "본부장", "부본부장", "사업부장", "센터장", "공장장", "지사장", "지점장", "소장", "부소장", "원장", "부원장", "국장", "실장", "팀장", "파트장", "그룹장",
  "부장", "차장", "과장", "계장", "대리", "주임", "사원", "기사", "반장",
  "수석연구원", "책임연구원", "선임연구원", "주임연구원", "연구원", "연구소장", "수석", "책임", "선임", "매니저", "프로",
  "주무관", "사무관", "서기관", "주사", "주사보", "서기", "교수", "박사", "변호사", "기술사", "감독관", "감독", "담당",
].sort((a, b) => b.length - a.length);

const TITLE_SET = new Set(TITLES);

/** 직함 끝의 높임말 — `부장님` → `부장` */
function stripHonorific(s: string): string {
  return s.replace(/\s*님$/u, "").trim();
}

function splitAttachedTitle(token: string): ParsedReceiver | null {
  for (const t of TITLES) {
    if (token.length > t.length && token.endsWith(t)) {
      return { name: token.slice(0, token.length - t.length), title: t };
    }
  }
  return null;
}

/** 조각 하나(`홍길동 부장`)를 성명·직함으로 나눈다. 비면 null. */
export function parseReceiverPiece(piece: string): ParsedReceiver | null {
  let s = piece.replace(/　/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  // `홍길동(부장)` · `홍길동 (환경팀 부장)`
  const paren = s.match(/^(.+?)\s*[(（[]\s*(.+?)\s*[)）\]]$/u);
  if (paren) {
    const name = stripHonorific(paren[1]);
    const title = stripHonorific(paren[2]);
    if (name) return { name, title };
  }

  s = stripHonorific(s);
  if (!s) return null;

  const parts = s.split(" ");
  if (parts.length === 1) {
    return splitAttachedTitle(parts[0]) ?? { name: parts[0], title: "" };
  }

  // `부장 홍길동` — 앞 토큰이 직함이고 뒤가 직함이 아니면 뒤집는다
  const last = parts[parts.length - 1];
  if (TITLE_SET.has(parts[0]) && !TITLE_SET.has(last) && parts.length === 2) {
    return { name: last, title: parts[0] };
  }
  // `홍길동 환경팀 부장` — 첫 토큰이 성명, 나머지가 직함(부서 포함)
  return { name: parts[0], title: stripHonorific(parts.slice(1).join(" ")) };
}

/** 한 줄 전체를 사람 목록으로. 같은 성명·직함은 한 번만 담는다. */
export function parseReceivers(text: string): ParsedReceiver[] {
  const out: ParsedReceiver[] = [];
  const seen = new Set<string>();
  for (const piece of String(text ?? "").split(/[,，、;；/\n\r]+/u)) {
    const p = parseReceiverPiece(piece);
    if (!p || !p.name) continue;
    const key = `${p.name}|${p.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** 사람 목록 → 입력란 문자열(편집을 다시 열 때) */
export function formatReceivers(people: { name?: string | null; title?: string | null }[]): string {
  return people
    .filter((p) => p && p.name)
    .map((p) => `${p.name}${p.title ? ` ${p.title}` : ""}`)
    .join(", ");
}
