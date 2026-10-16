/**
 * 메일 가져오기(I-2) — .mbox 범위 읽기 분리기.
 * 파일 전체를 메모리에 올리지 않고, byte offset 부터 다음 "From " 구분 줄까지를 한 통으로 읽는다.
 * 지메일 Takeout 은 본문의 "From " 줄을 ">From " 으로 이스케이프한다(mboxrd) → 한 단계 되돌린다.
 * 설계: docs/mail-import-blueprint.md §4.1·§4.2.
 */
import type { RangeSource } from "@/lib/mail/import/zip-reader";

const CHUNK = 4 * 1024 * 1024;
const FROM_LINE = Buffer.from("\nFrom ");

export class MboxFormatError extends Error {}

export interface MboxRead {
  /** 메일 원문(구분 줄 제외). 너무 커서 건너뛴 경우 null. */
  raw: Buffer | null;
  /** 다음 메일의 시작 offset(= 파일 크기면 끝). */
  next: number;
  /** 건너뛴 메일의 대략 크기(바이트). */
  tooLargeBytes?: number;
}

/** offset 에서 시작하는 메일 1통을 읽는다. offset 은 "From " 줄의 시작이어야 한다(파일 첫 줄 앞 공백은 허용). */
export async function readMboxMessage(src: RangeSource, offset: number, size: number, maxBytes: number): Promise<MboxRead | null> {
  if (offset >= size) return null;
  let buf = await src.read(offset, Math.min(CHUNK, size - offset));
  // 파일 맨 앞의 빈 줄·BOM 은 건너뛴다.
  let lead = 0;
  while (lead < buf.length && (buf[lead] === 0x0a || buf[lead] === 0x0d || buf[lead] === 0xef || buf[lead] === 0xbb || buf[lead] === 0xbf)) lead++;
  if (buf.subarray(lead, lead + 5).toString("latin1") !== "From ") {
    throw new MboxFormatError("mbox 형식이 아닙니다(메일 구분 줄 'From '을 찾지 못함).");
  }
  const firstLineEnd = buf.indexOf(0x0a, lead);
  if (firstLineEnd < 0) return { raw: null, next: size };
  const bodyStart = firstLineEnd + 1;

  let searchFrom = bodyStart - 1;
  let tooLarge = false;
  let skipped = 0;
  for (;;) {
    const idx = buf.indexOf(FROM_LINE, Math.max(searchFrom, 0));
    if (idx >= 0) {
      const end = offset + skipped + idx + 1; // 다음 "From " 줄 시작
      if (tooLarge) return { raw: null, next: end, tooLargeBytes: end - offset };
      return { raw: unescape(buf.subarray(bodyStart, idx)), next: end };
    }
    const readSoFar = offset + skipped + buf.length;
    if (readSoFar >= size) {
      if (tooLarge) return { raw: null, next: size, tooLargeBytes: size - offset };
      return { raw: unescape(buf.subarray(bodyStart)), next: size };
    }
    const more = await src.read(readSoFar, Math.min(CHUNK, size - readSoFar));
    if (!tooLarge && buf.length + more.length > maxBytes + CHUNK) tooLarge = true;
    if (tooLarge) {
      // 너무 큰 메일 — 내용은 버리고 경계만 찾는다(꼬리 6바이트는 경계가 걸칠 수 있어 남김).
      const keep = buf.subarray(Math.max(0, buf.length - 6));
      skipped += buf.length - keep.length;
      buf = Buffer.concat([keep, more]);
      searchFrom = 0;
    } else {
      searchFrom = buf.length - 6;
      buf = Buffer.concat([buf, more]);
    }
  }
}

/** mboxrd 이스케이프 되돌리기(">From " → "From ", ">>From " → ">From ") + 끝 빈 줄 정리. */
function unescape(b: Buffer): Buffer {
  const s = b.toString("latin1").replace(/^>(>*From )/gm, "$1").replace(/(\r?\n)+$/, "\r\n");
  return Buffer.from(s, "latin1");
}

/** RFC 2047 encoded-word 디코딩(라벨 이름용). */
function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (all, cs: string, enc: string, text: string) => {
    try {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return new TextDecoder(cs.toLowerCase()).decode(bytes);
    } catch {
      return all;
    }
  });
}

/** 지메일 Takeout 의 X-Gmail-Labels 헤더 → 라벨 목록(없으면 빈 배열). */
export function gmailLabels(raw: Buffer): string[] {
  const head = raw.subarray(0, Math.min(raw.length, 64 * 1024)).toString("latin1");
  const end = head.search(/\r?\n\r?\n/);
  const headers = (end >= 0 ? head.slice(0, end) : head).replace(/\r?\n[ \t]+/g, " ");
  const m = headers.match(/^X-Gmail-Labels:[ \t]*(.*)$/im);
  if (!m) return [];
  const value = decodeWords(Buffer.from(m[1], "latin1").toString("utf8"));
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
