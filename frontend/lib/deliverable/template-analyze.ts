// 발주처 자체양식(HWPX) LLM 분석 — 양식의 어느 자리에 어떤 값이 들어가는지 매핑한다(D4).
//
// bid 의 lib/bid/form-analyze.ts 와 같은 골격이되 산출물이 다르다.
// bid 는 표 셀 좌표만 뽑지만 여기서는 **표 밖 문단도 값 자리**가 된다 —
// 착수계처럼 "□ 계 약 명 : …" 문단만으로 이뤄진 양식이 실재하기 때문이다.
//
// 문서를 재구축하지 않는 것이 요점이다. 원본 HWPX 는 그대로 두고 이 매핑으로 값만 주입하므로
// (template-fill.ts) 발주처 양식의 서식이 100% 보존된다.

import { anthropicChatJson } from "@/lib/ai/llm-json";
import { parseHwpx } from "./hwpx-doc";
import { outlineHwpx, serializeOutline, type FormOutline } from "./template-form";
import {
  DELIVERABLE_BINDINGS,
  type DeliverableKind,
  type FieldFormat,
  type TemplateDoc,
  type TemplateProfile,
  type TemplateSlot,
} from "./types";

const MODEL = process.env.SCRAPER_ANALYZE_MODEL || "claude-sonnet-5";
const BINDING_KEYS = new Set(DELIVERABLE_BINDINGS.map((b) => b.key));
const BINDING_FORMAT = new Map(DELIVERABLE_BINDINGS.map((b) => [b.key, b.format]));

function bindingCatalog(kind: DeliverableKind): string {
  return DELIVERABLE_BINDINGS.filter((b) => (kind === "start" ? b.group !== "준공" : true))
    .map((b) => `- ${b.key} (${b.label}${b.hint ? ` — ${b.hint}` : ""})`)
    .join("\n");
}

function buildPrompt(kind: DeliverableKind, serialized: string): string {
  const kindLabel = kind === "start" ? "착수계" : "준공계(준공검사원·정산동의서 등)";
  return (
    `다음은 발주처가 요구하는 ${kindLabel} 양식(HWPX)을 문단·표 좌표로 직렬화한 것입니다. ` +
    "이 양식의 **값이 들어갈 자리**를 찾아 아래 바인딩 키에 매핑하세요.\n" +
    "양식 자체를 다시 만드는 것이 아니라, 원본에 값을 채워 넣을 좌표를 찾는 작업입니다.\n\n" +
    "## 바인딩 키\n" +
    bindingCatalog(kind) +
    "\n\n## 매핑 규칙\n" +
    '1. 표 안의 값 자리는 target="cell" 로 {table,row,col} 을 지정합니다. ' +
    "라벨이 인쇄된 셀(예: '구 분', '공급가액' 같은 머리글)은 값 자리가 아니므로 매핑하지 마세요 — " +
    "그 라벨에 대응하는 **빈 셀 또는 샘플 값이 들어 있는 셀**이 대상입니다.\n" +
    '2. 표 밖 문단의 값 자리는 target="para" 로 {para} 를 지정하고, label 에 **값 앞에 인쇄된 라벨을 원문 그대로** ' +
    '적으세요(자간 공백 포함, 예: "계 약 명"). 주입할 때 그 라벨 뒤부터를 값으로 교체합니다. ' +
    "한 문단에 값이 하나만 있는 경우만 매핑하세요.\n" +
    '2-1. 값 **뒤**에 고정 문구가 붙는 자리(예: "한국동서발전 귀하" 의 "귀하", "…을 제출합니다" 등)는 ' +
    'suffix 에 그 문구를 원문 그대로 적으세요. 라벨이 없고 접미어만 있는 자리도 이렇게 매핑할 수 있습니다. ' +
    "label 과 suffix 가 둘 다 없으면 값 범위를 정할 수 없어 버려집니다.\n" +
    "3. 라벨만 있고 값이 비어 있어도 매핑 대상입니다(발주처가 빈 양식을 주는 경우가 많습니다).\n" +
    "4. 문서(서식)가 여러 장이면 docs 를 나누고, 각 docs 의 paraFrom/paraTo 에 그 서식이 차지하는 " +
    "문단 연번 구간을 적으세요(paraTo 는 포함하지 않는 끝). title 은 그 서식의 표제를 원문 그대로.\n" +
    "5. 대응하는 바인딩 키가 없으면 binding 을 \"custom:<간단한영문키>\" 로 만들고 label 에 양식 라벨을 그대로 쓰세요 " +
    "(사용자가 화면에서 직접 값을 채웁니다).\n" +
    "6. 자사 정보(상호·주소·대표자)와 발주처명, 작성일 서명란도 빠뜨리지 마세요.\n" +
    "7. 확신이 없어도 가장 그럴듯한 매핑을 내세요 — 사용자가 화면에서 보정합니다. " +
    "다만 값 자리가 아닌 것이 분명한 곳(안내 문구, 고정 문장)은 매핑하지 마세요.\n" +
    "8. 애매했던 판단이나 사용자가 확인해야 할 점은 note 에 한국어 한두 문장으로 적으세요.\n\n" +
    "## 출력(JSON만, 설명 금지)\n" +
    '{"docs":[{"docType":"custom:slug","title":"","paraFrom":0,"paraTo":0,' +
    '"slots":[{"target":"para","para":0,"binding":"","label":"","suffix":""},' +
    '{"target":"cell","table":0,"row":0,"col":0,"binding":"","label":""}]}],"note":""}\n\n' +
    "## 양식 직렬화\n" +
    serialized
  );
}

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * LLM 응답을 좌표 실체와 대조해 거른다 — 없는 문단·셀을 가리키는 매핑은 버린다.
 * 사용자가 화면에서 고친 매핑(D5)도 같은 검증을 태운다 — 좌표가 어긋난 채 저장되면
 * 주입 단계에서 조용히 빠져 버려 원인을 찾기 어렵다.
 */
