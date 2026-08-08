// 스캔·텍스트 PDF 로 받은 발주처 양식을 DeliverableSpec 으로 재구축한다(D4-5).
//
// HWPX 로 받은 양식은 원본을 그대로 두고 값만 주입하지만(template-fill.ts), 스캔 PDF 는
// 원본 구조가 없어 그 길이 막힌다. 그래서 문서를 읽어 우리 중간표현으로 **다시 그린다** —
// 서식이 근사치가 되는 건 어쩔 수 없고, 사용자가 편집기(D5)로 다듬는 것을 전제한다.
//
// 멀티모달 호출은 lib/ieps/business-certificate-llm.ts 패턴(type:"document" base64)을 따른다.

import { DELIVERABLE_BINDINGS, type DeliverableKind, type DeliverableSpec, type DocBlock } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.SCRAPER_ANALYZE_MODEL || "claude-sonnet-5";
const HIGH_MODEL = "claude-opus-5";

const BLOCK_KINDS = new Set([
  "note",
  "title",
  "fields",
  "table",
  "para",
  "dateLine",
  "signature",
  "receiver",
  "stampBox",
  "spacer",
]);

const str = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * amountBoth 는 "일금 …원정(₩… - VAT 별도)" 를 통째로 만들어 낸다.
 * 문서에 인쇄된 "(VAT별도)" 를 LLM 이 suffix 로 또 넣으면 같은 문구가 두 번 찍힌다 → 떼어낸다.
 * (프롬프트로도 막지만, 눈에 띄는 오출력이라 여기서 한 번 더 거른다.)
 */
