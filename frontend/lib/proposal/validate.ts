import { isInfoType, INFO_TYPE_META, sanitizeInfoSpec } from "@/lib/catalog/render/infographic/types";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import type { BulletItem, CardItem, GanttTask, KpiItem, ProposalBlock, ProposalDocument, ProposalOptions, ProposalSection, ProposalTemplateId, ProposalTheme, TableStyle } from "./types";
import { DIAGRAM_ICON_NAMES, DIAGRAM_META, isDiagramKind, type DiagramItem, type DiagramSpec } from "./diagrams/types";
import { isHexColor } from "./design";
import { materializeDocument } from "./materialize";
import { COVER_ART_ID, DIVIDER_ART_ID } from "./art";

export class ProposalError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const PROPOSAL_MAX_BYTES = 30 * 1024 * 1024;
export const PROPOSAL_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const PROPOSAL_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const TEMPLATES: ProposalTemplateId[] = ["permit-general", "permit-power", "permit-inspection", "sustainability"];
const THEMES: ProposalTheme[] = ["navy", "ocean", "forest", "slate", "burgundy"];
/** v1(GPT 작업본) 테마 이름 → v2 */
const LEGACY_THEME: Record<string, ProposalTheme> = { navy: "navy", green: "forest", slate: "slate", burgundy: "burgundy" };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ProposalError("문서 형식이 올바르지 않습니다.");
  return v as Record<string, unknown>;
};
const str = (v: unknown, label: string, max: number): string => {
  if (typeof v !== "string" || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new ProposalError(`${label}의 형식 또는 길이를 확인해 주세요.`);
  return v;
};
const optStr = (v: unknown, label: string, max: number) => (v === undefined ? undefined : str(v, label, max));
const arr = (v: unknown, label: string, min: number, max: number): unknown[] => {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new ProposalError(`${label}은 ${min}~${max}개여야 합니다.`);
  return v;
};
const int = (v: unknown, label: string, min: number, max: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new ProposalError(`${label}을 확인해 주세요.`);
  return v;
};
export function validateRevision(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new ProposalError("불러온 문서의 판 번호(rev)가 필요합니다.");
  return v;
}
export function validateProposalId(v: unknown): string {
  if (typeof v !== "string" || !PROPOSAL_ID_RE.test(v)) throw new ProposalError("문서 또는 블록 ID가 올바르지 않습니다.");
  return v;
}
export function validateImageDataUrl(v: unknown, pngOnly = false): string {
  const value = str(v, "그림", Math.ceil(PROPOSAL_IMAGE_MAX_BYTES * 4 / 3) + 100);
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || (pngOnly && match[1] !== "png") || match[2].length % 4 !== 0) throw new ProposalError(pngOnly ? "도식은 PNG 그림이어야 합니다." : "PNG 또는 JPEG 그림을 선택해 주세요.");
  return value;
}
function dimension(v: unknown, label: string, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 10 || v > max) throw new ProposalError(`${label}는 10~${max} mm여야 합니다.`);
  return v;
}

function infoSpecOf(rawSpec: unknown) {
  const spec = obj(rawSpec); const content = obj(spec.content);
  if (!isInfoType(spec.type) || !Object.hasOwn(INFO_TYPE_META, spec.type) || !Array.isArray(content.items) || content.items.length > 20) throw new ProposalError("인포그래픽 유형 또는 항목을 확인해 주세요.");
  if (spec.variant != null && !INFO_TYPE_META[spec.type].variants.some((x) => x.id === spec.variant)) throw new ProposalError("인포그래픽 배치 형식을 확인해 주세요.");
  if (spec.colorMode != null && !["area", "brand", "mono"].includes(String(spec.colorMode))) throw new ProposalError("인포그래픽 색상 형식을 확인해 주세요.");
  for (const rawItem of content.items) {
    const item = obj(rawItem);
    if (item.metric != null) throw new ProposalError("제안서 지표는 발행 시점의 수치를 직접 입력해 주세요.");
  }
  return sanitizeInfoSpec(spec, { type: spec.type, content: { items: [] } });
}

