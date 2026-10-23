import fontkit from "@pdf-lib/fontkit";
import {
  BODY_HANGUL_MIN,
  DOC_SYMBOLS,
  FONT_FILE_EXTS,
  MAX_FONT_FILE_BYTES,
  toRanges,
  type EmbedPolicy,
  type FontClass,
  type FontCoverage,
  type FontFamilyVerdict,
  type FontFileAnalysis,
  type FontMetrics,
  type FontOutline,
  type FontRole,
  type FontSizeAdjust,
} from "./font-types";

/*
 * 회사소개서 업로드 서체 분석(서버, 순수 함수) — 블루프린트 §5-3·5-4. @pdf-lib/fontkit 으로 파일을 읽어
 *   이름 테이블(패밀리·굵기·기울임) · 포함 허용(OS/2 fsType) · 글자 범위(한글 완성형 2,350자·문서 기호·숫자) · 글자 꼴 수치를 잰다.
 * 크기 보정 = 기준 서체(프리텐다드 Regular)와 한글 평균 폭(한글이 없으면 x높이)을 맞추는 size-adjust + 윗·아랫 높이를
 *   기준 서체와 같게 하는 ascent/descent-override(Chromium 은 override 를 size-adjust 를 곱한 크기에 적용한다 — 2026-10-23 실측).
 * 저장하지 않는다 — 등록(font-library.ts)은 변환한 파일(정적 TrueType WOFF)을 다시 재서 최종 값을 남긴다.
 */

/** fontkit 내부 구조 중 쓰는 부분(공개 타입에 없는 필드) */
interface FkFont {
  postscriptName: string | null;
  familyName: string | null;
  subfamilyName: string | null;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  xHeight: number;
  capHeight: number;
  italicAngle: number;
  characterSet: number[];
  availableFeatures: string[];
  directory?: { tables: Record<string, unknown> };
  name?: { records: Record<string, Record<string, string> | undefined> };
  variationAxes?: Record<string, { min: number; default: number; max: number }>;
  "OS/2"?: {
    usWeightClass?: number;
    fsType?: { noEmbedding?: boolean; viewOnly?: boolean; editable?: boolean; noSubsetting?: boolean; bitmapOnly?: boolean };
    fsSelection?: { italic?: boolean };
    panose?: number[];
    xHeight?: number;
    capHeight?: number;
  };
  head?: { macStyle?: { italic?: boolean } };
  hmtx?: { metrics: { length: number; get(i: number): { advance: number } } };
  hasGlyphForCodePoint(cp: number): boolean;
  glyphForCodePoint(cp: number): { id: number; advanceWidth: number };
  fonts?: unknown[];
}

/** 글자 폭 — hmtx 를 바로 읽는다. ⚠ fontkit 의 glyph.advanceWidth 는 vmtx 가 없으면 윤곽(cbox)까지 풀어서,
 *  WOFF 는 글자마다 glyf 표 전체를 다시 압축 해제한다(2,350자에 수 분 — 2026-10-23 실측) */
function advanceOf(font: FkFont, cp: number): number {
  const gid = font.glyphForCodePoint(cp).id;
  const m = font.hmtx?.metrics;
  if (!m || !m.length) return font.glyphForCodePoint(cp).advanceWidth;
  return m.get(Math.min(gid, m.length - 1)).advance;
}

let ksHangul: number[] | null = null;

