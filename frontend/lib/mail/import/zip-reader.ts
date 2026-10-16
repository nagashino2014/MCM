/**
 * 메일 가져오기(I-1) — ZIP 범위 읽기 해제기.
 * ZIP 전체를 메모리에 올리지 않고, 끝의 중앙 디렉터리만 읽어 항목 목록을 얻은 뒤 항목을 하나씩 범위로 읽어 푼다.
 * 아마란스 메일함 백업 ZIP 은 data descriptor 를 써서 로컬 헤더에 크기가 없다 → 크기·오프셋은 중앙 디렉터리 기준.
 * Deflate(8)·무압축(0)만 지원. 암호화·ZIP64 는 명시적 오류. 설계: docs/mail-import-blueprint.md §4.2.
 */
import zlib from "node:zlib";

/** 범위 읽기 원본(S3 객체·로컬 파일 공용). */
export interface RangeSource {
  size(): Promise<number>;
  read(start: number, length: number): Promise<Buffer>;
}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipFormatError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 이름 디코딩 — UTF-8 플래그(bit 11)면 UTF-8, 아니면 UTF-8 시도 후 실패 시 EUC-KR(윈도우 탐색기 압축). */
function decodeName(buf: Buffer, flags: number): string {
  if (flags & 0x800) return buf.toString("utf8");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(buf);
    } catch {
      return buf.toString("latin1");
    }
  }
}

/** 중앙 디렉터리를 읽어 항목 목록을 돌려준다. */
export async function readZipDirectory(src: RangeSource): Promise<ZipEntry[]> {
  const size = await src.size();
  if (size < 22) throw new ZipFormatError("ZIP 파일이 아닙니다.");
  // EOCD 는 끝에서 22바이트 + 주석(최대 65535) 안에 있다.
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await src.read(size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("ZIP 파일이 아니거나 손상됐습니다.");
  const totalEntries = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipFormatError("ZIP64 형식은 아직 지원하지 않습니다. 메일함을 나눠 백업해 주세요.");
  }
  if (cdOffset + cdSize > size) throw new ZipFormatError("ZIP 중앙 디렉터리가 손상됐습니다.");
  const cd = await src.read(cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < totalEntries; n++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CEN_SIG) throw new ZipFormatError("ZIP 중앙 디렉터리가 손상됐습니다.");
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc32 = cd.readUInt32LE(p + 16);
    const compressedSize = cd.readUInt32LE(p + 20);
    const uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localHeaderOffset = cd.readUInt32LE(p + 42);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nameLen), flags);
    entries.push({ name, method, flags, crc32, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 항목 1개를 범위로 읽어 푼다. maxBytes 를 넘는 항목·비정상 압축률(압축 폭탄)은 오류.
 */
export async function readZipEntry(src: RangeSource, e: ZipEntry, maxBytes: number): Promise<Buffer> {
  if (e.flags & 0x1) throw new ZipFormatError("암호가 걸린 ZIP 항목입니다.");
  if (e.uncompressedSize > maxBytes) {
    throw new ZipFormatError(`크기 초과(${Math.round(e.uncompressedSize / 1048576)}MB)`);
  }
  if (e.compressedSize > 0 && e.uncompressedSize > 10 * 1048576 && e.uncompressedSize / e.compressedSize > 100) {
    throw new ZipFormatError("비정상 압축률");
  }
  const loc = await src.read(e.localHeaderOffset, 30);
  if (loc.readUInt32LE(0) !== LOC_SIG) throw new ZipFormatError("ZIP 항목 헤더가 손상됐습니다.");
  const dataStart = e.localHeaderOffset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
  const data = e.compressedSize ? await src.read(dataStart, e.compressedSize) : Buffer.alloc(0);
  let out: Buffer;
  if (e.method === 0) out = data;
  else if (e.method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(maxBytes, 1) });
  else throw new ZipFormatError(`지원하지 않는 압축 방식(${e.method})`);
  if (out.length !== e.uncompressedSize || crc32(out) !== e.crc32) throw new ZipFormatError("ZIP 항목이 손상됐습니다(CRC 불일치).");
  return out;
}