function diagramSpecOf(rawSpec: unknown): DiagramSpec {
  const spec = obj(rawSpec);
  if (!isDiagramKind(spec.kind)) throw new ProposalError("도식 종류를 확인해 주세요.");
  const meta = DIAGRAM_META[spec.kind];
  const ids = new Set<string>();
  const items = arr(spec.items, "도식 항목", 0, 20).map((raw): DiagramItem => {
    const it = obj(raw);
    const id = validateProposalId(it.id);
    if (id.length > 24 || ids.has(id)) throw new ProposalError("도식 항목 ID의 길이 또는 중복을 확인해 주세요.");
    ids.add(id);
    const out: DiagramItem = { id, label: str(it.label, "도식 항목", 80) };
    const desc = optStr(it.desc, "도식 설명", 300); if (desc) out.desc = desc;
    if (it.icon !== undefined) { if (!(DIAGRAM_ICON_NAMES as readonly string[]).includes(String(it.icon))) throw new ProposalError("도식 아이콘을 확인해 주세요."); out.icon = String(it.icon); }
    const group = optStr(it.group, "도식 분류", 20); if (group) out.group = group;
    const a = optStr(it.a, "도식 이전", 200); if (a !== undefined) out.a = a;
    const b = optStr(it.b, "도식 이후", 200); if (b !== undefined) out.b = b;
    if (it.color !== undefined) { if (!isHexColor(it.color)) throw new ProposalError("도식 항목 색은 #RRGGBB 형식이어야 합니다."); out.color = it.color.toUpperCase(); }
    for (const k of ["x", "y"] as const) if (it[k] !== undefined) { if (typeof it[k] !== "number" || !Number.isFinite(it[k]) || (it[k] as number) < 0 || (it[k] as number) > 100) throw new ProposalError("도식 좌표는 0~100이어야 합니다."); out[k] = it[k] as number; }
    return out;
  });
  const out: DiagramSpec = { kind: spec.kind, items };
  if (spec.center !== undefined) { const c = obj(spec.center); out.center = { label: str(c.label, "도식 가운데", 60), ...(c.desc ? { desc: str(c.desc, "도식 가운데 설명", 80) } : {}) }; }
  if (spec.tone !== undefined) { if (spec.tone !== "multi" && spec.tone !== "theme") throw new ProposalError("도식 색 형식을 확인해 주세요."); out.tone = spec.tone; }
  for (const k of ["legend", "axes"] as const) if (spec[k] !== undefined) { const v = arr(spec[k], `도식 ${k}`, 2, 2).map((x) => str(x, "도식 축·범례", 30)); out[k] = [v[0], v[1]]; }
  void meta;
  return out;
}