/** KS X 1001 한글 완성형 2,350자(EUC-KR 0xB0A1–0xC8FE) */
export function ksx1001Hangul(): number[] {
  if (ksHangul) return ksHangul;
  const dec = new TextDecoder("euc-kr");
  const out: number[] = [];
  for (let hi = 0xb0; hi <= 0xc8; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const ch = dec.decode(new Uint8Array([hi, lo]));
      const cp = ch.codePointAt(0) ?? 0;
      if (ch.length === 1 && cp >= 0xac00 && cp <= 0xd7a3) out.push(cp);
    }
  }
  if (out.length !== 2350) throw new Error(`한글 완성형 목록을 만들지 못했습니다(${out.length}자) — 서버 Node 에 ICU 가 필요합니다.`);
  ksHangul = out;
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function nameOf(font: FkFont, key: string): { en: string | null; local: string | null } {
  const rec = font.name?.records?.[key];
  if (!rec) return { en: null, local: null };
  const en = rec.en ?? rec["en-US"] ?? Object.values(rec)[0] ?? null;
  const local = rec.ko ?? rec["ko-KR"] ?? null;
  return { en: en ? String(en).trim() : null, local: local ? String(local).trim() : null };
}

function formatOf(bytes: Uint8Array, fileName: string): FontFileAnalysis["format"] {
  const sig = String.fromCharCode(...bytes.subarray(0, 4));
  if (sig === "wOFF") return "woff";
  if (sig === "wOF2") return "woff2";
  if (sig === "OTTO") return "otf";
  if (sig === "\u0000\u0001\u0000\u0000" || sig === "true") return "ttf";
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return (FONT_FILE_EXTS as readonly string[]).includes(ext) ? (ext as FontFileAnalysis["format"]) : "unknown";
}

function outlineOf(font: FkFont): FontOutline | null {
  const t = font.directory?.tables ?? {};
  if ("glyf" in t) return "truetype";
  if ("CFF2" in t) return "cff2";
  if ("CFF " in t) return "cff";
  return null;
}

/** OS/2 fsType → 포함 허용 판정. 여러 비트가 함께 있으면 가장 너그러운 것을 따른다(OpenType 규격) */
function embedOf(font: FkFont): { embed: EmbedPolicy; noSubsetting: boolean; restrictedBit: boolean } {
  const fs = font["OS/2"]?.fsType ?? {};
  let embed: EmbedPolicy = "installable";
  if (fs.editable) embed = "editable";
  else if (fs.viewOnly) embed = "print";
  else if (fs.noEmbedding) embed = "restricted";
  if (fs.bitmapOnly) embed = "bitmap";
  return { embed, noSubsetting: Boolean(fs.noSubsetting), restrictedBit: Boolean(fs.noEmbedding) };
}

function classify(names: string, panose: number[] | undefined): FontClass {
  if (/\b(hand|brush|script)|handwrit|calligra|손글씨|붓글씨|캘리|nanum ?pen|nanum ?brush/i.test(names) || panose?.[0] === 3 || panose?.[0] === 4) return "decorative";
  if (/serif|myeong|myung|batang|mincho|명조|바탕/i.test(names) && !/sans/i.test(names)) return "serif";
  if (panose?.[0] === 2 && panose[1] >= 2 && panose[1] <= 10) return "serif";
  return "sans";
}

/** 굵기 값 정리 — 옛 1~9 표기는 ×100, 100 단위로 맞춘다 */
function normWeight(w: number | undefined): number {
  let v = Number(w) || 400;
  if (v < 10) v *= 100;
  return clamp(Math.round(v / 100) * 100, 100, 900);
}

function coverageOf(font: FkFont): FontCoverage {
  const ks = ksx1001Hangul();
  const missing: number[] = [];
  for (const cp of ks) if (!font.hasGlyphForCodePoint(cp)) missing.push(cp);
  const chars = font.characterSet ?? [];
  let hangulAll = 0;
  for (const cp of chars) if (cp >= 0xac00 && cp <= 0xd7a3) hangulAll++;
  const has = (s: string) => Array.from(s).every((c) => font.hasGlyphForCodePoint(c.codePointAt(0)!));
  const digits = has("0123456789");
  let tnum = (font.availableFeatures ?? []).includes("tnum");
  if (!tnum && digits) {
    const w = Array.from("0123456789").map((c) => advanceOf(font, c.codePointAt(0)!));
    tnum = w.every((x) => x === w[0]);
  }
  return {
    hangul2350: ks.length - missing.length,
    hangulMissing: String.fromCodePoint(...missing.slice(0, 400)),
    hangulAll,
    latin: has("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"),
    digits,
    symbolsMissing: Array.from(DOC_SYMBOLS)
      .filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0)!))
      .join(""),
    tnum,
    ranges: toRanges(chars),
  };
}

