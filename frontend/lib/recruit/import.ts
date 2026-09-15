/**
 * 원본 채용공고(PDF/이미지) → 디자인 템플릿 자동 채움.
 *
 * 원칙: **템플릿 양식은 절대 훼손하지 않는다.** 디자인 트리의 구조·스타일은 그대로 두고,
 * (1) 텍스트 노드의 문구 교체, (2) 검증된 반복 항목 추가/삭제(addRepeatItem/removeRepeatItem)
 * 두 가지 조작만으로 내용을 채운다. LLM 은 "어느 슬롯을 어떤 문구로" 만 결정한다.
 *
 * 흐름: collectSlots(템플릿 트리) → LLM(원본 문서 + 슬롯 목록) → mapping JSON → applyMapping.
 */
import type { DocNode } from "./types";
import { addRepeatItem, findNode, findParent, removeRepeatItem, updateNodeText } from "./tree-ops";
import { anthropicChatJson, type ChatAttachment } from "@/lib/ai/llm-json";

export interface SlotSpec {
  /** 반복 그룹 밖의 단독 텍스트 슬롯(현재 문구 = 템플릿 예시). */
  texts: { id: string; text: string }[];
  /** 반복 그룹 — 항목마다 텍스트 배열(항목 내 텍스트 노드 순서). */
  groups: { id: string; items: string[][] }[];
}

export interface ImportMapping {
  texts?: Record<string, string>;
  groups?: Record<string, string[][]>;
}

const MAX_GROUP_ITEMS = 30;

function collectTextNodes(node: DocNode, out: DocNode[] = []): DocNode[] {
  if (node.tag === "#text") out.push(node);
  node.children?.forEach((c) => collectTextNodes(c, out));
  return out;
}

/** 템플릿 트리에서 LLM 에 보여줄 슬롯 목록을 뽑는다(그룹 항목 내부 텍스트는 그룹 쪽에만). */
export function collectSlots(tree: DocNode): SlotSpec {
  const texts: SlotSpec["texts"] = [];
  const groups: SlotSpec["groups"] = [];
  const seenGroups = new Set<string>();

  const walk = (node: DocNode) => {
    const children = node.children ?? [];
    for (const child of children) {
      if (child.repeatGroup && child.separator) continue; // 화살표 같은 구분자는 슬롯 아님
      if (child.repeatGroup) {
        if (!seenGroups.has(child.repeatGroup)) {
          seenGroups.add(child.repeatGroup);
          const items = children
            .filter((c) => c.repeatGroup === child.repeatGroup && !c.separator)
            .map((item) => collectTextNodes(item).map((t) => t.text ?? ""));
          groups.push({ id: child.repeatGroup, items });
        }
        continue;
      }
      if (child.tag === "#text") {
        const t = (child.text ?? "").trim();
        if (t) texts.push({ id: child.id, text: child.text ?? "" });
        continue;
      }
      walk(child);
    }
  };
  walk(tree);
  return { texts, groups };
}

/** 그룹의 현재 항목 노드들을 (부모 기준) 순서대로 다시 조회. */
function groupItems(tree: DocNode, groupId: string, anyItemId: string): DocNode[] {
  const parent = findParent(tree, anyItemId);
  if (!parent) return [];
  return (parent.children ?? []).filter((c) => c.repeatGroup === groupId && !c.separator);
}

function firstItemId(tree: DocNode, groupId: string): string | null {
  const stack: DocNode[] = [tree];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of n.children ?? []) {
      if (c.repeatGroup === groupId && !c.separator) return c.id;
      stack.push(c);
    }
  }
  return null;
}

/**
 * 매핑을 트리에 적용 — 텍스트 교체 + 그룹 항목 수 맞추기(부족분은 마지막 항목 복제, 초과분은 뒤에서 삭제).
 * 슬롯 id 가 트리에 없거나 형식이 어긋나면 그 항목만 건너뛴다(양식 안전 우선).
 */
