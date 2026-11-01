// 쪽 원고 해시 — 새 문서를 만들 때 쪽마다 원고 지문을 남겨, 나중에 새 원고와 비교할 때
// "사용자가 고친 쪽"과 "원고가 바뀐 쪽"을 가른다(docs/proposal-ai-editing-plan.md E13). 서버·브라우저 공용, 동기.
import type { ProposalBlock, ProposalSection } from "./types";

/** 키 순서를 고정한 JSON — 저장 검증이 객체를 새로 만들어 키 순서가 바뀌어도 같은 값이 나온다. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// tsconfig 대상이 ES2020 미만이라 BigInt 리터럴(…n) 대신 생성자로 만든다.
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const MASK64 = BigInt("0xffffffffffffffff");

/** FNV-1a 64비트 → 16자 hex */
export function fnv64(text: string): string {
  let h = FNV_OFFSET;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) { h ^= BigInt(b); h = (h * FNV_PRIME) & MASK64; }
  return h.toString(16).padStart(16, "0");
}

/** 블록 내용 지문(id 제외) — AI 제안을 채택할 때 그사이 블록이 바뀌었는지 본다 */
export function blockHash(b: ProposalBlock): string {
  const { id: _id, ...rest } = b;
  return fnv64(stable(rest));
}

/** 쪽 내용 지문 — 쪽·블록 id 와 지문 자신은 뺀다(복제·저장에도 내용이 같으면 같은 값). */
export function sectionHash(s: ProposalSection): string {
  const { id: _id, pageId: _pageId, sourceHash: _hash, ...rest } = s;
  return fnv64(stable({ ...rest, blocks: s.blocks.map(({ id: _b, ...b }) => b) }));
}