function metricsOf(font: FkFont): FontMetrics {
  const upm = font.unitsPerEm || 1000;
  const ks = ksx1001Hangul();
  let sum = 0;
  let n = 0;
  for (const cp of ks) {
    if (!font.hasGlyphForCodePoint(cp)) continue;
    const adv = advanceOf(font, cp);
    if (adv > 0) {
      sum += adv;
      n++;
    }
  }
  let dsum = 0;
  let dn = 0;
  for (const c of "0123456789") {
    const cp = c.codePointAt(0)!;
    if (!font.hasGlyphForCodePoint(cp)) continue;
    dsum += advanceOf(font, cp);
    dn++;
  }
  const os2 = font["OS/2"] ?? {};
  return {
    unitsPerEm: upm,
    ascent: round4(font.ascent / upm),
    descent: round4(Math.abs(font.descent) / upm),
    lineGap: round4((font.lineGap || 0) / upm),
    xHeight: round4((os2.xHeight || font.xHeight || 0) / upm),
    capHeight: round4((os2.capHeight || font.capHeight || 0) / upm),
    hangulAdvance: n ? round4(sum / n / upm) : null,
    digitAdvance: dn ? round4(dsum / dn / upm) : null,
  };
}

/** 크기 보정 — 한글이 반 이상 있으면 한글 평균 폭, 아니면 x높이를 기준 서체에 맞춘다(80–125%) */
export function computeSizeAdjust(m: FontMetrics, ref: FontMetrics, hangulCount: number): FontSizeAdjust {
  let sa = 100;
  let basis: FontSizeAdjust["basis"] = "none";
  if (hangulCount >= 1175 && m.hangulAdvance && ref.hangulAdvance) {
    sa = (ref.hangulAdvance / m.hangulAdvance) * 100;
    basis = "hangul";
  } else if (m.xHeight > 0 && ref.xHeight > 0) {
    sa = (ref.xHeight / m.xHeight) * 100;
    basis = "x-height";
  }
  sa = round1(clamp(sa, 80, 125));
  const k = sa / 100;
  return {
    sizeAdjust: sa,
    ascentOverride: round1((ref.ascent / k) * 100),
    descentOverride: round1((ref.descent / k) * 100),
    lineGapOverride: 0,
    basis,
  };
}

function open(bytes: Uint8Array): FkFont {
  const font = (fontkit as unknown as { create(b: Uint8Array): FkFont }).create(bytes);
  if (Array.isArray(font.fonts)) throw new Error("글꼴 모음(TTC)은 굵기별 파일로 풀어 올려 주세요.");
  return font;
}

/** 기준 서체(프리텐다드 Regular) 수치 */
export function referenceMetrics(bytes: Uint8Array): FontMetrics {
  return metricsOf(open(bytes));
}

const EMPTY_COVERAGE: FontCoverage = { hangul2350: 0, hangulMissing: "", hangulAll: 0, latin: false, digits: false, symbolsMissing: DOC_SYMBOLS, tnum: false, ranges: [] };
const EMPTY_METRICS: FontMetrics = { unitsPerEm: 1000, ascent: 0, descent: 0, lineGap: 0, xHeight: 0, capHeight: 0, hangulAdvance: null, digitAdvance: null };

