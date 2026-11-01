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