export function sanitizeProfile(raw: unknown, outline: FormOutline, model: string): TemplateProfile {
  const root = (raw ?? {}) as Record<string, unknown>;
  const docsRaw = Array.isArray(root.docs) ? root.docs : [];
  const seen = new Set<string>();

  const docs: TemplateDoc[] = docsRaw.map((d, di) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const slots: TemplateSlot[] = (Array.isArray(o.slots) ? o.slots : [])
      .map((s): TemplateSlot | null => {
        const x = (s ?? {}) as Record<string, unknown>;
        const binding = String(x.binding ?? "").trim();
        const label = String(x.label ?? "").trim();
        if (!binding) return null;
        const format = (BINDING_FORMAT.get(binding) ?? undefined) as FieldFormat | undefined;
        if (x.target === "cell") {
          const table = int(x.table);
          const row = int(x.row);
          const col = int(x.col);
          if (table == null || row == null || col == null) return null;
          const t = outline.tables[table];
          if (!t || !t.cells.some((c) => c.row === row && c.col === col)) return null;
          return { target: "cell" as const, table, row, col, binding, label, format };
        }
        const para = int(x.para);
        if (para == null || !outline.paras[para]) return null;
        // 문단은 라벨(앞) 또는 접미어(뒤) 중 하나는 있어야 값 범위를 정할 수 있다.
        // 예외: 문단 전체가 값인 자리는 둘 다 없어도 되지만, 그런 문단은 고정 문구와 구분되지 않아 받지 않는다.
        const suffix = String(x.suffix ?? "").trim() || undefined;
        if (!label && !suffix) return null;
        return { target: "para" as const, para, binding, label, suffix, format };
      })
      .filter((s): s is TemplateSlot => s !== null)
      // 같은 자리에 두 번 매핑되면 앞의 것만 남긴다
      .filter((s) => {
        const key = s.target === "cell" ? `c${s.table}:${s.row}:${s.col}` : `p${s.para}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const slug = String(o.docType ?? "").trim();
    return {
      docType: slug.startsWith("custom:") ? slug : `custom:doc${di + 1}`,
      title: String(o.title ?? "").trim() || `서식 ${di + 1}`,
      paraFrom: int(o.paraFrom) ?? undefined,
      paraTo: int(o.paraTo) ?? undefined,
      slots,
    };
  });

  return {
    analyzedAt: new Date().toISOString(),
    model,
    docs: docs.filter((d) => d.slots.length > 0),
    note: String(root.note ?? "").trim() || undefined,
  };
}

export interface TemplateAnalysis {
  profile: TemplateProfile;
  outline: FormOutline;
}

/** HWPX 바이트 → 좌표 개요 + LLM 매핑(저장 없음). 검증·재분석이 같은 코어를 탄다. */
export async function analyzeTemplateHwpx(bytes: Uint8Array, kind: DeliverableKind): Promise<TemplateAnalysis> {
  const outline = outlineHwpx(await parseHwpx(bytes));
  if (!outline.paras.length) {
    throw new Error("양식에서 본문을 찾지 못했습니다. HWPX 파일인지 확인하세요.");
  }
  const raw = await anthropicChatJson<unknown>({
    user: buildPrompt(kind, serializeOutline(outline)),
    model: MODEL,
    maxTokens: 8000,
    timeoutMs: 180_000,
  });
  const profile = sanitizeProfile(raw, outline, MODEL);
  if (!profile.docs.length) {
    throw new Error("양식에서 값을 넣을 자리를 찾지 못했습니다. 화면에서 직접 지정해 주세요.");
  }
  return { profile, outline };
}

/** 매핑이 미지의 바인딩을 가리키는지 — UI 경고용. */
export function unknownBindings(profile: TemplateProfile): string[] {
  const out = new Set<string>();
  for (const doc of profile.docs) {
    for (const s of doc.slots) {
      if (!BINDING_KEYS.has(s.binding) && !s.binding.startsWith("custom:")) out.add(s.binding);
    }
  }
  return [...out];
}