/** 파일 하나 분석 — 읽지 못하거나 PDF 에 넣을 수 없으면 errors 에 사유를 담는다. size = 올린 파일 크기(너무 크면 읽지 않고 거부) */
export function analyzeFontFile(bytes: Uint8Array, fileName: string, size = bytes.length): FontFileAnalysis {
  const base: FontFileAnalysis = {
    fileName,
    bytes: size,
    format: formatOf(bytes, fileName),
    outline: null,
    family: fileName.replace(/\.[^.]+$/, ""),
    familyLocal: null,
    subfamily: "",
    postscriptName: "",
    weight: 400,
    italic: false,
    variable: null,
    instanceWeights: [],
    embed: "installable",
    noSubsetting: false,
    classification: "sans",
    licenseHint: null,
    licenseUrl: null,
    copyright: null,
    coverage: EMPTY_COVERAGE,
    metrics: EMPTY_METRICS,
    errors: [],
    warnings: [],
  };
  if (size > MAX_FONT_FILE_BYTES) {
    base.errors.push(`파일이 ${(size / 1024 / 1024).toFixed(1)}MB 로 상한(20MB)을 넘습니다.`);
    return base;
  }
  if (base.format === "unknown") {
    base.errors.push("TTF·OTF·WOFF·WOFF2 서체 파일만 올릴 수 있습니다.");
    return base;
  }
  let font: FkFont;
  try {
    font = open(bytes);
  } catch (e) {
    base.errors.push(e instanceof Error && /TTC/.test(e.message) ? e.message : "서체 파일을 읽지 못했습니다(깨졌거나 지원하지 않는 형식).");
    return base;
  }
  const out = base;
  out.outline = outlineOf(font);
  const fam = nameOf(font, "preferredFamily");
  const fam1 = nameOf(font, "fontFamily");
  out.family = fam.en || fam1.en || font.familyName || out.family;
  out.familyLocal = fam.local || fam1.local || null;
  out.subfamily = nameOf(font, "preferredSubfamily").en || font.subfamilyName || "";
  out.postscriptName = font.postscriptName ?? "";
  const os2 = font["OS/2"] ?? {};
  out.italic = Boolean(os2.fsSelection?.italic || font.head?.macStyle?.italic || (font.italicAngle && Math.abs(font.italicAngle) > 0.5));
  const axes = font.variationAxes ?? {};
  const wght = axes.wght;
  if (Object.keys(axes).length) {
    const min = wght ? Math.round(wght.min) : 400;
    const max = wght ? Math.round(wght.max) : 400;
    const def = wght ? Math.round(wght.default) : 400;
    out.variable = { min, max, default: def };
    const picks = [400, 600, 700].filter((w) => w >= min && w <= max);
    out.instanceWeights = picks.length ? picks : [clamp(400, min, max)];
    out.weight = normWeight(def);
    out.warnings.push(`가변 서체입니다 — 굵기 ${out.instanceWeights.join("·")} 로 고정한 파일을 만들어 씁니다(가변 서체는 PDF 에 윤곽 그림으로 들어가 글자 검색·복사가 불안정합니다).`);
  } else {
    out.weight = normWeight(os2.usWeightClass);
  }
  const { embed, noSubsetting, restrictedBit } = embedOf(font);
  out.embed = embed;
  out.noSubsetting = noSubsetting;
  if (embed === "restricted") out.errors.push("포함 제한(Restricted) 서체입니다 — 제작사가 문서(PDF)에 넣는 것을 막아 두어 등록할 수 없습니다.");
  if (embed === "bitmap") out.errors.push("비트맵만 포함할 수 있는 서체입니다 — PDF 에 윤곽을 넣을 수 없어 등록할 수 없습니다.");
  if (embed === "print") out.warnings.push("'미리보기·인쇄 전용' 서체입니다 — PDF 에 넣을 수는 있지만, 받은 사람이 그 글자를 고칠 수는 없습니다.");
  if (restrictedBit && embed !== "restricted") out.warnings.push("포함 제한 표시가 함께 있어 PDF 에 윤곽 그림(Type 3)으로 들어갈 수 있습니다.");
  if (noSubsetting) out.warnings.push("부분 포함 금지 서체입니다 — PDF 에 서체 전체가 들어가 파일이 커집니다.");
  if (!out.outline) out.errors.push("윤곽(glyf·CFF) 테이블이 없는 서체입니다(비트맵·색 서체는 쓸 수 없습니다).");
  else if (out.outline !== "truetype") out.warnings.push("CFF(PostScript) 윤곽 서체입니다 — PDF 부분 포함을 위해 TrueType 윤곽으로 바꿔 저장합니다(모양은 같습니다).");
  if (out.italic) out.warnings.push("기울임 꼴입니다 — 디자인 시스템은 기울임 굵기를 따로 쓰지 않습니다.");
  const names = [out.family, out.familyLocal, out.subfamily, out.postscriptName].filter(Boolean).join(" ");
  out.classification = classify(names, os2.panose);
  const lic = nameOf(font, "license").en;
  out.licenseHint = lic ? lic.slice(0, 160) : null;
  out.licenseUrl = nameOf(font, "licenseURL").en;
  out.copyright = nameOf(font, "copyright").en?.slice(0, 160) ?? null;
  out.coverage = coverageOf(font);
  out.metrics = metricsOf(font);
  if (!out.coverage.latin && !out.coverage.hangulAll) out.errors.push("한글·영문 글자가 없는 서체입니다(기호·아이콘 서체는 쓸 수 없습니다).");
  return out;
}

