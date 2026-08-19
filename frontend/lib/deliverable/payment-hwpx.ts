// 대금청구서 HWPX 렌더러 — 실물(2026-대외-01032 동봉본)을 한컴에서 저장한 원본에
// {{토큰}}만 심은 템플릿(public/hwpx/payment.hwpx)을 값으로 치환한다.
// 재구축(spec) 근사가 원본 레이아웃을 재현하지 못한다는 사용자 피드백(2026-08-19)으로
// 준공 3종(hwpx.ts)과 같은 "원본이 곧 템플릿" 방식을 쓴다 — 서식(표 선·정렬·인감 좌표)이
// 실물 그대로이고, PDF 는 renderHwpxToPdf 가 같은 파일의 lineseg 좌표를 옮겨 그린다.
//
// ⚠ 인감은 종이 절대좌표(PAPER) — 청구인(자사 고정)이라 값 길이 변화가 거의 없어 안전하다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parseYmd, renderTemplate } from "./format";
import { compactAddress, shortenSido } from "./hwpx";
import type { DeliverableValues } from "./types";

const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;

function escapeXml(v: string): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 원본 표기 "2026.  07.  17." — 점 뒤 2칸, 0 패딩(dateDotted 와 다른 실측 간격). */
function dateWide(raw: unknown): string {
  const p = parseYmd(raw);
  return p ? `${p.y}.  ${p.m}.  ${p.d}.` : String(raw ?? "");
}

/**
 * 주소 2줄 분배 — 원본이 "서울시 금천구 …"(1줄) + "에이스골드타워 12층"(2줄) 구조다.
 * 값이 한 줄에 들어가면 1줄만 쓰고 2줄은 비운다(문단은 남겨 셀 높이 유지).
 * 실측 1줄 폭 ≈ 원본 첫 줄(공백 포함 31자 폭) — 넉넉히 34폭에서 자른다.
 */
function splitAddress(addr: string): [string, string] {
  const a = shortenSido((addr ?? "").trim());
  const width = (s: string) => [...s].reduce((n, ch) => n + (/[\x00-\x7F]/.test(ch) ? 1 : 2), 0);
  if (width(a) <= 46) return [a, ""];
  const words = a.split(/\s+/);
  let first = "";
  for (const w of words) {
    const cand = first ? `${first} ${w}` : w;
    if (width(cand) > 46) break;
    first = cand;
  }
  const rest = a.slice(first.length).trim();
  if (!rest) return [a, ""];
  // 그래도 넘치면 축약 표기(건물명 제거)로 한 줄에 앉힌다
  return first ? [first, rest] : [compactAddress(a), ""];
}

let cached: Buffer | null = null;
async function loadTemplate(): Promise<Buffer> {
  if (cached) return cached;
  cached = await readFile(path.join(process.cwd(), "public", "hwpx", "payment.hwpx"));
  return cached;
}

/**
 * 대금청구서 HWPX 생성. keepLineSeg=true 는 PDF 렌더(renderHwpxToPdf)용 —
 * 배포본은 좌표를 지워 한글이 다시 배치하게 둔다(hwpx.ts 와 동일 규칙).
 */
export async function renderPaymentHwpx(values: DeliverableValues, opts: { keepLineSeg?: boolean } = {}): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await loadTemplate());
  const sectionPath = "Contents/section0.xml";
  const entry = zip.file(sectionPath);
  if (!entry) throw new Error("payment.hwpx 템플릿에 section0.xml 이 없습니다.");
  let xml = await entry.async("string");
  if (!opts.keepLineSeg) xml = xml.replace(LINESEG_RE, "");

  const [addr1, addr2] = splitAddress(String(values["company.address"] ?? ""));
  const specials: Record<string, string> = {
    __ADDR1__: addr1,
    __ADDR2__: addr2,
    __CEO__: String(values["company.ceo"] ?? "")
      .trim()
      .split("")
      .join(" "), // 원본 표기 "이 유 억"
    __DATE__: dateWide(values["issue.date"]),
    // 청구 항목 표기 — 계약관리 대금지급단계 명칭(준공금·잔금 등). 값이 없으면 실물 관행.
    __STAGE__: String(values["meta.stageLabel"] ?? "").trim() || "준공 기성금",
  };
  // hp:t 안의 토큰만 치환한다 — 값은 XML 이스케이프.
  xml = xml.replace(/\{\{\s*(__\w+__)\s*\}\}/g, (_all, key: string) => escapeXml(specials[key] ?? ""));
  xml = xml.replace(/\{\{[^}]+\}\}/g, (token) => escapeXml(renderTemplate(token, values)));

  zip.file(sectionPath, xml);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
