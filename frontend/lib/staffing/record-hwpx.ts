import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

/*
 * 수행인력 개별 이력사항 HWPX — 회사 표준 양식(public/hwpx/staff-history.hwpx)을 채운다.
 * 양식은 표 1개(10열 격자)다. 표의 여러 쪽 지원은 '셀 단위로 나눔'(pageBreak="TABLE")이라
 * 수행 용역이 많아 쪽이 넘어가도 행 경계에서 끊긴다 — 이 속성은 건드리지 않는다.
 *
 *   행0 성명·직위(급)   행1 소속   행2 주소(직장)
 *   행3 학력 머리행      행4 학력(반복)
 *   행5 해당분야 근무경력·자격증
 *   행6 경력 제목        행7 경력 머리행      행8 경력(반복)
 *
 * 반복 행은 양식의 행을 그대로 복제해 값만 바꾸므로 글꼴·테두리·정렬이 양식과 같다.
 * PDF 는 이 HWPX 를 converter 로 변환해 만든다(record-bundle.ts).
 */

export interface RecordHwpxEducation {
  years: string; // ‘14.03.∼‘20.08.
  school: string;
  major: string;
  degree: string;
}

export interface RecordHwpxProject {
  name: string; // 사업명
  from: string; // 2022.02.07.
  to: string; // 2023.12.28. | 용역수행중
  task: string;
  client: string;
  note: string;
}

export interface RecordHwpxData {
  name: string;
  position: string;
  affiliation: string; // 회사명 + 부서
  address: string; // 직장 주소
  educations: RecordHwpxEducation[];
  career: string; // 해당분야 근무경력
  licenses: string[];
  /** 경력 표 제목의 괄호 안 문구(예: 통합환경허가 취득용역) */
  projectScope: string;
  projects: RecordHwpxProject[];
}

const TEMPLATE_FILE = "staff-history.hwpx";
const SECTION_PATH = "Contents/section0.xml";

const ROW = { name: 0, affiliation: 1, address: 2, education: 4, career: 5, projectTitle: 6, project: 8 } as const;

const TR_RE = /<hp:tr>[\s\S]*?<\/hp:tr>/g;
const TC_RE = /<hp:tc\b[\s\S]*?<\/hp:tc>/g;
const P_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
// 캐시된 줄 배치 — 지워야 한글·변환기가 바뀐 글자로 줄바꿈을 다시 계산한다
const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let templateCache: Buffer | null = null;
async function loadTemplate(): Promise<Buffer> {
  if (!templateCache) templateCache = await readFile(path.join(process.cwd(), "public", "hwpx", TEMPLATE_FILE));
  return templateCache;
}

/** 문단의 글자만 바꾼다(첫 hp:t 에 값, 나머지는 비움) — 문단·글자 모양 참조는 그대로. */
function setParagraphText(pXml: string, value: string): string {
  let first = true;
  return pXml.replace(/<hp:t>[^<]*<\/hp:t>|<hp:t\/>/g, () => {
    if (!first) return "<hp:t></hp:t>";
    first = false;
    return `<hp:t>${escapeXml(value)}</hp:t>`;
  });
}

/** 셀 내용을 줄 목록으로 교체 — 양식 셀의 첫 문단을 줄 수만큼 복제한다. */
function setCellLines(tcXml: string, lines: string[]): string {
  const paragraphs = tcXml.match(P_RE);
  if (!paragraphs?.length) return tcXml;
  const start = tcXml.indexOf(paragraphs[0]);
  const last = paragraphs[paragraphs.length - 1];
  const end = tcXml.lastIndexOf(last) + last.length;
  const body = (lines.length ? lines : [""]).map((line) => setParagraphText(paragraphs[0], line)).join("");
  return tcXml.slice(0, start) + body + tcXml.slice(end);
}

/** 행에서 열 주소(colAddr)가 맞는 셀만 값으로 바꾼다. */
function fillRow(trXml: string, cells: Record<number, string[]>): string {
  return trXml.replace(TC_RE, (tc) => {
    const col = Number(/<hp:cellAddr colAddr="(\d+)"/.exec(tc)?.[1] ?? -1);
    return cells[col] ? setCellLines(tc, cells[col]) : tc;
  });
}

/*
 * 행 높이 보정 — 한글은 내용이 넘치면 행을 알아서 늘리지만, PDF 변환기(LibreOffice)는
 * 양식의 셀 높이를 고정값으로 써서 3줄 이상인 긴 사업명이 잘린다(실측). 그래서 줄 수를 어림해
 * 필요한 만큼만 셀 높이를 키운다. 폭·줄 간격은 양식의 글자 모양(12pt, 장평 95%·자간 -7%)에서 온 값.
 */
const EM = 1056; // 한글 1자 폭(HWPUNIT) = 1200 × 0.95 − 1200 × 0.07
const HALF = 0.6; // 영문·숫자·기호·공백의 한글 대비 폭(넉넉하게)

