// 제안서 HWPX 조판기 2.0 구조 검사 — 합성 PNG 를 쓴다. 실제 도식의 시각 품질은 브라우저 발행본·한글 렌더로 따로 확인한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import JSZip from "jszip";
import { createProposalTemplate, PROPOSAL_TEMPLATES } from "@/lib/proposal/templates";
import { renderProposalHwpx } from "@/lib/proposal/hwpx";
import { rasterTargets, validateProposalDocument, validateProposalForPublication } from "@/lib/proposal/validate";
import { optionsOf, type ProposalBlock, type ProposalDocument } from "@/lib/proposal/types";
import { escapeXml } from "@/lib/letter/hwpx";
import { materializeDocument } from "@/lib/proposal/materialize";
import { physicalPages, tocEntries } from "@/lib/proposal/layout";
import { BODY_WIDTH_MM, BULLET_LEFT, NEUTRAL, SERIES, SERIES_EARTH, paletteOf, parseRich, seriesFor } from "@/lib/proposal/design";
import { renderToStaticMarkup } from "react-dom/server";
import { renderDiagram } from "@/lib/proposal/diagrams/render";

const outDir = process.env.PROPOSAL_TEST_OUT || path.resolve(".next/proposal-hwpx-validation");
const MM = 7200 / 25.4;
const BODY_W = Math.round(BODY_WIDTH_MM * MM);
const special = '한글 & <검증> "인용" Ω ①';
const attr = (xml: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(xml)?.[1];
const count = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b`, "g"))].length;
const plain = (t: string) => parseRich(t).map((r) => r.text);

function syntheticDocument(id: ProposalDocument["templateId"], dividers = false): ProposalDocument {
  const doc: ProposalDocument = JSON.parse(JSON.stringify(createProposalTemplate(id)).replaceAll("[작성 필요]", "합성 검증"));
  doc.client = "검증기관"; doc.projectName = "템플릿 검증"; doc.submissionDate = "2026-10-30";
  doc.title += ` — ${special}`;
  doc.options = { cover: "modern", toc: true, dividers };
  doc.sections[0].blocks.unshift({ id: "special_text", kind: "text", text: special + "\n두 번째 검증 문단" });
  const firstTable = doc.sections.flatMap((s) => s.blocks).find((b) => b.kind === "table");
  if (firstTable?.kind === "table") firstTable.rows[0][0] = special;
  return validateProposalDocument(doc);
}

function syntheticPng(widthMm: number, heightMm: number, label: string, dpi = 300): string {
  const canvas = createCanvas(Math.round(widthMm / 25.4 * dpi), Math.round(heightMm / 25.4 * dpi));
  const c = canvas.getContext("2d");
  c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = "#20354D"; c.font = 'bold 42px "Malgun Gothic"'; c.fillText(label, 50, 65);
  for (const [x, y, color] of [[0, 0, "#E74C3C"], [canvas.width - 24, 0, "#27AE60"], [0, canvas.height - 24, "#2980B9"], [canvas.width - 24, canvas.height - 24, "#F1C40F"]] as const) {
    c.fillStyle = color; c.fillRect(x, y, 24, 24);
  }
  return canvas.toDataURL("image/png");
}
/** 발행 대상 그림 전부(도식·인포그래픽·표지·간지)를 합성 PNG 로 */
function figures(doc: ProposalDocument): Record<string, string> {
  return Object.fromEntries(rasterTargets(doc).map((t) => [t.id, syntheticPng(t.widthMm, t.heightMm, t.label, t.id.startsWith("__") ? 120 : 300)]));
}
/** 문서에 들어간 모든 사용자 글(개조식·카드·표·일정 등) */
function visibleTexts(b: ProposalBlock): string[] {
  switch (b.kind) {
    case "heading": return [b.text];
    case "text": return b.text.split("\n").flatMap(plain);
    case "bullets": return b.items.flatMap((it) => plain(it.text));
    case "lead": return [...plain(b.text), ...(b.label ? [] : [])];
    case "callout": return [b.title, ...b.text.split("\n").flatMap(plain)];
    case "stage": return [b.label, b.text];
    case "cards": case "steps": return b.items.flatMap((it) => [it.title, ...it.body.split("\n").flatMap(plain)]);
    case "kpis": return b.items.flatMap((it) => [it.value, it.label]);
    case "table": return [...(b.title ? [b.title] : []), ...b.columns, ...b.rows.flat().flatMap((c) => c.split("\n").flatMap(plain))];
    case "gantt": return [...b.periods, ...b.tasks.map((t) => t.label)];
    default: return b.title ? [b.title] : [];
  }
}

for (const template of PROPOSAL_TEMPLATES) test(`${template.label}: 편집 가능한 문단·표 조합과 그림이 보존된 HWPX`, async () => {
  const source = syntheticDocument(template.id, template.id === "sustainability");
  const doc = materializeDocument(source);
  validateProposalForPublication(doc);
  const input = figures(doc);
  const bytes = await renderProposalHwpx(source, input);
  const zip = await JSZip.loadAsync(bytes);
  const section = await zip.file("Contents/section0.xml")!.async("string");
  const header = await zip.file("Contents/header.xml")!.async("string");
  const manifest = await zip.file("Contents/content.hpf")!.async("string");
  const binding = JSON.parse(await zip.file("META-INF/proposal.json")!.async("string"));
  const blocks = doc.sections.flatMap((s) => s.blocks);
  const pictures = blocks.filter((b) => b.kind === "figure" || b.kind === "diagram");
  const pages = physicalPages(doc);

  assert.equal(await zip.file("mimetype")!.async("string"), "application/hwp+zip");
  const raw = Buffer.from(bytes); assert.equal(raw.readUInt32LE(0), 0x04034b50); assert.equal(raw.readUInt16LE(8), 0);
  // 쪽 나눔 = 물리 쪽 수 - 1, 계획 쪽수 기록
  assert.equal([...section.matchAll(/<hp:p\b[^>]*pageBreak="1"/g)].length, pages.length - 1);
  assert.equal(binding.plannedPages, pages.length);
  // 머리말: 장·절이 바뀌는 쪽마다 / 꼬리말·쪽 번호 1개 / 표지·목차·간지 숨김
  assert.equal(count(section, "hp:footer"), 1);
  assert.ok(section.includes('numType="PAGE"'));
  assert.equal(count(section, "hp:pageHiding"), pages.filter((p) => p.kind !== "body").length);
  assert.equal(count(section, "hp:newNum"), 1);
  const headKeys = new Set<string>(); let last = "";
  for (const s of doc.sections) { const k = `${s.chapter}|${s.crumb}`; if (k !== last) headKeys.add(k + headKeys.size); last = k; }
  assert.equal(count(section, "hp:header"), headKeys.size);
  // 글 손실 없음(특수문자 이스케이프 포함)
  assert.ok(section.includes(`<hp:t>${escapeXml(special)}</hp:t>`));
  assert.ok(!section.includes("[작성 필요]"));
  assert.ok(!/__PROPOSAL_|\{\{[A-Za-z_]+\}\}/.test(section));
  for (const s of doc.sections) {
    if (s.title) assert.ok(section.includes(escapeXml(s.title)), `쪽 제목 손실: ${s.title}`);
    if (s.summary) for (const t of plain(s.summary)) assert.ok(section.includes(escapeXml(t)), "요약 손실");
  }
  for (const b of blocks) for (const t of visibleTexts(b)) if (t.trim()) assert.ok(section.includes(escapeXml(t)), `${b.kind} 글 손실: ${t}`);
  for (const e of tocEntries(doc)) assert.ok(section.includes(escapeXml(e.label)), "목차 손실");
  // 서식 목록 정합성 — itemCnt 와 실제 수, id 연속
  for (const [list, item] of [["hh:borderFills", "hh:borderFill"], ["hh:charProperties", "hh:charPr"], ["hh:paraProperties", "hh:paraPr"], ["hh:styles", "hh:style"]] as const) {
    assert.equal(count(header, item), Number(attr(new RegExp(`<${list}\\b[^>]*>`).exec(header)![0], "itemCnt")), `${list} itemCnt`);
    const ids = [...header.matchAll(new RegExp(`<${item}\\b[^>]*\\bid="(\\d+)"`, "g"))].map((m) => Number(m[1]));
    const base = item === "hh:borderFill" ? 1 : 0; // 한글: 테두리·배경은 1번부터
    assert.deepEqual(ids, ids.map((_, i) => i + base), `${item} id 는 목록 순서와 같아야 함`);
  }
  assert.ok(header.includes('name="제안-글머리1"'), "개조식 문단 스타일 등록");
  // 표는 본문 폭(카드·큰 숫자는 셀 간격 포함)
  for (const tbl of section.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)) {
    const w = Number(attr(/<hp:sz\b[^>]*\/>/.exec(tbl[0])![0], "width"));
    assert.ok(Math.abs(w - BODY_W) <= BODY_W * 0.01 + 20, `표 폭 ${w} ≠ ${BODY_W}`);
  }
  // 그림 — 도식 + 표지(+간지) 배경, 원본 픽셀 × 75 clip, sha 결속
  const pics = [...section.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)].map((m) => m[0]);
  const artCount = 1 + pages.filter((p) => p.kind === "divider").length;
  assert.equal(pics.length, pictures.length + artCount);
  assert.equal(pics.filter((p) => p.includes('textWrap="BEHIND_TEXT"')).length, artCount, "배경 그림은 글 뒤");
  assert.equal(binding.bindings.length, pics.length);
  for (const pic of pics) {
    const ref = attr(/<hc:img\b[^>]*\/>/.exec(pic)![0], "binaryItemIDRef")!;
    const entry = [...manifest.matchAll(/<opf:item\b[^>]*\/>/g)].find((m) => attr(m[0], "id") === ref)?.[0];
    assert.ok(entry, "그림 manifest 누락");
    const png = await zip.file(attr(entry!, "href")!)!.async("nodebuffer");
    const decoded = await loadImage(png);
    const clip = /<hp:imgClip\b[^>]*\/>/.exec(pic)![0];
    assert.equal(Number(attr(clip, "right")), decoded.width * 75); assert.equal(Number(attr(clip, "bottom")), decoded.height * 75);
    assert.ok(binding.bindings.some((x: { binaryId: string; sha256: string }) => x.binaryId === ref && x.sha256 === createHash("sha256").update(png).digest("hex")));
  }
  for (const b of pictures) assert.ok(binding.bindings.some((x: { id: string }) => x.id === b.id), "도식 결속 누락");
  const binaries = Object.keys(zip.files).filter((name) => name.startsWith("BinData/") && !zip.files[name].dir);
  assert.equal(binaries.length, pics.length, "공문 원본 로고·직인 등의 잔존");
  assert.equal(zip.file("Preview/PrvImage.png"), null);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${template.id}.hwpx`), bytes);
});

