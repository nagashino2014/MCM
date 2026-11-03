// HWPX 결합(2026-11-03) — 공문 HWPX 뒤에 첨부 HWPX 를 구역(section)으로 이어 붙여 한 파일로 만든다.
// 한글 문서의 문단·글자 모양은 header.xml 의 번호(id)로 참조되므로, 첨부 쪽 번호만 공문 번호 뒤로
// 옮겨 붙이고 첨부 본문(section)의 참조 속성을 같은 표로 바꾼다. 공문(기준 문서)의 XML 은 건드리지 않는다.
//  - 스타일은 이름이, 글꼴은 언어별 글꼴명이 같으면 공문 것을 그대로 쓴다(모양은 문단·글자 참조가 결정).
//  - 그림(BinData)·바탕쪽(masterpage)은 새 이름으로 복사한다. 이력·메모 모양은 복사하지 않는다.
// 바이너리 HWP(한글 97~2010)는 구조가 달라 결합 대상이 아니다 — 호출 측이 HWPX 만 넘긴다.

import JSZip from "jszip";

type CatKey = "borderFill" | "charPr" | "tabPr" | "numbering" | "bullet" | "paraPr" | "style";

/** refList 안 컨테이너 순서(OWPML) — 기준 문서에 없는 컨테이너를 끼울 자리를 정한다. */
const CONTAINER_ORDER = [
  "fontfaces",
  "borderFills",
  "charProperties",
  "tabProperties",
  "numberings",
  "bullets",
  "paraProperties",
  "styles",
  "memoProperties",
  "trackChanges",
  "trackChangeAuthors",
];

const CATS: { key: CatKey; container: string; item: string }[] = [
  { key: "borderFill", container: "borderFills", item: "borderFill" },
  { key: "charPr", container: "charProperties", item: "charPr" },
  { key: "tabPr", container: "tabProperties", item: "tabPr" },
  { key: "numbering", container: "numberings", item: "numbering" },
  { key: "bullet", container: "bullets", item: "bullet" },
  { key: "paraPr", container: "paraProperties", item: "paraPr" },
  { key: "style", container: "styles", item: "style" },
];

/** 참조 속성 → 대상 분류. 표에 없는 값(예: charPrIDRef="4294967295" = 참조 없음)은 그대로 둔다. */
const ATTR_CAT: Record<string, CatKey> = {
  charPrIDRef: "charPr",
  paraPrIDRef: "paraPr",
  styleIDRef: "style",
  nextStyleIDRef: "style",
  borderFillIDRef: "borderFill",
  tabPrIDRef: "tabPr",
  outlineShapeIDRef: "numbering",
};
const REF_ATTR_RE = /\b(charPrIDRef|paraPrIDRef|styleIDRef|nextStyleIDRef|borderFillIDRef|tabPrIDRef|outlineShapeIDRef)="(\d+)"/g;

/** hh:fontRef 속성 → hh:fontface lang */
const FONT_LANG: Record<string, string> = {
  hangul: "HANGUL",
  latin: "LATIN",
  hanja: "HANJA",
  japanese: "JAPANESE",
  other: "OTHER",
  symbol: "SYMBOL",
  user: "USER",
};

interface RefMaps {
  cat: Record<CatKey, Map<string, string>>;
  font: Map<string, Map<string, string>>; // lang → (old → new)
  bin: Map<string, string>; // BinData item id
  master: Map<string, string>; // masterpage item id
}

export class HwpxMergeError extends Error {}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `<hh:{tag} …/>` 또는 `<hh:{tag} …>…</hh:{tag}>` 전부. `\b` 로 charPr ↔ charProperties 를 구분한다. */
function itemsOf(xml: string, tag: string): string[] {
  const re = new RegExp(`<hh:${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</hh:${tag}>)`, "g");
  return xml.match(re) ?? [];
}

