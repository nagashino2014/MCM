"use client";

// 스튜디오 오른쪽 패널 공용 형식 — 지금 쪽·선택·편집 조작.

import type { PagePlanItem } from "@/lib/catalog/render/components/plan";
import type { ComposedPage } from "@/lib/catalog/studio/compose";
import type { InfoOverride, ListOp } from "@/lib/catalog/studio/edits";
import type { CNode, ImageRef } from "@/lib/catalog/studio/nodes";
import type { Capabilities, Selection } from "@/lib/catalog/studio/select";
import type { StudioImageAsset } from "@/lib/catalog/studio/store";
import type { CheckItem } from "./checks";
import type { StudioKit } from "./kit";
import type { Studio } from "./useStudio";

export interface StudioOps {
  select: (id: string | null) => void;
  commitText: (id: string, children: CNode[]) => void;
  patchStyle: (id: string, patch: Record<string, string>) => void;
  setType: (id: string, step: string | null) => void;
  hide: (id: string) => void;
  unhide: (id: string) => void;
  reset: (id: string, parts?: Array<"content" | "style" | "type" | "hidden" | "info" | "image">) => void;
  setInfo: (id: string, info: InfoOverride | null, slot?: string) => void;
  setImage: (id: string, image: ImageRef | null) => void;
  listOp: (itemId: string, op: ListOp) => void;
  addElement: (kind: "text" | "shape" | "image", asset?: string) => void;
  /** 일러스트 넣기(313) — SVG 를 받아 등록한 뒤 쪽 위에 놓는다 */
  addIllustration: (assetId: string) => Promise<void>;
  /** 캔버스에서 고친 일러스트 글자 자리 → 그 인포그래픽 내용 */
  commitSlot: (slotNodeId: string, text: string) => void;
  setVariant: (key: string, value: string | null) => void;
  /** 사진 고르기 창 — 고르면 onPick */
  pickImage: (onPick: (key: string) => void) => void;
  /** 이 쪽 편집층에서 붙을 곳을 잃은 편집 지우기 */
  dropOrphans: () => void;
  /** 추가한 도형 모양 */
  setShape: (id: string, shape: "rect" | "round" | "circle" | "line") => void;
}

export interface PanelProps {
  studio: Studio;
  kit: StudioKit;
  item: PagePlanItem;
  composed: ComposedPage;
  sel: Selection | null;
  caps: Capabilities | null;
  ops: StudioOps;
  checks: CheckItem[];
  assets: StudioImageAsset[];
  /** [AI로 줄이기] — 넘친 요소(노드 id)를 줄인 제안을 검토 화면으로(P6) */
  onAiShrink?: (nodeIds: string[]) => void;
  /** 새 사업 분야 쪽 빼기(P6) */
  onRemoveCustomArea?: (areaId: string) => void;
}

/** 선택 종류 이름 */
export function selectionLabel(sel: Selection): string {
  const n = sel.node;
  if (sel.kind === "added") {
    if (n.className?.includes("kc-x-text")) return "추가한 글상자";
    if (n.className?.includes("kc-x-image")) return "추가한 이미지";
    return "추가한 도형";
  }
  if (sel.kind === "infographic") return "인포그래픽";
  if (sel.kind === "widget") return `데이터 영역 · ${WIDGET_LABEL[n.widget ?? ""] ?? n.widget}`;
  if (sel.kind === "image") return "사진·이미지";
  if (sel.kind === "list") return "목록";
  if (sel.kind === "item") return "목록 항목";
  if (sel.kind === "text") return "글";
  return "상자";
}

export const WIDGET_LABEL: Record<string, string> = {
  cases: "대표 실적",
  table: "표",
  people: "인물",
  org: "조직도",
  logos: "로고",
  credentials: "인증·등록",
  timeline: "연혁",
  chips: "업종",
  map: "지도",
};