function blockOf(raw: unknown, uniqueId: (v: unknown) => string): ProposalBlock {
  const b = obj(raw);
  const id = uniqueId(b.id);
  switch (b.kind) {
    case "heading": return { kind: "heading", id, level: int(b.level, "제목 단계", 1, 3) as 1 | 2 | 3, text: str(b.text, "제목", 200) };
    case "text": return { kind: "text", id, text: str(b.text, "본문", 40000) };
    case "bullets": return { kind: "bullets", id, items: arr(b.items, "개조식 항목", 1, 80).map((x): BulletItem => {
      const it = obj(x);
      const out: BulletItem = { level: int(it.level, "글머리 단계", 1, 3) as 1 | 2 | 3, text: str(it.text, "개조식", 2000) };
      if (it.mark !== undefined) { if (!["note", "result", "check"].includes(String(it.mark))) throw new ProposalError("글머리 기호를 확인해 주세요."); out.mark = it.mark as BulletItem["mark"]; }
      return out;
    }) };
    case "lead": return { kind: "lead", id, text: str(b.text, "핵심 메시지", 1000), ...(b.label ? { label: str(b.label, "라벨", 20) } : {}) };
    case "callout": {
      if (!["note", "point"].includes(String(b.variant))) throw new ProposalError("상자 종류를 확인해 주세요.");
      return { kind: "callout", id, variant: b.variant as "note" | "point", title: str(b.title, "상자 제목", 60), text: str(b.text, "상자 내용", 4000) };
    }
    case "stage": return { kind: "stage", id, label: str(b.label, "단계 라벨", 30), text: str(b.text, "단계 이름", 200) };
    case "cards": case "steps": {
      const items = arr(b.items, b.kind === "cards" ? "카드" : "단계", 1, b.kind === "cards" ? 12 : 6).map((x): CardItem => {
        const it = obj(x);
        if (it.color !== undefined && !isHexColor(it.color)) throw new ProposalError("항목 색은 #RRGGBB 형식이어야 합니다.");
        return { title: str(it.title, "항목 제목", 120), body: str(it.body, "항목 내용", 2000), ...(it.key === true ? { key: true } : {}), ...(it.color ? { color: String(it.color).toUpperCase() } : {}) };
      });
      const multi = b.multi === true ? { multi: true } : {};
      if (b.kind === "steps") return { kind: "steps", id, items, ...multi };
      return { kind: "cards", id, columns: int(b.columns, "카드 열 수", 2, 4) as 2 | 3 | 4, numbered: b.numbered === true, items, ...multi };
    }
    case "kpis": return { kind: "kpis", id, items: arr(b.items, "큰 숫자", 1, 6).map((x): KpiItem => {
      const it = obj(x);
      return { value: str(it.value, "수치", 20), label: str(it.label, "수치 이름", 60), ...(it.unit ? { unit: str(it.unit, "단위", 10) } : {}) };
    }) };
    case "table": {
      const style = (b.style ?? "grid") as TableStyle;
      if (!["grid", "clean", "form"].includes(style)) throw new ProposalError("표 양식을 확인해 주세요.");
      const columns = arr(b.columns, "표 열", 1, 12).map((c) => str(c, "표 머리글", 200));
      const rows = arr(b.rows, "표 행", 0, 300).map((r) => {
        if (!Array.isArray(r) || r.length !== columns.length) throw new ProposalError("표의 각 행은 머리글과 열 수가 같아야 합니다.");
        return r.map((c) => str(c, "표 내용", 4000));
      });
      const out: Extract<ProposalBlock, { kind: "table" }> = { kind: "table", id, title: str(b.title ?? "", "표 제목", 200), style, columns, rows };
      if (b.widths !== undefined) {
        const w = arr(b.widths, "표 열 폭", columns.length, columns.length);
        if (w.some((x) => typeof x !== "number" || !Number.isFinite(x) || x <= 0 || x > 100)) throw new ProposalError("표 열 폭을 확인해 주세요.");
        out.widths = w as number[];
      }
      if (b.firstCol === true) out.firstCol = true;
      if (b.note) out.note = str(b.note, "표 주석", 400);
      return out;
    }
    case "gantt": {
      const periods = arr(b.periods, "일정 기간", 1, 40).map((p) => str(p, "기간 이름", 12));
      const tasks = arr(b.tasks, "일정 과업", 1, 40).map((x): GanttTask => {
        const t = obj(x);
        const start = int(t.start, "시작 기간", 0, periods.length - 1), end = int(t.end, "종료 기간", 0, periods.length - 1);
        if (end < start) throw new ProposalError("과업의 종료가 시작보다 앞섭니다.");
        const out: GanttTask = { label: str(t.label, "과업 이름", 120), start, end };
        if (t.group) out.group = str(t.group, "과업 구분", 60);
        if (t.tone !== undefined) { if (!["work", "report", "key"].includes(String(t.tone))) throw new ProposalError("일정 막대 색을 확인해 주세요."); out.tone = t.tone as GanttTask["tone"]; }
        if (t.marks !== undefined) out.marks = arr(t.marks, "보고 표시", 0, periods.length).map((m) => int(m, "보고 표시", 0, periods.length - 1));
        return out;
      });
      return { kind: "gantt", id, title: str(b.title ?? "", "일정 제목", 200), periods, tasks, ...(b.note ? { note: str(b.note, "일정 주석", 200) } : {}) };
    }
    case "figure": case "diagram": case "image": {
      const title = str(b.title ?? "", "그림 제목", 200);
      const widthMm = dimension(b.widthMm, "그림 너비", 180), heightMm = dimension(b.heightMm, "그림 높이", 250);
      if (b.kind === "image") return { kind: "image", id, title, widthMm, heightMm, dataUrl: b.dataUrl === "" ? "" : validateImageDataUrl(b.dataUrl, true) };
      if (b.kind === "diagram") return { kind: "diagram", id, title, widthMm, heightMm, spec: diagramSpecOf(b.spec) };
      return { kind: "figure", id, title, widthMm, heightMm, spec: infoSpecOf(b.spec) };
    }
    default: throw new ProposalError("지원하지 않는 본문 블록입니다.");
  }
}