/** 여러 파일의 글자 범위 교집합(모든 굵기에 있는 글자만 있다고 본다 — 굵기마다 빠진 글자가 다르면 보수적으로) */
export function intersectCoverage(list: FontCoverage[]): FontCoverage {
  if (list.length <= 1) return list[0] ?? EMPTY_COVERAGE;
  const minBy = <T,>(pick: (c: FontCoverage) => T, cmp: (a: T, b: T) => boolean) => list.map(pick).reduce((a, b) => (cmp(a, b) ? a : b));
  const sets = list.map((c) => c.ranges);
  // 범위 교집합
  let acc = sets[0];
  for (const r of sets.slice(1)) {
    const out: Array<[number, number]> = [];
    let i = 0;
    let j = 0;
    while (i < acc.length && j < r.length) {
      const a = Math.max(acc[i][0], r[j][0]);
      const b = Math.min(acc[i][1], r[j][1]);
      if (a <= b) out.push([a, b]);
      if (acc[i][1] < r[j][1]) i++;
      else j++;
    }
    acc = out;
  }
  const missing = new Set<string>();
  const symbols = new Set<string>();
  for (const c of list) {
    for (const ch of Array.from(c.hangulMissing)) missing.add(ch);
    for (const ch of Array.from(c.symbolsMissing)) symbols.add(ch);
  }
  return {
    hangul2350: minBy((c) => c.hangul2350, (a, b) => a <= b),
    hangulMissing: Array.from(missing).sort().slice(0, 400).join(""),
    hangulAll: minBy((c) => c.hangulAll, (a, b) => a <= b),
    latin: list.every((c) => c.latin),
    digits: list.every((c) => c.digits),
    symbolsMissing: Array.from(DOC_SYMBOLS).filter((ch) => symbols.has(ch)).join(""),
    tnum: list.every((c) => c.tnum),
    ranges: acc,
  };
}

