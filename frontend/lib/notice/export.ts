// 내부고시 HWPX 출력 — field_values → 흐름형 블록(lib/flowdoc). PDF(lib/notice/pdf.ts)와 같은 지면 구성:
// 공문 머리(로고·사명) → 문서번호/시행일자/수신/발신/제목 → 굵은 구분선 → 본문(첫 줄 들여쓰기) → 붙임
// → 날짜 → 사명 → 대표이사 이 유 억 (직인).

import { renderFlowHwpx } from "@/lib/flowdoc/hwpx";
import type { FlowBlock } from "@/lib/flowdoc/types";
import { parseLetterHtml } from "@/lib/letter/html-parse";
import { COMPANY_CEO, COMPANY_KO, type LetterBlock } from "@/lib/letter/types";
import { NOTICE_BODY_INDENT, formatNoticeDate, type NoticeFieldValues } from "./types";

const BODY_PT = 11;

function spread(name: string): string {
  const t = (name ?? "").trim();
  return /^[가-힣]{2,4}$/.test(t) ? t.split("").join(" ") : t;
}

function stripTrailingBlanks(blocks: LetterBlock[]): LetterBlock[] {
  let end = blocks.length;
  while (end > 0) {
    const b = blocks[end - 1];
    if (b.kind === "p" && !b.runs.map((r) => r.text).join("").trim()) end -= 1;
    else break;
  }
  return blocks.slice(0, end);
}

export function buildNoticeFlow(values: NoticeFieldValues, snap: { docNo: string | null; issueDate: string }): FlowBlock[] {
  const date = formatNoticeDate(snap.issueDate);
  const blocks: FlowBlock[] = [];
  // 머리 줄 — 라벨은 '문서번호'(4자) 폭에 맞춰 전각 공백으로 벌린다(공문 '수    신' 관행)
  const head = (label: string, value: string, boldValue = false): FlowBlock => ({
    kind: "p",
    sizePt: 10.5,
    runs: [{ text: `${label} : `, bold: true }, { text: value || "-", bold: boldValue }],
  });
  blocks.push({ kind: "p", runs: [{ text: "" }], sizePt: 6 });
  blocks.push(head("문서번호", snap.docNo ?? "(채번 예정)"));
  blocks.push(head("시행일자", date));
  blocks.push(head("수　　신", values.recipient_text));
  blocks.push(head("발　　신", values.sender_text));
  blocks.push(head("제　　목", values.subject, true));
  blocks.push({ kind: "rule" });

  for (const b of stripTrailingBlanks(parseLetterHtml(values.body_html ?? ""))) {
    if (b.kind === "table") {
      blocks.push({ kind: "table", table: b, sizePt: BODY_PT });
      continue;
    }
    const aligned = b.align === "center" || b.align === "right";
    blocks.push({
      kind: "p",
      runs: b.runs,
      sizePt: BODY_PT,
      align: b.align,
      leftPt: aligned ? 0 : b.indentPt ?? 0,
      indentPt: aligned ? 0 : NOTICE_BODY_INDENT,
    });
  }

  const attach = (values.attachments_list ?? []).map((a) => (a.text ?? "").trim()).filter(Boolean);
  attach.forEach((item, i) => {
    const text = attach.length > 1 ? `${i + 1}. ${item}` : item;
    // 항목 번호를 일렬종대로 — 첫 줄만 '붙  임 : ' 라벨을 내어쓰기로 두고 나머지는 같은 여백에서 시작
    blocks.push({
      kind: "p",
      sizePt: BODY_PT,
      leftPt: 22 + 44,
      indentPt: i === 0 ? -44 : 0,
      spaceBeforePt: i === 0 ? 14 : 0,
      runs: i === 0 ? [{ text: "붙  임 : ", bold: true }, { text }] : [{ text }],
    });
  });

  // 말미 여백 — PDF 와 같이 종전보다 30% 넓게(2026-09-22)
  blocks.push({ kind: "p", runs: [{ text: date }], align: "center", sizePt: BODY_PT, spaceBeforePt: 36 });
  blocks.push({ kind: "p", runs: [{ text: COMPANY_KO }], align: "center", sizePt: 15, bold: true, spaceBeforePt: 29 });
  blocks.push({ kind: "seal", text: `대표이사   ${spread(COMPANY_CEO)}`, sealText: "(직인)", sizePt: 15, stamp: values.stamp === 1, spaceBeforePt: 4 });
  return blocks;
}

export async function renderNoticeHwpx(values: NoticeFieldValues, snap: { docNo: string | null; issueDate: string }): Promise<Uint8Array> {
  return renderFlowHwpx(buildNoticeFlow(values, snap), { letterHead: true, pageNumbers: true });
}
