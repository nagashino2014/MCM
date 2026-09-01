// 공문 프레임 조립 — field_values(규약) + 문서 스냅샷 → LetterLayout(PDF·HWPX 공통 입력).
// 상단(일반/내용증명 분기)·본문 블록·붙임·하단(담당/시행/연락처)의 "무엇을 그릴지"만 확정하고,
// 좌표·서식은 렌더러(pdf.ts / hwpx.ts)가 담당한다.

import { parseLetterHtml } from "./html-parse";
import type { LetterBlock } from "./types";
import {
  COMPANY_ADDRESS,
  COMPANY_CEO,
  COMPANY_CONTACT_EMAIL,
  COMPANY_EN,
  COMPANY_KO,
  COMPANY_PHONE,
  type LetterFieldValues,
  type LetterLayout,
  type LetterRecipient,
} from "./types";

export interface LetterDocSnapshot {
  letterNo: string | null; // doc_no(미채번 시 null)
  drafterName: string | null;
  drafterPosition: string | null;
  issueDate?: string | null; // YYYY-MM-DD(기본: 오늘)
}

/** 수신처 표기 문자열 — 수신처=업체/기관(name). 백필(구조 {facilityName}) 하위호환. */
export function recipientText(list: LetterRecipient[]): string {
  return Array.from(
    new Set(list.map((r) => (r.name || r.facilityName || "").trim()).filter(Boolean))
  ).join(", ");
}

/** 참조란 표기 — "안전환경팀 변성욱 프로" 형식으로 개별 나열. */
export function refText(list: LetterRecipient[]): string {
  return list
    .map((r) => [r.deptName, r.name, r.title].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

/** 양식별 조회 표시용 요약(field_values.recipients_display 에 저장). */
export function recipientsDisplay(values: LetterFieldValues): string {
  const first = values.recipients[0];
  if (!first) return "";
  const head = (first.name || first.facilityName || "").trim();
  const extra = values.recipients.length - 1;
  return extra > 0 ? `${head} 외 ${extra}` : head;
}

function fmtIssueDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${y}. ${m}. ${d}.`;
}

const AMOUNT_RE = /^[₩$€¥]?\s*-?[\d,]+(\.\d+)?\s*(원|%)?$/;

/**
 * 본문 말미의 빈 문단 제거 — MailEditor 는 표 삽입 시 커서 이동용 빈 줄을 표 뒤에 자동으로
 * 붙이고, 편집 잔여 빈 줄도 말미에 남는다(사용자가 넣지 않은 공백). 붙임·서명줄과의 간격은
 * 렌더 규칙이 담당하므로 트레일링 빈 문단은 지면에서 제거한다.
 */
function stripTrailingBlanks(blocks: LetterBlock[]): LetterBlock[] {
  let end = blocks.length;
  while (end > 0) {
    const b = blocks[end - 1];
    if (b.kind === "p" && !b.runs.map((r) => r.text).join("").trim()) end -= 1;
    else break;
  }
  return blocks.slice(0, end);
}

/**
 * 본문 번호 항목(1. 2. 3. …) 사이 1줄 간격 강제(사용자 확정) — 에디터에서 빈 줄을 넣지
 * 않아도 번호 문단 앞에 빈 문단을 삽입한다(직전 블록이 이미 빈 문단이면 그대로).
 */
function ensureNumberedItemGaps(blocks: LetterBlock[]): LetterBlock[] {
  const out: LetterBlock[] = [];
  for (const b of blocks) {
    const isNumbered = b.kind === "p" && /^\s*\d+\.\s/.test(b.runs.map((r) => r.text).join(""));
    const prev = out[out.length - 1];
    const prevIsBlank = prev?.kind === "p" && !prev.runs.map((r) => r.text).join("").trim();
    if (isNumbered && out.length > 0 && !prevIsBlank) {
      out.push({ kind: "p", runs: [{ text: "" }] });
    }
    out.push(b);
  }
  return out;
}

/**
 * 표 셀 기본 정렬(공문 관행, 사용자 확정) — 에디터에서 정렬을 지정하지 않은 셀은
 * 첫 행(열 레이블)·일반 값 = 가운데, 금액/수치 = 오른쪽.
 */
function applyTableCellDefaults(blocks: LetterBlock[]): LetterBlock[] {
  for (const b of blocks) {
    if (b.kind !== "table") continue;
    b.rows.forEach((row, ri) => {
      for (const cell of row) {
        if (cell.align) continue;
        if (ri === 0) {
          cell.align = "center";
          continue;
        }
        const text = cell.lines.map((l) => l.map((r) => r.text).join("")).join("").trim();
        cell.align = AMOUNT_RE.test(text) ? "right" : "center";
      }
    });
  }
  return blocks;
}

export function composeLetter(values: LetterFieldValues, doc: LetterDocSnapshot): LetterLayout {
  const isoDate = doc.issueDate || new Date().toISOString().slice(0, 10);
  const layout: LetterLayout = {
    kind: values.letter_kind === "proof" ? "proof" : "general",
    letterNo: doc.letterNo,
    issueDate: fmtIssueDate(isoDate),
    subject: values.subject ?? "",
    bodyBlocks: applyTableCellDefaults(ensureNumberedItemGaps(stripTrailingBlanks(parseLetterHtml(values.body_html ?? "")))),
    attachItems: (values.attachments_list ?? [])
      .map((a) => (a.text ?? "").trim())
      .filter(Boolean),
    stamp: values.stamp === 1,
    contactName: doc.drafterName ?? "",
    contactPosition: doc.drafterPosition ?? "",
    contactPhone: values.contact_phone || COMPANY_PHONE,
    contactEmail: values.contact_email || COMPANY_CONTACT_EMAIL,
    includeAddress: values.include_address === 1,
    companyAddress: COMPANY_ADDRESS,
    ceoName: COMPANY_CEO,
    companyKo: COMPANY_KO,
    companyEn: COMPANY_EN,
    overrides: values.layout_overrides,
  };
  if (layout.kind === "proof") {
    layout.proofSender = values.proof_sender;
    layout.proofReceiver = values.proof_receiver;
  } else {
    layout.receiverText = recipientText(values.recipients ?? []);
    layout.refText = refText(values.cc_refs ?? []);
  }
  return layout;
}