/** 패밀리 판정(§5-3 용도 판정) — 굵기 400 과 600·700 이 있고 한글 완성형 2,350자를 모두 가지면 본문 가능, 아니면 제목 전용 */
export function judgeFamily(
  files: Array<{ weight: number; italic: boolean; coverage: FontCoverage; metrics: FontMetrics; embed: EmbedPolicy }>,
  ref: FontMetrics,
  opts: { classification: FontClass }
): { bodyCapable: boolean; roles: FontRole[]; reasons: string[]; coverage: FontCoverage; sizeAdjust: FontSizeAdjust; embed: EmbedPolicy } {
  const upright = files.filter((f) => !f.italic);
  const weights = new Set(upright.map((f) => f.weight));
  const has = (lo: number, hi: number) => Array.from(weights).some((w) => w >= lo && w <= hi);
  const coverage = intersectCoverage(upright.length ? upright.map((f) => f.coverage) : files.map((f) => f.coverage));
  const reasons: string[] = [];
  // 보통 굵기는 400(Medium 500 만 있는 패밀리도 본문에 쓴다 — 예: KoPub World 바탕 Medium)
  if (!has(350, 500)) reasons.push("굵기 400(보통) 없음");
  if (!has(550, 750)) reasons.push("굵기 600·700(굵게) 없음");
  if (coverage.hangul2350 < BODY_HANGUL_MIN) reasons.push(`한글 완성형 ${2350 - coverage.hangul2350}자 없음`);
  if (opts.classification === "decorative") reasons.push("장식·손글씨체");
  const roles: FontRole[] = ["display"];
  const bodyCapable = reasons.length === 0;
  if (bodyCapable) roles.push("body");
  if (coverage.digits) roles.push("figure");
  // 보정값은 보통(400 에 가장 가까운) 굵기로 잰다
  const regular = [...(upright.length ? upright : files)].sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0];
  const sizeAdjust = regular ? computeSizeAdjust(regular.metrics, ref, regular.coverage.hangul2350) : computeSizeAdjust(EMPTY_METRICS, ref, 0);
  const order: EmbedPolicy[] = ["bitmap", "restricted", "print", "installable", "editable"];
  const embed = files.map((f) => f.embed).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? "installable";
  return { bodyCapable, roles, reasons, coverage, sizeAdjust, embed };
}

/** 업로드 묶음 → 패밀리별 판정. existing = 같은 이름의 등록된 업로드 서체(소문자 패밀리 → font_id) */
export function groupFamilies(analyses: FontFileAnalysis[], ref: FontMetrics, existing: Map<string, string>, classOverride?: FontClass | null): FontFamilyVerdict[] {
  const groups = new Map<string, number[]>();
  analyses.forEach((a, i) => {
    if (a.errors.length) return;
    const k = a.family.trim().toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const out: FontFamilyVerdict[] = [];
  for (const [key, idx] of groups) {
    const items = idx.map((i) => analyses[i]);
    const first = items[0];
    const classification = classOverride ?? first.classification;
    // 가변 서체는 고정할 굵기마다 한 파일로 본다(수치는 기본 굵기 값 — 등록 때 고정한 파일로 다시 잰다)
    const files = items.flatMap((a) =>
      a.variable ? a.instanceWeights.map((w) => ({ weight: w, italic: a.italic, coverage: a.coverage, metrics: a.metrics, embed: a.embed })) : [{ weight: a.weight, italic: a.italic, coverage: a.coverage, metrics: a.metrics, embed: a.embed }]
    );
    const warnings: string[] = [];
    const seen = new Map<string, string>();
    items.forEach((a) => {
      const ws = a.variable ? a.instanceWeights : [a.weight];
      for (const w of ws) {
        const k = `${w}-${a.italic ? "i" : "n"}`;
        if (seen.has(k)) warnings.push(`굵기 ${w}${a.italic ? " 기울임" : ""} 파일이 둘입니다(${seen.get(k)}, ${a.fileName}) — 나중 파일로 저장합니다.`);
        seen.set(k, a.fileName);
      }
    });
    const verdict = judgeFamily(files, ref, { classification });
    const weights = Array.from(new Set(files.filter((f) => !f.italic).map((f) => f.weight))).sort((a, b) => a - b);
    out.push({
      family: first.family,
      displayName: first.familyLocal || first.family,
      fileIndexes: idx,
      weights,
      bodyCapable: verdict.bodyCapable,
      roles: verdict.roles,
      reasons: verdict.reasons,
      classification,
      embed: verdict.embed,
      coverage: { ...verdict.coverage, ranges: [] },
      sizeAdjust: verdict.sizeAdjust,
      warnings,
      existingFontId: existing.get(key) ?? null,
    });
  }
  return out;
}