function attrOf(tagXml: string, name: string): string | null {
  const m = tagXml.match(new RegExp(`^<[^>]*?\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function setAttr(tagXml: string, name: string, value: string): string {
  return tagXml.replace(new RegExp(`^(<[^>]*?\\b${name}=")([^"]*)(")`), `$1${value}$3`);
}

/** 컨테이너 블록(여는 태그·안쪽) — 빈 컨테이너(`<hh:x itemCnt="0"/>`)도 찾는다. */
function containerOf(header: string, name: string): { full: string; inner: string } | null {
  const m = header.match(new RegExp(`<hh:${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</hh:${name}>)`));
  return m ? { full: m[0], inner: m[1] ?? "" } : null;
}

function maxId(items: string[]): number {
  let max = -1;
  for (const it of items) {
    const id = Number(attrOf(it, "id"));
    if (Number.isFinite(id) && id > max) max = id;
  }
  return max;
}

/** 첨부 XML 의 참조를 새 번호로 바꾼다(header 항목·section·masterpage 공통). */
function remapRefs(xml: string, maps: RefMaps): string {
  let out = xml.replace(REF_ATTR_RE, (m, attr: string, v: string) => {
    const nv = maps.cat[ATTR_CAT[attr]].get(v);
    return nv == null ? m : `${attr}="${nv}"`;
  });
  // 문단 머리 번호·글머리표 — type 에 따라 numbering/bullet 을 가리킨다(OUTLINE 은 구역의 outlineShapeIDRef 가 결정)
  out = out.replace(/<hh:heading\b[^>]*\/>/g, (tag) => {
    const type = attrOf(tag, "type");
    const cat: CatKey | null = type === "NUMBER" ? "numbering" : type === "BULLET" ? "bullet" : null;
    const v = attrOf(tag, "idRef");
    const nv = cat && v != null ? maps.cat[cat].get(v) : undefined;
    return nv == null ? tag : setAttr(tag, "idRef", nv);
  });
  out = out.replace(/<hh:fontRef\b[^>]*\/>/g, (tag) =>
    tag.replace(/\b(hangul|latin|hanja|japanese|other|symbol|user)="(\d+)"/g, (m, attr: string, v: string) => {
      const nv = maps.font.get(FONT_LANG[attr])?.get(v);
      return nv == null ? m : `${attr}="${nv}"`;
    })
  );
  out = out.replace(/\bbinaryItemIDRef="([^"]+)"/g, (m, v: string) => {
    const nv = maps.bin.get(v);
    return nv == null ? m : `binaryItemIDRef="${nv}"`;
  });
  out = out.replace(/<hp:masterPage\b[^>]*?\bidRef="([^"]+)"/g, (m, v: string) => {
    const nv = maps.master.get(v);
    return nv == null ? m : m.replace(`idRef="${v}"`, `idRef="${nv}"`);
  });
  return out;
}

/** 기준 header 의 컨테이너에 항목을 덧붙이고 itemCnt 를 맞춘다(없으면 순서에 맞는 자리에 새로 만든다). */
function appendToContainer(header: string, container: string, items: string[]): string {
  if (!items.length) return header;
  const found = containerOf(header, container);
  if (found) {
    const merged = found.inner + items.join("");
    const open = found.full.match(new RegExp(`^<hh:${container}\\b[^>]*?(?=/?>)`))![0];
    const count = String(itemsOf(`<x>${merged}</x>`, CATS.find((c) => c.container === container)!.item).length);
    const next = `${setAttr(open, "itemCnt", count)}>${merged}</hh:${container}>`;
    return header.replace(found.full, () => next);
  }
  const block = `<hh:${container} itemCnt="${items.length}">${items.join("")}</hh:${container}>`;
  const after = CONTAINER_ORDER.slice(CONTAINER_ORDER.indexOf(container) + 1);
  for (const name of after) {
    const idx = header.search(new RegExp(`<hh:${name}\\b`));
    if (idx >= 0) return header.slice(0, idx) + block + header.slice(idx);
  }
  return header.replace("</hh:refList>", () => `${block}</hh:refList>`);
}

