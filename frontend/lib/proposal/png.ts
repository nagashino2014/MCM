import { inflateSync } from "node:zlib";
import { ProposalError, PROPOSAL_IMAGE_MAX_BYTES } from "./validate";

const SIGNATURE = "89504e470d0a1a0a";
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let n = value;
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const invalid = (reason: string): never => { throw new ProposalError(`PNG 그림을 읽지 못했습니다: ${reason}`, 422); };

/** 네이티브 디코더 이전 구조·CRC·압축 스트림 검증. 손상 PNG로 프로세스가 종료되는 것을 방지한다. */
export function validatePngBytes(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 45 || bytes.length > PROPOSAL_IMAGE_MAX_BYTES || bytes.subarray(0, 8).toString("hex") !== SIGNATURE) return invalid("파일 크기 또는 서명");
  let offset = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let seenHeader = false; let seenEnd = false; let hasPalette = false; let idatEnded = false;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return invalid("잘린 청크");
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return invalid("청크 길이");
    const type = bytes.toString("ascii", offset + 4, offset + 8); const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) return invalid("청크 검사값");
    if (!seenHeader && type !== "IHDR") return invalid("첫 머리글 누락");
    if (type === "IHDR") {
      if (seenHeader || length !== 13) return invalid("중복 또는 손상 머리글");
      seenHeader = true; width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9];
      if (!width || !height || width * height > 30_000_000) return invalid("허용 픽셀 수 초과");
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return invalid("지원하지 않는 색상 또는 인터레이스 형식. 앱에서 그림을 다시 넣어 주세요.");
    } else if (type === "PLTE") {
      if (hasPalette || compressed.length || length < 3 || length > 768 || length % 3) return invalid("팔레트");
      hasPalette = true;
    } else if (type === "IDAT") {
      if (idatEnded || (color === 3 && !hasPalette)) return invalid("그림 데이터 순서");
      compressed.push(data);
    } else if (type === "IEND") {
      if (length || !compressed.length || offset + 12 !== bytes.length) return invalid("끝 표시");
      seenEnd = true;
    } else {
      if (type[0] === type[0].toUpperCase()) return invalid("지원하지 않는 필수 청크");
      if (compressed.length) idatEnded = true;
    }
    offset += length + 12;
  }
  if (!seenEnd || !compressed.length) return invalid("그림 데이터 또는 끝 표시 누락");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  const rowBytes = Math.ceil(width * channels * depth / 8) + 1;
  const expected = rowBytes * height;
  if (expected > 128 * 1024 * 1024) return invalid("압축 해제 크기 초과");
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }); } catch { return invalid("손상된 압축 데이터"); }
  if (raw.length !== expected) return invalid("픽셀 데이터 길이");
  for (let y = 0; y < height; y++) if (raw[y * rowBytes] > 4) return invalid("잘못된 행 필터");
  return { width, height };
}