test("문단 여백은 한글 단위(값의 절반 = pt)에 맞춰 두 배로 쓴다", async () => {
  const doc = syntheticDocument("permit-general");
  const zip = await JSZip.loadAsync(await renderProposalHwpx(doc, figures(doc)));
  const header = await zip.file("Contents/header.xml")!.async("string");
  const style = /<hh:style\b[^>]*name="제안-글머리1"[^>]*\/>/.exec(header)![0];
  const para = new RegExp(`<hh:paraPr\\b[^>]*\\bid="${attr(style, "paraPrIDRef")}"[\\s\\S]*?</hh:paraPr>`).exec(header)![0];
  assert.equal(Number(attr(/<hc:left\b[^>]*\/>/.exec(para)![0], "value")), BULLET_LEFT[1] * 200);
  assert.ok(Number(attr(/<hc:intent\b[^>]*\/>/.exec(para)![0], "value")) < 0, "글머리 내어쓰기");
  // 한글 HWPX: BREAK_WORD 가 어절 단위 줄바꿈(KEEP_WORD 는 낱말 중간에서 끊는다 — 실측)
  assert.match(para, /breakNonLatinWord="BREAK_WORD"/, "어절 단위 줄바꿈");
});

test("긴 표 셀: 본문 폭을 나누어 쓰고 줄 수에 맞는 높이로 모든 내용을 보존", async () => {
  const long = "자료와 현장 상태의 차이를 확인하고 검토한 모든 근거를 남깁니다. ".repeat(6).trim();
  const doc = syntheticDocument("permit-power");
  doc.sections = [{ id: "table_section", title: "표 내용", chapter: "검증", crumb: "1. 표", blocks: [{ kind: "table", id: "long_table", title: "확인표", style: "grid", columns: ["구분", "확인 내용", "담당"], rows: [["현장 조사", long, "공정 담당"]] }] }];
  const zip = await JSZip.loadAsync(await renderProposalHwpx(doc, figures(doc)));
  const xml = await zip.file("Contents/section0.xml")!.async("string");
  const table = [...xml.matchAll(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g)].map((m) => m[0]).find((t) => t.includes("확인 내용"))!;
  const rows = [...table.matchAll(/<hp:tr>[\s\S]*?<\/hp:tr>/g)].map((m) => m[0]);
  const height = (row: string) => Number(attr(/<hp:cellSz\b[^>]*\/>/.exec(row)![0], "height"));
  assert.ok(height(rows[1]) > height(rows[0]) * 2);
  assert.equal([...rows[1].matchAll(/<hp:cellSz\b[^>]*width="(\d+)"/g)].reduce((sum, m) => sum + Number(m[1]), 0), BODY_W);
  assert.ok(table.includes(escapeXml(long)));
  assert.ok(!table.includes("NaN"));
});

