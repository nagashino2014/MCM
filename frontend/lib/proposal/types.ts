import type { InfoSpec } from "@/lib/catalog/render/infographic/types";
import type { DiagramSpec } from "./diagrams/types";

// 제안서 문서 v2 — 원본 제안서 4종(포스코·서부·중부·수도권매립지)의 지면 어휘를 블록으로 옮겼다.
// 개조식 글머리·제목 3단·핵심 메시지·단계 띠·카드·단계 흐름·큰 숫자·일정표는 HWPX 에서 표 셀 조합으로 그려
// 한글에서 그대로 고칠 수 있다. 도식(figure·diagram)만 그림으로 넣고 편집 원본(spec)을 보관한다.
export type ProposalTemplateId = "permit-general" | "permit-power" | "permit-inspection" | "sustainability";
export type ProposalTheme = "navy" | "ocean" | "forest" | "slate" | "burgundy";
export type TableStyle = "grid" | "clean" | "form";
export type BulletMark = "note" | "result" | "check";

export interface BulletItem { level: 1 | 2 | 3; text: string; mark?: BulletMark }
export interface CardItem { title: string; body: string; key?: boolean; /** 항목 색 직접 지정(#rrggbb) — 다색일 때 */ color?: string }
export interface KpiItem { value: string; unit?: string; label: string }
export interface GanttTask { group?: string; label: string; start: number; end: number; tone?: "work" | "report" | "key"; marks?: number[] }

export type ProposalBlock =
  | { kind: "heading"; id: string; level: 1 | 2 | 3; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "bullets"; id: string; items: BulletItem[] }
  | { kind: "lead"; id: string; text: string; label?: string }
  | { kind: "callout"; id: string; variant: "note" | "point"; title: string; text: string }
  | { kind: "stage"; id: string; label: string; text: string }
  | { kind: "cards"; id: string; columns: 2 | 3 | 4; numbered: boolean; items: CardItem[]; multi?: boolean }
  | { kind: "steps"; id: string; items: CardItem[]; multi?: boolean }
  | { kind: "kpis"; id: string; items: KpiItem[] }
  | { kind: "table"; id: string; title: string; style: TableStyle; columns: string[]; rows: string[][]; widths?: number[]; firstCol?: boolean; note?: string }
  | { kind: "gantt"; id: string; title: string; periods: string[]; tasks: GanttTask[]; note?: string }
  | { kind: "figure"; id: string; title: string; spec: InfoSpec; widthMm: number; heightMm: number }
  | { kind: "diagram"; id: string; title: string; spec: DiagramSpec; widthMm: number; heightMm: number }
  | { kind: "image"; id: string; title: string; dataUrl: string; widthMm: number; heightMm: number };

export type ProposalBlockKind = ProposalBlock["kind"];

/** 한 섹션 = 한 지면(paged). chapter 는 장(Ⅰ·Ⅱ…), crumb 은 머리말 오른쪽과 목차에 쓰는 절 이름. */
export interface ProposalSection {
  id: string;
  title: string;
  pageId?: string;
  chapter?: string;
  crumb?: string;
  summary?: string;
  /** 새 문서를 만들 때의 원고 쪽 지문(lib/proposal/hash.ts) — 새 원고와 비교할 때 사용자가 고친 쪽을 가른다 */
  sourceHash?: string;
  blocks: ProposalBlock[];
}

export interface ProposalOptions {
  /** 발주처 주색(#rrggbb) — 있으면 테마 주색을 덮어쓴다 */
  brandColor?: string;
  cover: "modern" | "classic";
  /** 장 간지 쪽을 넣는다 */
  dividers: boolean;
  /** 목차 쪽 */
  toc: boolean;
  /** 도식 팔레트 — 없으면 calm(차분한 6색) */
  palette?: "calm" | "earth" | "mono";
}

export interface ProposalDocument {
  schemaVersion: 2;
  id: string;
  title: string;
  client: string;
  projectName: string;
  submissionDate: string;
  templateId: ProposalTemplateId;
  theme: ProposalTheme;
  layout?: "paged";
  contentVersion?: string;
  /** clientNotes — 발주처 메모(AI 수정의 참고 자료, 발행본 본문에는 쓰지 않음) */
  variables?: { siteName: string; duration: string; companyName: string; clientNotes?: string };
  options?: ProposalOptions;
  sections: ProposalSection[];
}
export interface SavedProposal { document: ProposalDocument; rev: number }
export interface ProposalSummary {
  id: string; title: string; client: string; projectName: string; templateId: ProposalTemplateId; rev: number; updatedAt: string;
}
export interface ProposalEdition { id: string; revision: number; fileName: string; createdAt: string; sizeBytes: number }

export const DEFAULT_OPTIONS: ProposalOptions = { cover: "modern", dividers: false, toc: true };
export const optionsOf = (doc: Pick<ProposalDocument, "options">): ProposalOptions => ({ ...DEFAULT_OPTIONS, ...doc.options });