/** 글꼴 — 언어별로 같은 글꼴명은 기준 번호로, 없으면 뒤에 덧붙인다. */
function mergeFonts(baseHeader: string, attHeader: string, maps: RefMaps): string {
  let header = baseHeader;
  const attFaces = attHeader.match(/<hh:fontface\b[^>]*>[\s\S]*?<\/hh:fontface>/g) ?? [];
  for (const attFace of attFaces) {
    const lang = attrOf(attFace, "lang");
    if (!lang) continue;
    const baseFace = header.match(new RegExp(`<hh:fontface\\b[^>]*?\\blang="${esc(lang)}"[^>]*>[\\s\\S]*?</hh:fontface>`))?.[0];
    if (!baseFace) continue; // 기준 문서에 없는 언어 — 참조를 그대로 둔다(한글이 기본 글꼴로 대체)
    const baseFonts = itemsOf(baseFace, "font");
    const byFace = new Map(baseFonts.map((f) => [attrOf(f, "face") ?? "", attrOf(f, "id") ?? ""]));
    let next = maxId(baseFonts) + 1;
    const added: string[] = [];
    const map = new Map<string, string>();
    for (const font of itemsOf(attFace, "font")) {
      const oldId = attrOf(font, "id");
      if (oldId == null) continue;
      const face = attrOf(font, "face") ?? "";
      const existing = byFace.get(face);
      if (existing) {
        map.set(oldId, existing);
        continue;
      }
      const newId = String(next++);
      map.set(oldId, newId);
      byFace.set(face, newId);
      added.push(setAttr(font, "id", newId));
    }
    maps.font.set(lang, map);
    if (added.length) {
      const inner = baseFace.replace(/^<hh:fontface\b[^>]*>/, "").replace(/<\/hh:fontface>$/, "");
      const open = baseFace.match(/^<hh:fontface\b[^>]*>/)![0];
      const nextFace = `${setAttr(open, "fontCnt", String(baseFonts.length + added.length))}${inner}${added.join("")}</hh:fontface>`;
      header = header.replace(baseFace, () => nextFace);
    }
  }
  return header;
}

function spineSections(hpf: string): string[] {
  const hrefById = new Map<string, string>();
  for (const item of hpf.match(/<opf:item\b[^>]*>/g) ?? []) {
    const id = attrOf(item, "id");
    const href = attrOf(item, "href");
    if (id && href) hrefById.set(id, href);
  }
  const out: string[] = [];
  for (const ref of hpf.match(/<opf:itemref\b[^>]*>/g) ?? []) {
    const href = hrefById.get(attrOf(ref, "idref") ?? "");
    if (href && /^Contents\/section\d+\.xml$/.test(href)) out.push(href);
  }
  return out;
}

function nextNumber(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function loadHwpx(bytes: Uint8Array, label: string): Promise<{ zip: JSZip; header: string; hpf: string }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new HwpxMergeError(`${label}: HWPX 파일을 열 수 없습니다.`);
  }
  const header = await zip.file("Contents/header.xml")?.async("string");
  const hpf = await zip.file("Contents/content.hpf")?.async("string");
  if (!header || !hpf) throw new HwpxMergeError(`${label}: HWPX 구조(header·content.hpf)가 없습니다.`);
  return { zip, header, hpf };
}

/**
 * 기준 HWPX(공문) 뒤에 첨부 HWPX 들을 순서대로 이어 붙인다. 첨부마다 구역이 새로 시작되므로 쪽이 바뀐다.
 * @param parts 첨부 HWPX(label 은 오류 메시지용 파일명)
 */