test("출력 그림·표지 배경 누락과 잘못된 그림 크기는 발행 실패", async () => {
  const doc = syntheticDocument("permit-general");
  const images = figures(doc);
  const { __cover: _cover, ...noCover } = images; void _cover;
  await assert.rejects(() => renderProposalHwpx(doc, noCover), /표지 배경/);
  const fig = doc.sections.flatMap((s) => s.blocks).find((b) => b.kind === "diagram")!;
  const { [fig.id]: _fig, ...noFigure } = images; void _fig;
  await assert.rejects(() => renderProposalHwpx(doc, noFigure), /출력 이미지가 없습니다/);
});

test("업로드한 그림은 가로세로 비율을 보존", async () => {
  const doc = syntheticDocument("permit-general");
  doc.sections = [{ id: "pic_section", title: "그림 비율", chapter: "검증", blocks: [] }];
  const canvas = createCanvas(800, 400); const c = canvas.getContext("2d"); c.fillStyle = "#20354D"; c.fillRect(0, 0, 800, 400);
  doc.sections[0].blocks.push({ kind: "image", id: "pic_block", title: "합성 그림", widthMm: 160, heightMm: 100, dataUrl: canvas.toDataURL("image/png") });
  const zip = await JSZip.loadAsync(await renderProposalHwpx(doc, figures(doc)));
  const xml = await zip.file("Contents/section0.xml")!.async("string");
  const pic = [...xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)].map((m) => m[0]).find((p) => !p.includes("BEHIND_TEXT"))!;
  const size = /<hp:sz\b[^>]*\/>/.exec(pic)![0];
  assert.equal(Number(attr(size, "width")), Math.round(160 * MM));
  assert.equal(Number(attr(size, "height")), Math.round(80 * MM));
});

