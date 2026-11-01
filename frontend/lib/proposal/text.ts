// 글자 폭 근사·줄바꿈 — 도식(SVG)과 HWPX 표 높이 추정이 같이 쓴다(서버·클라이언트 공용, 의존성 없음).

/** 글자 폭 근사(맑은 고딕) — 한글 0.93em, 영문·숫자 0.56em, 공백 0.3em */
export function textWidth(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += ch === " " ? 0.3 : /[ᄀ-ᇿ㄰-㆏가-힣一-鿿　-〿＀-￯]/.test(ch) ? 0.93 : /[A-Z0-9]/.test(ch) ? 0.62 : 0.52;
  return w * fs;
}

/** 줄바꿈 — 띄어쓰기 단위로 끊고(keep-all), 한 낱말이 넘치면 글자 단위로 자른다. */
export function wrap(text: string, maxW: number, fs: number): string[] {
  const out: string[] = [];
  for (const para of (text || "").split("\n")) {
    let line = "";
    for (const word of para.split(/(?<=\s)/)) {
      if (textWidth(line + word, fs) <= maxW || !line) {
        if (textWidth(line + word, fs) <= maxW) { line += word; continue; }
        // 낱말 자체가 넘침 — 글자 단위
        for (const ch of word) { if (textWidth(line + ch, fs) > maxW && line) { out.push(line.trimEnd()); line = ""; } line += ch; }
        continue;
      }
      out.push(line.trimEnd()); line = word.trimStart();
      if (textWidth(line, fs) > maxW) { let cut = ""; for (const ch of line) { if (textWidth(cut + ch, fs) > maxW && cut) { out.push(cut); cut = ""; } cut += ch; } line = cut; }
    }
    out.push(line.trimEnd());
  }
  return out;
}

// ── 쪽 목록 이름 ─────────────────────────────────────────────────────────────
const HANGUL = 0xac00;
/** 받침 ㅂ → ㅁ(갑니다 → 감, 입니다 → 임) */
const bToM = (ch: string) => { const c = ch.charCodeAt(0) - HANGUL; return c >= 0 && c < 11172 && c % 28 === 17 ? String.fromCharCode(ch.charCodeAt(0) - 1) : null; };

/** 핵심 문장형 쪽 제목을 목록용 명사구로 — '…작업을 연결합니다' → '…작업 연결', '…합치지 않습니다' → '…합치지 않음' */
function nominal(title: string): string {
  const t = title.trim().replace(/[.。]$/, "");
  // 하다 동사: 연결합니다·수행했습니다·검토하겠습니다·수행해 왔습니다 → 어간(명사) + 앞 목적격 조사 생략
  const ha = /^(.*?)(\S+?)(?:합니다|했습니다|하겠습니다|해 왔습니다|해왔습니다)$/.exec(t);
  if (ha && ha[2].length >= 2) return `${ha[1].replace(/(\S+?)[을를]\s$/, "$1 ")}${ha[2]}`.trim();
  if (ha) return `${ha[1]}${ha[2]}함`.trim();
  if (/드립니다$/.test(t)) return t.replace(/드립니다$/, "드림");
  if (/듭니다$/.test(t)) return t.replace(/듭니다$/, "듦");
  if (/습니다$/.test(t)) return t.replace(/습니다$/, "음");
  const m = /^(.*)(\S)니다$/.exec(t);
  const last = m && bToM(m[2]);
  return m && last ? `${m[1]}${last}` : t;
}

/** 왼쪽 쪽 목록에 보일 짧은 이름(기본 25자 안) — 전문은 툴팁으로 */
export function outlineLabel(title: string, max = 25): string {
  let t = nominal(title).replace(/\s+/g, " ");
  if (t.length <= max) return t;
  // 목적어와 동사 사이의 부사(함께·미리…)를 빼면 '…를 확인' 이 '… 확인' 으로 줄어든다
  const lean = nominal(title.replace(/\s(함께|미리|모두|다시|바로|먼저|계속|반드시)(?=\s)/g, "")).replace(/\s+/g, " ");
  if (lean.length <= max) return lean;
  t = lean;
  // '앞 — 뒤' 처럼 부연이 붙은 제목은 앞부분만
  const head = t.split(/\s+[—–-]\s+|:\s+/)[0];
  if (head.length >= 6 && head.length <= max) return head;
  t = t.slice(0, max - 1);
  const cut = t.lastIndexOf(" ");
  return `${(cut >= max * 0.6 ? t.slice(0, cut) : t).replace(/[\s·,]+$/, "")}…`;
}