/** 어절 단위 줄바꿈 기준 줄 수 어림(한 어절이 줄보다 길면 글자 단위로 넘긴다). */
function estimateLines(text: string, widthUnits: number): number {
  const perLine = widthUnits / EM;
  const widthOf = (t: string) => [...t].reduce((acc, ch) => acc + (ch.charCodeAt(0) < 0x2e80 ? HALF : 1), 0);
  let lines = 1;
  let used = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const w = widthOf(word);
    const need = used > 0 ? w + HALF : w;
    if (used + need <= perLine) {
      used += need;
      continue;
    }
    if (used > 0) lines += 1;
    lines += Math.max(0, Math.ceil(w / perLine) - 1);
    used = w % perLine || perLine;
  }
  return lines;
}

/** 행의 모든 셀 높이를 min 이상으로 맞춘다(양식 높이보다 작게는 줄이지 않는다). */
function ensureRowHeight(trXml: string, min: number): string {
  return trXml.replace(/(<hp:cellSz width="\d+" height=")(\d+)(")/g, (_, a, h, c) => a + String(Math.max(Number(h), Math.round(min))) + c);
}

const rowHeight = (trXml: string): number => Number(/<hp:cellSz width="\d+" height="(\d+)"/.exec(trXml)?.[1] ?? 0);

export async function fillRecordHistoryHwpx(data: RecordHwpxData): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await loadTemplate());
  const section = zip.file(SECTION_PATH);
  if (!section) throw new Error(`이력사항 양식에 ${SECTION_PATH} 가 없습니다.`);
  const xml = await section.async("string");

  const tblStart = xml.indexOf("<hp:tbl");
  const tblEnd = xml.lastIndexOf("</hp:tbl>");
  const firstTr = xml.indexOf("<hp:tr>", tblStart);
  if (tblStart < 0 || tblEnd < 0 || firstTr < 0) throw new Error("이력사항 양식의 표를 찾을 수 없습니다.");
  const tblHead = xml.slice(tblStart, firstTr);
  const trs: string[] = [...(xml.slice(firstTr, tblEnd).match(TR_RE) ?? [])];
  if (trs.length <= ROW.project) throw new Error("이력사항 양식의 행 구성이 예상과 다릅니다.");

  const educations = data.educations.length ? data.educations : [{ years: "", school: "", major: "", degree: "" }];
  const projects = data.projects.length ? data.projects : [{ name: "", from: "", to: "", task: "", client: "", note: "" }];

  const rows: string[] = [
    fillRow(trs[ROW.name], { 1: [data.name], 8: [data.position] }),
    fillRow(trs[ROW.affiliation], { 1: [` ${data.affiliation}`] }),
    fillRow(trs[ROW.address], { 3: [` ${data.address}`] }),
    trs[3],
    ...educations.map((e) =>
      ensureRowHeight(
        fillRow(trs[ROW.education], { 0: [e.years], 1: [e.school], 5: [e.major], 8: [e.degree] }),
        Math.max(estimateLines(e.school, 12389), estimateLines(e.major, 12368)) * 1900 + 400
      )
    ),
    ensureRowHeight(fillRow(trs[ROW.career], { 1: [data.career], 8: data.licenses }), data.licenses.length * 1500 + 500),
    fillRow(trs[ROW.projectTitle], { 0: [`경           력(${data.projectScope})`] }),
    trs[7],
    ...projects.map((p) =>
      ensureRowHeight(
        fillRow(trs[ROW.project], {
          0: [p.name],
          2: p.from || p.to ? [p.from ? `${p.from}∼` : "", p.to] : ["", ""],
          6: [p.task],
          7: [p.client],
          9: [p.note],
        }),
        // 사업명(줄 간격 고정)·담당업무·발주처(줄 간격 180%) 중 가장 많이 차지하는 칸 기준
        Math.max(
          estimateLines(p.name, 14172) * 1900,
          estimateLines(p.task, 6348) * 2300,
          estimateLines(p.client, 9492) * 2300,
          estimateLines(p.note, 5860) * 2300
        ) + 400
      )
    ),
  ];

  // 행 주소·행 수·표 높이를 늘어난 행에 맞춘다(실제 높이는 한글·변환기가 내용으로 다시 잡는다)
  const body = rows
    .map((tr, i) => tr.replace(/(<hp:cellAddr colAddr="\d+" rowAddr=")\d+(")/g, `$1${i}$2`))
    .join("");
  const height = rows.reduce((acc, tr) => acc + rowHeight(tr), 0);
  const head = tblHead
    .replace(/rowCnt="\d+"/, `rowCnt="${rows.length}"`)
    .replace(/(<hp:sz width="\d+" widthRelTo="[A-Z]+" height=")\d+(")/, `$1${height}$2`);

  const next = (xml.slice(0, tblStart) + head + body + xml.slice(tblEnd)).replace(LINESEG_RE, "");
  zip.file(SECTION_PATH, next);

  // OPC 규약상 mimetype 은 무압축 보관
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