test("발주처 주색은 흰 글자 대비 4.5:1 이상일 때만 쓴다", async () => {
  const doc = syntheticDocument("permit-inspection");
  doc.options = { cover: "modern", toc: true, dividers: false, brandColor: "#005A9C" };
  let header = await (await JSZip.loadAsync(await renderProposalHwpx(doc, figures(doc)))).file("Contents/header.xml")!.async("string");
  assert.ok(header.includes('faceColor="#005A9C"'), "대비가 충분한 주색 적용");
  doc.options = { ...doc.options, brandColor: "#7FD3FF" };
  header = await (await JSZip.loadAsync(await renderProposalHwpx(doc, figures(doc)))).file("Contents/header.xml")!.async("string");
  assert.ok(!header.includes("#7FD3FF"), "대비가 낮은 주색은 무시");
});

test("도식 다색 팔레트: 테마마다 시작 색만 돌리고, 발주처 주색을 써도 유지하며, 카드·단계 다색을 HWPX 셀에 칠한다", async () => {
  assert.equal(seriesFor("navy")[0], SERIES[0]);
  assert.equal(seriesFor("forest")[0], "#74986C");
  for (const t of ["navy", "ocean", "slate", "forest", "burgundy"] as const) assert.deepEqual([...seriesFor(t)].sort(), [...SERIES].sort());
  assert.deepEqual(paletteOf({ theme: "navy", options: { cover: "modern", toc: true, dividers: false, brandColor: "#005A9C" } }).series, seriesFor("navy"));
  const doc = syntheticDocument("permit-general");
  doc.sections = [{ id: "multi_section", title: "다색", chapter: "검증", blocks: [
    { kind: "cards", id: "multi_cards", columns: 3, numbered: true, multi: true, items: [{ title: "가", body: "" }, { title: "나", body: "" }, { title: "다", body: "" }] },
    { kind: "steps", id: "multi_steps", multi: true, items: [{ title: "가", body: "" }, { title: "나", body: "" }] },
  ] }];
  const header = await (await JSZip.loadAsync(await renderProposalHwpx(doc, figures(doc)))).file("Contents/header.xml")!.async("string");
  const s = seriesFor("navy");
  for (const c of [s[0], s[1], s[2]]) assert.ok(header.includes(`color="${c}"`) || header.includes(`faceColor="${c}"`), `다색 ${c}`);
});

