// 공문 + 첨부서류 결합(2026-11-03 사용자 요청) — 문서함 공문 뷰어의 이어 보기·결합 다운로드.
// 첨부 출처: 시스템 공문 = 결재 문서 field_values.file_attachments(발송 메일 동봉 순서),
//           과거 이관 공문 = official_letters.attach_keys(이관 등록 시 올린 첨부).
// PDF 결합: pdf 는 그대로, 이미지는 A4 한 쪽에 맞춰 넣고, 오피스·한글은 converter 변환본(S3 캐시 공유)을 쓴다.
// 한글 결합: 공문 원본이 HWPX 이고 첨부가 모두 HWPX 일 때만 — 스캔본(PDF·이미지)·워드 등이 하나라도 있으면 끈다.

import { PDFDocument } from "pdf-lib";
import { getDoc } from "@/lib/approval/docs";
import { attachmentExt, attachmentPreviewKind } from "@/lib/approval/attachments";
import { convertToPdf, previewKey } from "@/lib/approval/attachment-preview";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";
import { generateLetterArtifacts } from "./generate";
import { mergeHwpx } from "./hwpx-merge";
import type { LetterFieldValues, OfficialLetterRow } from "./types";

export interface LetterAttachmentItem {
  index: number;
  name: string;
  key: string;
  size: number;
}

/** 뷰어 목록 1행 — 결합 PDF 안의 시작 쪽(1부터)·쪽수. 미리보기를 못 만든 첨부는 pageCount 0 + error. */
export interface LetterBundlePart {
  kind: "letter" | "attachment";
  index: number;
  name: string;
  startPage: number;
  pageCount: number;
  error?: string;
}

export interface HwpCombineStatus {
  enabled: boolean;
  reason: string | null;
}

export const letterFileBase = (letter: OfficialLetterRow) => `(${letter.letterNo ?? "미채번"})${letter.title ?? "공문"}`;

export async function listLetterAttachments(letter: OfficialLetterRow): Promise<LetterAttachmentItem[]> {
  if (letter.source === "imported" || !letter.docId) {
    return letter.attachKeys.map((a, index) => ({ index, name: a.name, key: a.key, size: 0 }));
  }
  const doc = await getDoc(letter.docId);
  const files = ((doc?.fieldValues ?? {}) as unknown as LetterFieldValues).file_attachments ?? [];
  return files.map((f, index) => ({ index, name: f.name, key: f.key, size: f.size || 0 }));
}

/** 한글 결합 가능 여부 — 끈 경우 사유를 버튼 툴팁으로 보여 준다. */
export function hwpCombineStatus(letter: OfficialLetterRow, attachments: LetterAttachmentItem[]): HwpCombineStatus {
  if (!attachments.length) return { enabled: true, reason: null };
  if (!letter.hwpxKey && !(letter.source === "system" && letter.docId)) {
    return { enabled: false, reason: "공문 원본이 HWPX가 아닙니다(HWP 구 형식 또는 원본 없음). PDF 결합은 가능합니다." };
  }
  const others = attachments.filter((a) => attachmentExt(a.name) !== "hwpx");
  if (!others.length) return { enabled: true, reason: null };
  const names = others.slice(0, 3).map((a) => a.name).join(", ") + (others.length > 3 ? ` 외 ${others.length - 3}건` : "");
  return {
    enabled: false,
    reason: `한글(HWPX) 양식이 아닌 첨부가 있습니다(${names}). 스캔본·PDF·이미지·HWP(구 형식)는 한글로 합칠 수 없습니다. PDF 결합은 가능합니다.`,
  };
}

/** 공문 PDF — 보관본, 없으면 결재 문서로 즉석 렌더, 과거 이관(hwp/hwpx 원본만)은 변환본. */
async function letterPdf(letter: OfficialLetterRow): Promise<{ pdf: Uint8Array | null; error?: string }> {
  if (letter.pdfKey) {
    const bytes = await readContractDocument(letter.pdfKey);
    if (bytes) return { pdf: new Uint8Array(bytes) };
  }
  if (letter.docId) {
    const artifacts = await generateLetterArtifacts(letter.docId, { persist: false });
    return { pdf: artifacts.pdfBytes };
  }
  const sourceKey = letter.hwpxKey ?? letter.hwpKey;
  if (!sourceKey) return { pdf: null, error: "공문 PDF 원본이 없습니다." };
  const converted = await convertCached(sourceKey, `${letterFileBase(letter)}.${letter.hwpxKey ? "hwpx" : "hwp"}`);
  return converted.ok ? { pdf: converted.pdf } : { pdf: null, error: converted.error };
}