function dedupeSuffix(format: string, suffix: string): string | undefined {
  if (!suffix) return undefined;
  if (format === "amountBoth" && /vat|부가세/i.test(suffix)) return undefined;
  return suffix;
}
const numOr = (v: unknown, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

function bindingCatalog(kind: DeliverableKind): string {
  return DELIVERABLE_BINDINGS.filter((b) => (kind === "start" ? b.group !== "준공" : true))
    .map((b) => `- ${b.key} (${b.label})`)
    .join("\n");
}

function buildPrompt(kind: DeliverableKind): string {
  const kindLabel = kind === "start" ? "착수계" : "준공계";
  return (
    `첨부한 PDF 는 발주처가 요구하는 ${kindLabel} 양식입니다(스캔본일 수 있습니다). ` +
    "이 문서를 아래 블록 구조로 **그대로 옮겨** JSON 으로 출력하세요. 우리 시스템이 이 구조로 문서를 다시 그립니다.\n\n" +
    "## 문서 구분\n" +
    "서식이 여러 장이면 docs 를 나눕니다. 각 서식은 {docType:\"custom:<영문슬러그>\", title, blocks}.\n" +
    "title 은 그 서식의 표제를 원문 그대로(자간 공백 포함).\n\n" +
    "## 블록 종류\n" +
    '- {"kind":"note","text":"[첨부 1]"} — 좌상단 표기\n' +
    '- {"kind":"title","text":"준 공 검 사 원","underline":true} — 표제(자간 공백 그대로)\n' +
    '- {"kind":"fields","numbering":"none|decimal|square","rows":[{"label":"계 약 명","binding":"contract.title"}]}\n' +
    "  · 라벨-값 목록. numbering: decimal=\"1. 2. 3.\", square=\"□\", none=번호 없음\n" +
    "  · label 은 인쇄된 그대로(자간 공백 보존). 값 자리는 binding 으로, 고정 문구는 text 로.\n" +
    '  · 값 뒤 고정 문구는 suffix("VAT포함" 등), 값이 두 줄이면 secondLine.\n' +
    '- {"kind":"table","columns":[{"widthRatio":0.2}],"rows":[[{"text":"구 분","bold":true},{"binding":"completion.curSupply"}]]}\n' +
    "  · widthRatio 합은 1. 병합은 colSpan/rowSpan, 병합에 가려지는 칸은 {\"merged\":true}.\n" +
    '- {"kind":"para","text":"위 용역의 …{{contract.title}}…"} — 본문 문구. 값은 {{바인딩}} 토큰으로.\n' +
    '- {"kind":"dateLine","binding":"issue.date","format":"dateSpaced","align":"center"} — 작성일 줄\n' +
    '- {"kind":"signature","rows":[{"label":"상 호","binding":"company.name"}],"stamp":true} — 서명란(인감 자리)\n' +
    '- {"kind":"receiver","binding":"orderer.name","suffix":"귀하"} — 맨 아래 수신처\n' +
    '- {"kind":"stampBox","label":"감독자 확인"} — 우상단 확인란\n' +
    '- {"kind":"spacer","heightPt":24} — 빈 여백\n\n' +
    "## 바인딩 키(값이 들어갈 자리)\n" +
    bindingCatalog(kind) +
    "\n\n## 규칙\n" +
    "1. **문서에 실제로 인쇄된 글자만** 쓰세요. 없는 항목을 지어내지 마세요.\n" +
    "2. 라벨의 자간 공백(\"계   약   명\")을 문자열 그대로 보존하세요 — 서식이 달라 보이면 안 됩니다.\n" +
    "3. 값이 들어갈 자리는 binding 으로, 대응 키가 없으면 \"custom:<영문키>\" 로 두세요(사용자가 채웁니다).\n" +
    "4. 이미 샘플 값이 인쇄돼 있어도 그 값을 text 로 넣지 말고 binding 으로 바꾸세요.\n" +
    '4-1. 금액 포맷 amountBoth 는 "일금 …원정(₩… - VAT 별도)" 를 통째로 만들어 냅니다. 문서에 "VAT 별도"·' +
    '"(VAT별도)" 표기가 보여도 suffix 에 다시 넣지 마세요 — 같은 문구가 두 번 찍힙니다.\n' +
    "5. 블록 순서는 문서에 나타난 순서 그대로.\n" +
    "6. 표는 행·열 수와 병합을 문서와 똑같이 맞추세요.\n" +
    "7. **여백을 spacer 로 표현하세요** — 원문에서 줄이 비어 있는 만큼 넣습니다. 특히 본문과 작성일 사이,\n" +
    "   작성일과 서명란 사이, 서명란과 수신처 사이에는 원문의 빈 줄만큼 spacer 를 반드시 넣으세요\n" +
    "   (heightPt 는 빈 줄 하나당 20 정도). 여백이 없으면 서명란에 수신처가 붙고 인감이 글자와 겹칩니다.\n" +
    "8. 전체가 A4 한 장에 자연스럽게 차도록 배치하세요.\n" +
    "9. 판단이 어려웠던 부분은 note 필드에 한국어로 한두 문장 남기세요.\n\n" +
    '## 출력(JSON만, 설명·코드블록 금지)\n{"docs":[{"docType":"","title":"","blocks":[]}],"note":""}'
  );
}

/** LLM 이 낸 블록을 우리 타입으로 정제 — 모르는 종류·빈 블록은 버린다. */
function sanitizeBlocks(raw: unknown): DocBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: DocBlock[] = [];
  for (const b of raw) {
    const o = (b ?? {}) as Record<string, unknown>;
    const kind = str(o.kind);
    if (!BLOCK_KINDS.has(kind)) continue;

    if (kind === "spacer") {
      out.push({ kind: "spacer", heightPt: numOr(o.heightPt, 12) });
      continue;
    }
    if (kind === "table") {
      const columns = (Array.isArray(o.columns) ? o.columns : []).map((c) => {
        const x = (c ?? {}) as Record<string, unknown>;
        return { widthRatio: numOr(x.widthRatio, 0), align: x.align as never };
      });
      const rows = (Array.isArray(o.rows) ? o.rows : []).map((r) =>
        (Array.isArray(r) ? r : []).map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return {
            text: str(x.text) || undefined,
            binding: str(x.binding) || undefined,
            format: x.format as never,
            align: x.align as never,
            bold: x.bold === true,
            colSpan: x.colSpan != null ? numOr(x.colSpan, 1) : undefined,
            rowSpan: x.rowSpan != null ? numOr(x.rowSpan, 1) : undefined,
            merged: x.merged === true,
          };
        })
      );
      if (!columns.length || !rows.length) continue;
      // 폭 비율 합이 1 이 되도록 보정(LLM 이 어림수를 내는 일이 잦다)
      const sum = columns.reduce((a, c) => a + (c.widthRatio || 0), 0);
      const cols = sum > 0 ? columns.map((c) => ({ ...c, widthRatio: c.widthRatio / sum })) : columns.map((c) => ({ ...c, widthRatio: 1 / columns.length }));
      out.push({ kind: "table", columns: cols, rows, caption: str(o.caption) || undefined });
      continue;
    }
    if (kind === "fields" || kind === "signature") {
      const rows = (Array.isArray(o.rows) ? o.rows : [])
        .map((r) => {
          const x = (r ?? {}) as Record<string, unknown>;
          const second = (x.secondLine ?? null) as Record<string, unknown> | null;
          return {
            label: str(x.label),
            binding: str(x.binding) || undefined,
            text: str(x.text) || undefined,
            format: x.format as never,
            suffix: dedupeSuffix(str(x.format), str(x.suffix)),
            secondLine: second
              ? {
                  binding: str(second.binding) || undefined,
                  text: str(second.text) || undefined,
                  format: second.format as never,
                  suffix: dedupeSuffix(str(second.format), str(second.suffix)),
                }
              : undefined,
          };
        })
        .filter((r) => r.label || r.binding || r.text);
      if (!rows.length) continue;
      if (kind === "signature") {
        out.push({ kind: "signature", rows, align: o.align as never, stamp: o.stamp !== false, indentPt: o.indentPt != null ? numOr(o.indentPt, 0) : undefined });
      } else {
        const numbering = ["none", "decimal", "square"].includes(str(o.numbering)) ? (str(o.numbering) as "none" | "decimal" | "square") : "none";
        out.push({
          kind: "fields",
          numbering,
          rows,
          labelWidthPt: o.labelWidthPt != null ? numOr(o.labelWidthPt, 0) : undefined,
          rowGapPt: o.rowGapPt != null ? numOr(o.rowGapPt, 0) : undefined,
          indentPt: o.indentPt != null ? numOr(o.indentPt, 0) : undefined,
        });
      }
      continue;
    }
    if (kind === "receiver") {
      const binding = str(o.binding) || "orderer.name";
      out.push({ kind: "receiver", binding, suffix: str(o.suffix) || "귀하", fontPt: o.fontPt != null ? numOr(o.fontPt, 0) : undefined, align: o.align as never, bold: o.bold === true });
      continue;
    }
    if (kind === "dateLine") {
      out.push({ kind: "dateLine", binding: str(o.binding) || "issue.date", format: (str(o.format) || "dateSpaced") as never, align: o.align as never });
      continue;
    }
    if (kind === "stampBox") {
      out.push({ kind: "stampBox", label: str(o.label), widthPt: o.widthPt != null ? numOr(o.widthPt, 0) : undefined, heightPt: o.heightPt != null ? numOr(o.heightPt, 0) : undefined });
      continue;
    }
    const text = str(o.text);
    if (!text) continue;
    if (kind === "title") {
      out.push({ kind: "title", text, fontPt: o.fontPt != null ? numOr(o.fontPt, 0) : undefined, letterSpacingPt: o.letterSpacingPt != null ? numOr(o.letterSpacingPt, 0) : undefined, underline: o.underline === true });
    } else if (kind === "note") {
      out.push({ kind: "note", text, align: o.align as never });
    } else {
      out.push({ kind: "para", text, align: o.align as never, indentPt: o.indentPt != null ? numOr(o.indentPt, 0) : undefined, lineHeightPct: o.lineHeightPct != null ? numOr(o.lineHeightPct, 0) : undefined });
    }
  }
  return out;
}

