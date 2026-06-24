/**
 * 추진 내역 "구조화 노트" 직렬화 포맷 (에디터 ↔ 저장 텍스트 ↔ 미래 AI 요약 공용, 순수 함수).
 *
 * 저장은 progress_text/plan_text(텍스트 컬럼)에 마커가 들어간 평문으로 한다:
 *  - 소제목:  `[텍스트]` 또는 `<텍스트>`  (대괄호/홑화살괄호로 감싼 행)
 *  - 글머리:  `① 텍스트` / `● 텍스트` / `- 텍스트`  (행 머리에 마커 + 공백)
 *  - 본문:    마커 없는 일반 행
 *
 * 이 마커는 사람이 읽어도 정규화된 형태이고, 기계(AI 요약 등)가 소제목 섹션 단위로
 * 글머리 항목을 묶어 분류/요약하기에도 안정적이다(groupNoteForSummary).
 */

export type NoteBullet = "none" | "num" | "dot" | "dash" | "misc";

/** 부연 기호(글머리와 별개: 들여쓰기+걸어쓰기 적용, 줄바꿈 시 다음 줄로 전파 안 함, 행간 +30%). */
export const MISC_SYMBOLS = ["※", "→"] as const;

/** 기타 인라인 기호 — 문장 사이에 삽입(레이아웃/전파/행간 없음, 단순 문자 입력). */
export const INLINE_SYMBOLS = ["₩", "℃", "㎡", "㎥", "·", "㈜"] as const;

export interface NoteLine {
  bullet: NoteBullet;
  sub: boolean; // 소제목 여부(괄호로 감싼 행)
  text: string; // 마커 제거된 본문(소제목의 경우 괄호는 text 에 포함)
  mark?: string; // misc 기호 문자(기타 기호 행만)
}

const CIRCLED_START = 0x2460; // ① .. ⑳ (1..20)

export function circledNumber(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCharCode(CIRCLED_START + (n - 1));
  return `${n}.`;
}

function isCircled(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= CIRCLED_START && code <= CIRCLED_START + 19;
}

const SUBHEADING_RE = /^\s*[[<].*[\]>]\s*$/;

/** 저장 평문 → 행 구조 배열. */
export function parseNote(raw: string): NoteLine[] {
  if (!raw) return [];
  return raw.split("\n").map((line) => {
    let bullet: NoteBullet = "none";
    let text = line;
    let mark: string | undefined;
    const head = line.trimStart();
    const first = head.charAt(0);
    if (first === "•" || first === "●") {
      bullet = "dot";
      text = head.slice(1).replace(/^\s/, "");
    } else if (first === "-" && /^-\s/.test(head)) {
      bullet = "dash";
      text = head.slice(1).replace(/^\s/, "");
    } else if (isCircled(first)) {
      bullet = "num";
      text = head.slice(first.length).replace(/^\s/, "");
    } else if ((MISC_SYMBOLS as readonly string[]).includes(first)) {
      bullet = "misc";
      mark = first;
      text = head.slice(first.length).replace(/^\s/, "");
    }
    const sub = bullet === "none" && SUBHEADING_RE.test(text);
    return { bullet, sub, text, mark };
  });
}

/** 행 구조 배열 → 저장 평문(num 글머리는 소제목 섹션별로 ①②③ 리셋·재번호). */
export function serializeNote(lines: NoteLine[]): string {
  let n = 0;
  return lines
    .map((ln) => {
      if (ln.sub) n = 0; // 새 소제목 → 번호 리셋
      if (ln.bullet === "num") {
        n += 1;
        return `${circledNumber(n)} ${ln.text}`;
      }
      if (ln.bullet === "dot") return `• ${ln.text}`;
      if (ln.bullet === "dash") return `- ${ln.text}`;
      if (ln.bullet === "misc" && ln.mark) return `${ln.mark} ${ln.text}`;
      return ln.text;
    })
    .join("\n");
}

/** 소제목(섹션) 단위로 글머리/본문 항목을 묶는다 — 미래 AI 요약·분류용. */
export function groupNoteForSummary(
  lines: NoteLine[]
): { heading: string | null; items: { bullet: NoteBullet; text: string }[] }[] {
  const groups: { heading: string | null; items: { bullet: NoteBullet; text: string }[] }[] = [];
  let cur: { heading: string | null; items: { bullet: NoteBullet; text: string }[] } = { heading: null, items: [] };
  for (const ln of lines) {
    if (ln.sub) {
      if (cur.heading !== null || cur.items.length) groups.push(cur);
      cur = { heading: ln.text.replace(/^\s*[[<]/, "").replace(/[\]>]\s*$/, "").trim(), items: [] };
    } else if (ln.text.trim()) {
      cur.items.push({ bullet: ln.bullet, text: ln.text });
    }
  }
  if (cur.heading !== null || cur.items.length) groups.push(cur);
  return groups;
}