/** 첨부 미리보기 캐시(previewKey)는 결재 문서 뷰어와 같은 키를 쓴다. */
async function convertCached(key: string, name: string): Promise<{ ok: true; pdf: Uint8Array } | { ok: false; error: string }> {
  const cached = await readContractDocument(previewKey(key));
  if (cached) return { ok: true, pdf: new Uint8Array(cached) };
  const source = await readContractDocument(key);
  if (!source) return { ok: false, error: "원본을 읽을 수 없습니다." };
  const converted = await convertToPdf(source, name);
  if (!converted.ok) return { ok: false, error: converted.error };
  // 캐시 저장 실패는 무시 — 다음 조회에서 다시 변환하면 된다.
  await putContractDocument(previewKey(key), converted.pdf, "application/pdf").catch(() => {});
  return { ok: true, pdf: new Uint8Array(converted.pdf) };
}

/** 이미지 1장 → A4 세로 1쪽(여백 28pt 안에 비율 유지). pdf-lib 이 못 읽는 gif·webp 는 오류로 돌려 다운로드로 안내한다. */
async function imagePdf(bytes: Uint8Array, ext: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const img = ext === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const [W, H, M] = [595.28, 841.89, 28];
  const scale = Math.min((W - M * 2) / img.width, (H - M * 2) / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: H - M - h, width: w, height: h });
  return doc.save();
}

async function attachmentPdf(att: LetterAttachmentItem): Promise<{ pdf: Uint8Array | null; error?: string }> {
  const kind = attachmentPreviewKind(att.name);
  const ext = attachmentExt(att.name);
  if (kind === "convert") {
    const converted = await convertCached(att.key, att.name);
    return converted.ok ? { pdf: converted.pdf } : { pdf: null, error: converted.error };
  }
  const bytes = await readContractDocument(att.key);
  if (!bytes) return { pdf: null, error: "원본을 읽을 수 없습니다." };
  if (kind === "pdf") return { pdf: new Uint8Array(bytes) };
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return { pdf: await imagePdf(new Uint8Array(bytes), ext) };
  return { pdf: null, error: "이 형식은 미리보기를 만들 수 없습니다. 내려받아 확인하세요." };
}

/** 공문 뒤에 첨부를 순서대로 이어 붙인 PDF 와 목록(시작 쪽). 한 건이 실패해도 나머지는 이어 붙인다. */
export async function buildLetterBundlePdf(letter: OfficialLetterRow, attachments: LetterAttachmentItem[]): Promise<{ pdf: Uint8Array; parts: LetterBundlePart[] }> {
  const merged = await PDFDocument.create();
  const parts: LetterBundlePart[] = [];
  const append = async (part: Omit<LetterBundlePart, "startPage" | "pageCount">, src: { pdf: Uint8Array | null; error?: string }) => {
    const startPage = merged.getPageCount() + 1;
    if (!src.pdf) {
      parts.push({ ...part, startPage, pageCount: 0, error: src.error ?? "미리보기를 만들 수 없습니다." });
      return;
    }
    try {
      const doc = await PDFDocument.load(src.pdf, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      for (const p of pages) merged.addPage(p);
      parts.push({ ...part, startPage, pageCount: pages.length });
    } catch {
      parts.push({ ...part, startPage, pageCount: 0, error: "PDF를 읽을 수 없습니다(손상·암호). 내려받아 확인하세요." });
    }
  };

  await append({ kind: "letter", index: -1, name: letterFileBase(letter) }, await letterPdf(letter).catch((e) => ({ pdf: null, error: (e as Error).message })));
  for (const att of attachments) {
    await append({ kind: "attachment", index: att.index, name: att.name }, await attachmentPdf(att).catch((e) => ({ pdf: null, error: (e as Error).message })));
  }
  if (merged.getPageCount() === 0) throw new Error("공문과 첨부서류 모두 PDF로 열 수 없습니다.");
  return { pdf: await merged.save(), parts };
}

/** 공문 HWPX — 보관본, 없으면 결재 문서로 즉석 렌더. */
async function letterHwpx(letter: OfficialLetterRow): Promise<Uint8Array | null> {
  if (letter.hwpxKey) {
    const bytes = await readContractDocument(letter.hwpxKey);
    if (bytes) return new Uint8Array(bytes);
  }
  if (letter.docId) return (await generateLetterArtifacts(letter.docId, { persist: false })).hwpxBytes;
  return null;
}

/** 한글 결합 — hwpCombineStatus 가 켜진 경우에만 호출한다. */
export async function buildLetterBundleHwpx(letter: OfficialLetterRow, attachments: LetterAttachmentItem[]): Promise<Uint8Array> {
  const base = await letterHwpx(letter);
  if (!base) throw new Error("공문 HWPX 원본이 없습니다(템플릿 미배치 또는 이관 시 hwpx 미보관).");
  const parts: { label: string; bytes: Uint8Array }[] = [];
  for (const att of attachments) {
    const bytes = await readContractDocument(att.key);
    if (!bytes) throw new Error(`첨부 원본을 읽을 수 없습니다: ${att.name}`);
    parts.push({ label: att.name, bytes: new Uint8Array(bytes) });
  }
  return mergeHwpx(base, parts);
}