/** 저장은 미완성 문안을 허용하되 구조·길이·그림 크기를 엄격하게 검사한다. v1(GPT 작업본)은 v2 로 올려 받는다. */
export function validateProposalDocument(input: unknown): ProposalDocument {
  const o = obj(input);
  if (o.schemaVersion !== 1 && o.schemaVersion !== 2) throw new ProposalError("지원하지 않는 제안서 형식입니다.");
  const theme = (o.schemaVersion === 1 ? LEGACY_THEME[String(o.theme)] : o.theme) as ProposalTheme;
  if (!TEMPLATES.includes(o.templateId as ProposalTemplateId) || !THEMES.includes(theme)) throw new ProposalError("제안서 템플릿 또는 테마를 확인해 주세요.");
  if (!Array.isArray(o.sections) || o.sections.length > 120) throw new ProposalError("쪽은 120개 이하여야 합니다.");
  const ids = new Set<string>();
  const uniqueId = (v: unknown) => { const id = validateProposalId(v); if (ids.has(id)) throw new ProposalError(`중복된 블록 ID: ${id}`); ids.add(id); return id; };
  let blockCount = 0;
  const sections = o.sections.map((raw): ProposalSection => {
    const sec = obj(raw); const id = uniqueId(sec.id);
    if (!Array.isArray(sec.blocks) || (blockCount += sec.blocks.length) > 900) throw new ProposalError("문서의 블록은 900개 이하여야 합니다.");
    const blocks = sec.blocks.map((b) => {
      const bo = obj(b);
      // v1 표는 양식이 없었다 — 격자형으로
      return blockOf(o.schemaVersion === 1 && bo.kind === "table" ? { ...bo, style: "grid" } : bo, uniqueId);
    });
    const out: ProposalSection = { id, title: str(sec.title ?? "", "쪽 제목", 200), blocks };
    if (sec.pageId !== undefined) out.pageId = str(sec.pageId, "쪽 식별자", 20);
    if (sec.chapter !== undefined) out.chapter = str(sec.chapter, "장", 100);
    if (sec.crumb !== undefined) out.crumb = str(sec.crumb, "절", 100);
    if (sec.summary !== undefined) out.summary = str(sec.summary, "핵심 문장", 600);
    if (sec.sourceHash !== undefined) { if (typeof sec.sourceHash !== "string" || !/^[0-9a-f]{16}$/.test(sec.sourceHash)) throw new ProposalError("쪽 원고 지문 형식을 확인해 주세요."); out.sourceHash = sec.sourceHash; }
    return out;
  });
  const submissionDate = str(o.submissionDate, "제출일", 10);
  if (submissionDate && (!/^\d{4}-\d{2}-\d{2}$/.test(submissionDate) || Number.isNaN(Date.parse(submissionDate)) || new Date(submissionDate).toISOString().slice(0, 10) !== submissionDate)) throw new ProposalError("제출일을 확인해 주세요.");
  const out: ProposalDocument = {
    schemaVersion: 2, id: validateProposalId(o.id), title: str(o.title, "문서 제목", 200), client: str(o.client, "발주처", 200), projectName: str(o.projectName, "사업명", 300),
    submissionDate, templateId: o.templateId as ProposalTemplateId, theme, sections,
  };
  if (o.layout !== undefined) { if (o.layout !== "paged") throw new ProposalError("쪽 구성 형식을 확인해 주세요."); out.layout = "paged"; }
  if (o.contentVersion !== undefined) out.contentVersion = str(o.contentVersion, "원고 버전", 80);
  if (o.variables !== undefined) {
    const vars = obj(o.variables);
    out.variables = { siteName: str(vars.siteName, "사업장명", 200), duration: str(vars.duration, "수행기간", 100), companyName: str(vars.companyName, "제안사명", 200) };
  }
  if (o.options !== undefined) {
    const op = obj(o.options);
    if (!["modern", "classic"].includes(String(op.cover))) throw new ProposalError("표지 모양을 확인해 주세요.");
    const options: ProposalOptions = { cover: op.cover as "modern" | "classic", dividers: op.dividers === true, toc: op.toc !== false };
    if (op.palette !== undefined) { if (!["calm", "earth", "mono"].includes(String(op.palette))) throw new ProposalError("도식 팔레트를 확인해 주세요."); options.palette = op.palette as ProposalOptions["palette"]; }
    if (op.brandColor !== undefined && op.brandColor !== "") { if (!isHexColor(op.brandColor)) throw new ProposalError("발주처 주색은 #RRGGBB 형식이어야 합니다."); options.brandColor = op.brandColor; }
    out.options = options;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > PROPOSAL_MAX_BYTES) throw new ProposalError("제안서 용량이 30 MB를 넘습니다.", 413);
  return out;
}