export interface ScanAnalysis {
  specs: DeliverableSpec[];
  note?: string;
  model: string;
}

/** 스캔 PDF 바이트 → DeliverableSpec[]. highQuality 면 고정밀 모델로 재분석한다. */
export async function analyzeTemplateScan(
  bytes: Uint8Array,
  kind: DeliverableKind,
  opts: { highQuality?: boolean } = {}
): Promise<ScanAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("양식 분석에 필요한 API 키가 설정돼 있지 않습니다.");

  const model = opts.highQuality ? HIGH_MODEL : MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 12000,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
              { type: "text", text: buildPrompt(kind) },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`양식 분석 API 오류 (HTTP ${res.status}) ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("양식 분석 결과를 해석하지 못했습니다.");
    const raw = JSON.parse(match[0]) as Record<string, unknown>;

    const docsRaw = Array.isArray(raw.docs) ? raw.docs : [];
    const specs: DeliverableSpec[] = docsRaw
      .map((d, i) => {
        const o = (d ?? {}) as Record<string, unknown>;
        const slug = str(o.docType);
        return {
          docType: slug.startsWith("custom:") ? slug : `custom:doc${i + 1}`,
          title: str(o.title) || `서식 ${i + 1}`,
          kind,
          blocks: sanitizeBlocks(o.blocks),
        };
      })
      .filter((s) => s.blocks.length > 0);

    if (!specs.length) throw new Error("양식에서 서식 구조를 읽지 못했습니다. 더 선명한 파일로 다시 시도해 주세요.");
    return { specs, note: str(raw.note) || undefined, model };
  } finally {
    clearTimeout(timer);
  }
}