test("2.1 회색 구조·도식 팔레트·항목 색: 단색 단계 머리는 그래파이트, 팔레트 선택·항목 직접 색이 미리보기와 HWPX에 같이 반영된다", async () => {
  // 팔레트 선택
  const base = { theme: "navy" as const, options: { cover: "modern" as const, toc: true, dividers: false } };
  assert.deepEqual(paletteOf(base).series, seriesFor("navy"));
  assert.deepEqual(paletteOf({ ...base, options: { ...base.options, palette: "earth" } }).series, [...SERIES_EARTH]);
  const mono = paletteOf({ ...base, options: { ...base.options, palette: "mono" } });
  assert.equal(mono.series![0], mono.primary, "모노톤 첫 색은 테마 주색");
  assert.ok(mono.series!.includes("#59616B"), "모노톤은 회색 단계를 섞는다");
  // 검증 — 형식이 틀린 색·팔레트는 거절, 정상 값은 대문자로 정규화
  const doc = syntheticDocument("permit-general");
  doc.options = { ...optionsOf(doc), palette: "earth" };
  doc.sections = [{ id: "gray_section", title: "회색", chapter: "검증", blocks: [
    { kind: "steps", id: "gray_steps", items: [{ title: "가", body: "" }, { title: "나", body: "", color: "#aa3311" }] },
    { kind: "cards", id: "gray_cards", columns: 2, numbered: false, items: [{ title: "가", body: "" }, { title: "나", body: "", color: "#11AA33" }] },
  ] }];
  const v = validateProposalDocument(doc);
  const steps = v.sections[0].blocks[0];
  assert.ok(steps.kind === "steps" && steps.items[1].color === "#AA3311");
  assert.equal(v.options?.palette, "earth");
  assert.throws(() => validateProposalDocument({ ...doc, options: { ...doc.options, palette: "neon" as "calm" } }));
  const bad = JSON.parse(JSON.stringify(doc)); bad.sections[0].blocks[1].items[0].color = "red";
  assert.throws(() => validateProposalDocument(bad));
  // HWPX — 단색 단계 머리 그래파이트, 직접 지정 색은 다색이 꺼져 있어도 칠한다
  const header = await (await JSZip.loadAsync(await renderProposalHwpx(v, figures(v)))).file("Contents/header.xml")!.async("string");
  assert.ok(header.includes(`faceColor="${NEUTRAL.graphite}"`), "단계 머리 그래파이트");
  assert.ok(header.includes('faceColor="#AA3311"'), "단계 항목 직접 색");
  assert.ok(header.includes('color="#11AA33"'), "카드 항목 직접 색(윗선)");
  // 도식 — 항목 직접 색이 팔레트보다 앞서고, 허브 가운데는 그래파이트
  const pal = paletteOf(v);
  const svg = renderToStaticMarkup(renderDiagram({ kind: "chevrons", items: [{ id: "a", label: "가", color: "#123456" }, { id: "b", label: "나" }] }, { w: 400, h: 120 }, pal));
  assert.ok(svg.includes('fill="#123456"'), "도식 항목 직접 색");
  assert.ok(svg.includes(`fill="${SERIES_EARTH[1]}"`), "나머지 항목은 선택한 팔레트 순서");
  const hub = renderToStaticMarkup(renderDiagram({ kind: "hub", center: { label: "중심" }, items: [{ id: "a", label: "가" }, { id: "b", label: "나" }, { id: "c", label: "다" }] }, { w: 400, h: 240 }, pal));
  assert.ok(hub.includes(`fill="${NEUTRAL.graphite}"`), "허브 가운데 그래파이트");
});