/** 발행 때 PNG 로 받아야 하는 그림 — 도식·인포그래픽 블록, 표지 배경, (간지를 쓰면) 간지 배경. 크기는 mm. */
export function rasterTargets(doc: ProposalDocument): Array<{ id: string; label: string; widthMm: number; heightMm: number }> {
  const out = [{ id: COVER_ART_ID, label: "표지 배경", widthMm: 210, heightMm: 297 }];
  if (doc.options?.dividers) out.push({ id: DIVIDER_ART_ID, label: "간지 배경", widthMm: 210, heightMm: 297 });
  for (const s of doc.sections) for (const b of s.blocks) if (b.kind === "figure" || b.kind === "diagram") out.push({ id: b.id, label: b.title || b.id, widthMm: b.widthMm, heightMm: b.heightMm });
  return out;
}

/** 발행 준비 검사는 초안 저장과 분리한다. 미기입 항목과 도식 데이터 누락을 숨기지 않는다. */
export function validateProposalForPublication(doc: ProposalDocument): void {
  doc = materializeDocument(doc);
  if (/\{\{[^{}]+\}\}/.test(JSON.stringify(doc))) throw new ProposalError("본문에 남은 연결 항목을 확인해 주세요. 표지·사업장 정보에서 값을 입력하거나 잘못된 연결 표기를 수정하세요.", 422);
  if (JSON.stringify(doc).includes("[작성 필요]")) throw new ProposalError("발행 전에 문서에 남은 [작성 필요] 항목을 채워 주세요.", 422);
  if (![doc.title, doc.client, doc.projectName, doc.submissionDate].every((v) => v.trim())) throw new ProposalError("발행 전에 제목·발주처·사업명·제출일을 입력해 주세요.", 422);
  if (!doc.sections.length || !doc.sections.some((s) => s.blocks.length)) throw new ProposalError("발행할 본문이 없습니다.", 422);
  for (const s of doc.sections) for (const b of s.blocks) {
    if (b.kind === "image" && !b.dataUrl) throw new ProposalError(`그림 '${b.title || "제목 없음"}'에 파일이 없습니다.`, 422);
    if (b.kind === "diagram") {
      const meta = DIAGRAM_META[b.spec.kind];
      if (b.spec.items.length < meta.min || b.spec.items.length > meta.max || b.spec.items.some((x) => !x.label.trim())) throw new ProposalError(`${b.title || "도식"}: 항목은 ${meta.min}~${meta.max}개이고 이름이 있어야 합니다.`, 422);
    }
    if (b.kind === "figure") {
      const blocked = matchInfographic(b.spec.content, { box: { w: b.widthMm * 72 / 25.4, h: b.heightMm * 72 / 25.4 }, current: b.spec.type }).blocked.find((x) => x.type === b.spec.type);
      if (blocked) throw new ProposalError(`${b.title || "도식"}: ${blocked.reason}`, 422);
      const meta = INFO_TYPE_META[b.spec.type]; const items = b.spec.content.items;
      if (items.length < meta.min || items.length > meta.max || items.some((x) => !x.label?.trim())) throw new ProposalError(`${b.title || "도식"}: 항목 수와 이름을 확인해 주세요.`, 422);
      if (meta.family === "number" && items.some((x) => typeof x.value !== "number")) throw new ProposalError(`${b.title || "도식"}: 수치를 입력해 주세요.`, 422);
      if (meta.needs === "when" && items.some((x) => !x.when?.trim())) throw new ProposalError(`${b.title || "도식"}: 시점을 입력해 주세요.`, 422);
      if (meta.needs === "prev" && items.some((x) => typeof x.prev !== "number")) throw new ProposalError(`${b.title || "도식"}: 이전 값을 입력해 주세요.`, 422);
      if (meta.needs === "region" && items.some((x) => !x.region)) throw new ProposalError(`${b.title || "도식"}: 권역을 입력해 주세요.`, 422);
    }
  }
}