export function applyMapping(tree: DocNode, spec: SlotSpec, mapping: ImportMapping): { tree: DocNode; applied: number } {
  let cur = tree;
  let applied = 0;

  for (const [id, text] of Object.entries(mapping.texts ?? {})) {
    if (typeof text !== "string") continue;
    const node = findNode(cur, id);
    if (!node || node.tag !== "#text") continue;
    if (node.text === text) continue;
    cur = updateNodeText(cur, id, text);
    applied++;
  }

  for (const group of spec.groups) {
    const desired = mapping.groups?.[group.id];
    if (!Array.isArray(desired) || desired.length === 0) continue;
    const wanted = desired.slice(0, MAX_GROUP_ITEMS).filter(Array.isArray);
    const seedId = firstItemId(cur, group.id);
    if (!seedId) continue;

    // 항목 수 맞추기
    let items = groupItems(cur, group.id, seedId);
    let guard = 0;
    while (items.length < wanted.length && guard++ < MAX_GROUP_ITEMS) {
      cur = addRepeatItem(cur, items[items.length - 1].id);
      items = groupItems(cur, group.id, seedId);
    }
    guard = 0;
    while (items.length > wanted.length && items.length > 1 && guard++ < MAX_GROUP_ITEMS) {
      cur = removeRepeatItem(cur, items[items.length - 1].id);
      items = groupItems(cur, group.id, seedId);
    }

    // 항목별 텍스트 채우기 — 템플릿 항목의 텍스트 노드 순서에 대응. 부족한 값은 기존 문구 유지.
    items.forEach((item, i) => {
      const values = wanted[i];
      if (!values) return;
      const textNodes = collectTextNodes(item);
      textNodes.forEach((t, k) => {
        const v = values[k];
        if (typeof v !== "string" || v === t.text) return;
        cur = updateNodeText(cur, t.id, v);
        applied++;
      });
    });
  }

  return { tree: cur, applied };
}

const SYSTEM_PROMPT = `당신은 채용공고 편집 어시스턴트입니다. 첨부된 원본 채용공고(문서/이미지/텍스트)의 내용을
주어진 디자인 템플릿의 텍스트 슬롯에 옮겨 적는 매핑 JSON 만 출력합니다.

규칙:
- 템플릿 구조는 바꿀 수 없습니다. 오직 슬롯의 문구 교체와 반복 그룹의 항목 수 조정만 가능합니다.
- "texts": 바꿀 슬롯만 {"슬롯id": "새 문구"} 로. 원본에 대응 정보가 없으면 그 슬롯은 생략(템플릿 문구 유지).
  단, 회사명·지사명·직무명처럼 템플릿 예시가 원본과 명백히 다른 문구는 반드시 교체합니다.
- "groups": 원본 내용에 맞춰 각 그룹의 **최종 항목 배열 전체**를 {"그룹id": [[...],[...]]} 로. 각 항목은
  템플릿 항목과 같은 개수의 문자열 배열이며 순서도 같습니다(예: ["STEP 1","입사지원"]). 항목 수는
  원본의 실제 항목 수에 맞추되, 원본에 해당 섹션이 없으면 그 그룹은 생략합니다.
- 라벨 성격의 텍스트("직무내용", "우대사항", "마감", "STEP 1", 섹션 제목 등)는 그대로 두고, 값 부분만 바꿉니다.
- 원본에 없는 사실을 지어내지 않습니다. 날짜·전화번호·주소는 원본 그대로 옮깁니다.
- 출력은 JSON 객체 하나만. 설명·코드펜스 없이.`;

export interface ImportSource {
  attachments: ChatAttachment[];
  /** PDF 텍스트 레이어 등 보조 텍스트(있으면 정확도 향상). */
  text?: string;
}

/** 원본 문서 + 템플릿 슬롯을 LLM 에 보내 매핑을 받는다. */
export async function requestMapping(
  spec: SlotSpec,
  source: ImportSource,
  ctx?: { userId?: string | null; templateId?: string }
): Promise<ImportMapping> {
  const user = [
    "## 템플릿 슬롯",
    JSON.stringify(spec),
    source.text ? `\n## 원본 공고 텍스트(보조)\n${source.text.slice(0, 20000)}` : "",
    "\n위 규칙에 따라 매핑 JSON 을 출력하세요.",
  ].join("\n");

  const mapping = await anthropicChatJson<ImportMapping>({
    feature: "recruit.import",
    model: "claude-opus-5",
    serverFallback: true,
    userId: ctx?.userId ?? null,
    subject: ctx?.templateId ? { type: "recruit_template", id: ctx.templateId } : null,
    system: SYSTEM_PROMPT,
    user,
    attachments: source.attachments,
    maxTokens: 16000,
    timeoutMs: 180_000,
  });
  if (!mapping || typeof mapping !== "object") throw new Error("매핑 결과가 비어 있습니다.");
  return mapping;
}