export async function mergeHwpx(base: Uint8Array, parts: { label: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const b = await loadHwpx(base, "공문");
  let header = b.header;
  let hpf = b.hpf;
  let sectionCount = spineSections(hpf).length;
  const manifestIds = () => (hpf.match(/<opf:item\b[^>]*>/g) ?? []).map((t) => attrOf(t, "id") ?? "");

  for (const part of parts) {
    const a = await loadHwpx(part.bytes, part.label);
    const maps: RefMaps = {
      cat: { borderFill: new Map(), charPr: new Map(), tabPr: new Map(), numbering: new Map(), bullet: new Map(), paraPr: new Map(), style: new Map() },
      font: new Map(),
      bin: new Map(),
      master: new Map(),
    };

    // 1) 번호 표 — 전 분류를 먼저 확정해야 항목 안의 교차 참조(charPr→borderFill 등)를 바꿀 수 있다
    const pending: { container: string; items: string[] }[] = [];
    for (const cat of CATS) {
      const baseItems = itemsOf(containerOf(header, cat.container)?.inner ?? "", cat.item);
      const attItems = itemsOf(containerOf(a.header, cat.container)?.inner ?? "", cat.item);
      const baseByName = cat.key === "style" ? new Map(baseItems.map((s) => [attrOf(s, "name") ?? "", attrOf(s, "id") ?? ""])) : null;
      let next = maxId(baseItems) + 1;
      const added: string[] = [];
      for (const it of attItems) {
        const oldId = attrOf(it, "id");
        if (oldId == null) continue;
        const sameName = baseByName?.get(attrOf(it, "name") ?? "");
        if (sameName) {
          maps.cat[cat.key].set(oldId, sameName);
          continue;
        }
        const newId = String(next++);
        maps.cat[cat.key].set(oldId, newId);
        added.push(setAttr(it, "id", newId));
      }
      pending.push({ container: cat.container, items: added });
    }
    header = mergeFonts(header, a.header, maps);

    // 2) 그림·바탕쪽 — 새 이름으로 복사
    const attManifest = a.hpf.match(/<opf:item\b[^>]*>/g) ?? [];
    let nextImage = nextNumber(manifestIds(), "image");
    let nextMaster = nextNumber(manifestIds(), "masterpage");
    const newItems: string[] = [];
    for (const item of attManifest) {
      const id = attrOf(item, "id");
      const href = attrOf(item, "href");
      if (!id || !href) continue;
      const isBin = href.startsWith("BinData/");
      const isMaster = /^Contents\/masterpage\d*\.xml$/.test(href);
      if (!isBin && !isMaster) continue;
      const file = a.zip.file(href);
      if (!file) continue;
      const ext = href.includes(".") ? href.slice(href.lastIndexOf(".")) : "";
      const newId = isBin ? `image${nextImage++}` : `masterpage${nextMaster++}`;
      const newHref = isBin ? `BinData/${newId}${ext}` : `Contents/${newId}.xml`;
      (isBin ? maps.bin : maps.master).set(id, newId);
      newItems.push(setAttr(setAttr(item, "id", newId), "href", newHref));
      if (isBin) b.zip.file(newHref, await file.async("uint8array"));
    }
    // 바탕쪽은 그림 번호 표가 확정된 뒤에 쓴다(바탕쪽 안의 그림 참조도 바꿔야 한다)
    for (const [oldId, newId] of maps.master) {
      const oldHref = attManifest.map((t) => (attrOf(t, "id") === oldId ? attrOf(t, "href") : null)).find(Boolean);
      const src = oldHref ? a.zip.file(oldHref) : null;
      if (src) b.zip.file(`Contents/${newId}.xml`, remapRefs(await src.async("string"), maps));
    }

    // 3) header 항목 덧붙이기(교차 참조 바꾼 뒤)
    for (const p of pending) header = appendToContainer(header, p.container, p.items.map((it) => remapRefs(it, maps)));

    // 4) 본문 구역
    const sections = spineSections(a.hpf);
    if (!sections.length) throw new HwpxMergeError(`${part.label}: 본문 구역이 없습니다.`);
    const spineRefs: string[] = [];
    for (const href of sections) {
      const xml = await a.zip.file(href)?.async("string");
      if (!xml) throw new HwpxMergeError(`${part.label}: ${href} 를 읽을 수 없습니다.`);
      const id = `section${sectionCount++}`;
      b.zip.file(`Contents/${id}.xml`, remapRefs(xml, maps));
      newItems.push(`<opf:item id="${id}" href="Contents/${id}.xml" media-type="application/xml"/>`);
      spineRefs.push(`<opf:itemref idref="${id}" linear="yes"/>`);
    }
    hpf = hpf.replace("</opf:manifest>", () => `${newItems.join("")}</opf:manifest>`).replace("</opf:spine>", () => `${spineRefs.join("")}</opf:spine>`);
  }

  header = header.replace(/(<hh:head\b[^>]*?\bsecCnt=")\d+(")/, `$1${sectionCount}$2`);
  b.zip.file("Contents/header.xml", header);
  b.zip.file("Contents/content.hpf", hpf);
  // mimetype 은 무압축 첫 항목이어야 한다(lib/letter/hwpx.ts 와 같은 처리)
  const mimetype = b.zip.file("mimetype");
  if (mimetype) b.zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return b.zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
