// 물리 쪽 구성 — 표지·목차·간지·본문의 순서와 쪽 번호. 미리보기와 HWPX 가 같은 계산을 쓴다.
// 쪽 번호는 목차 다음 쪽(간지 포함)부터 1. 표지·목차·간지는 번호를 숨긴다(원본 4종 관례).
import { chaptersOf } from "./design";
import { optionsOf, type ProposalDocument } from "./types";

export type PhysicalPage =
  | { kind: "cover" }
  | { kind: "toc" }
  | { kind: "divider"; chapter: number; pageNo: number }
  | { kind: "body"; section: number; chapter: number; pageNo: number };

export interface TocEntry { level: 1 | 2; roman?: string; label: string; pageNo: number }

/** 표지·간지 글줄 — 미리보기와 HWPX 가 같은 크기·앞 간격(pt)으로 흘려 놓는다(배경 그림 위의 편집 가능한 글). */
export interface FlowLine { key: string; text: string; size: number; bold?: boolean; tone: "p1" | "ink" | "ink2" | "mu" | "white" | "tint"; before: number; inset?: number; align?: "left" | "center" }
export function coverLines(doc: ProposalDocument): FlowLine[] {
  const v = optionsOf(doc).cover;
  const date = doc.submissionDate.replace(/-/g, ". ");
  const co = doc.variables?.companyName || "";
  const site = doc.variables?.siteName || "";
  if (v === "classic") {
    return [
      { key: "client", text: doc.client, size: 14, bold: true, tone: "ink2", before: 120, align: "center" },
      { key: "title", text: doc.title, size: 25, bold: true, tone: "p1", before: 16, align: "center" },
      { key: "projectName", text: doc.projectName, size: 15, tone: "ink", before: 24, align: "center" },
      { key: "siteName", text: site, size: 11, tone: "mu", before: 8, align: "center" },
      { key: "submissionDate", text: date, size: 13, bold: true, tone: "ink2", before: 170, align: "center" },
      { key: "companyName", text: co, size: 17, bold: true, tone: "p1", before: 120, align: "center" },
    ];
  }
  return [
    { key: "client", text: doc.client, size: 13, bold: true, tone: "ink2", before: 82 },
    { key: "title", text: doc.title, size: 26, bold: true, tone: "p1", before: 12, inset: 53 },
    { key: "projectName", text: doc.projectName, size: 14, tone: "ink", before: 22, inset: 73 },
    { key: "siteName", text: site, size: 11, tone: "mu", before: 6 },
    { key: "submissionDate", text: date, size: 12, bold: true, tone: "ink2", before: 110 },
    { key: "companyName", text: co, size: 16, bold: true, tone: "p1", before: 230 },
  ];
}
export function dividerLines(roman: string, name: string, crumbs: string[]): FlowLine[] {
  return [
    { key: "eyebrow", text: `PART ${roman}`, size: 11, bold: true, tone: "tint", before: 90 },
    { key: "name", text: name, size: 24, bold: true, tone: "white", before: 128, inset: 60 },
    ...crumbs.map((c, i): FlowLine => ({ key: `crumb${i}`, text: `${String(i + 1).padStart(2, "0")}   ${c}`, size: 11.5, tone: "ink", before: i === 0 ? 185 : 9 })),
  ];
}

export function physicalPages(doc: ProposalDocument): PhysicalPage[] {
  const opts = optionsOf(doc);
  const chapters = chaptersOf(doc);
  const pages: PhysicalPage[] = [{ kind: "cover" }];
  if (opts.toc) pages.push({ kind: "toc" });
  let no = 0;
  doc.sections.forEach((s, i) => {
    const ci = chapters.findIndex((c) => c.name === s.chapter?.trim());
    if (opts.dividers && ci >= 0 && chapters[ci].first === i) pages.push({ kind: "divider", chapter: ci, pageNo: ++no });
    pages.push({ kind: "body", section: i, chapter: ci, pageNo: ++no });
  });
  return pages;
}

/** 목차 — 장(로마 숫자)과 절(crumb, 없으면 쪽 제목). 같은 절이 이어지면 첫 쪽만. */
export function tocEntries(doc: ProposalDocument): TocEntry[] {
  const chapters = chaptersOf(doc);
  const pages = physicalPages(doc);
  const out: TocEntry[] = [];
  let lastCrumb = "";
  let lastChapter = -2;
  for (const p of pages) {
    if (p.kind === "divider") { out.push({ level: 1, roman: chapters[p.chapter].roman, label: chapters[p.chapter].name, pageNo: p.pageNo }); lastChapter = p.chapter; continue; }
    if (p.kind !== "body") continue;
    const s = doc.sections[p.section];
    if (p.chapter !== lastChapter) {
      if (p.chapter >= 0) out.push({ level: 1, roman: chapters[p.chapter].roman, label: chapters[p.chapter].name, pageNo: p.pageNo });
      lastChapter = p.chapter; lastCrumb = "";
    }
    const crumb = (s.crumb || "").trim();
    if (crumb && crumb !== lastCrumb) { out.push({ level: 2, label: crumb, pageNo: p.pageNo }); lastCrumb = crumb; }
  }
  return out;
}
