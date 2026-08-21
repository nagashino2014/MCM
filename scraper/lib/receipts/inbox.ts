/**
 * 손으로 받은 전표 PDF 를 대장에 넣기 (import)
 *
 * 쿠팡은 로그인 화면이 봇 확인에 막혀 자동 수집을 접었다. 대신 일괄 신청 결과 페이지를
 * 사용자가 브라우저에서 PDF 로 저장하고(분기당 2장 남짓), 그 파일을 여기서 읽어 대장에 올린다.
 * 그러면 증빙 파일 위치와 품목·금액이 다른 네 몰과 같은 모양으로 남는다.
 *
 * 흐름: data/receipts/<몰>/inbox/*.pdf  →  텍스트 추출 → 주문번호로 쪼개 대장 기록
 *       →  파일은 receipts/<YYYY-MM>/ 로 옮긴다(원본 옆에 .txt 도 남겨 enrich 가 다시 쓸 수 있게).
 */

import path from "node:path";
import fs from "node:fs";

import { ensureSiteDir, siteDir } from "./session";
import { loadSiteConfig, SiteConfig } from "./config";
import { appendLedger, loadCollectedKeys, LedgerRow } from "./ledger";
import { extractDocumentFields, dateFromText } from "./parse";
import { extractPdfText } from "./pdf-text";
import { safeName } from "./pdf";

interface OrderChunk {
  orderNo: string;
  text: string;
}

/**
 * 머리글이 나오는 모든 위치.
 * PDF 에서 뽑은 글자는 자간이 벌어져 "매 출 전 표" 로 읽히기도 해서 글자 사이 공백을 허용한다.
 */
function indexesOf(text: string, keyword: string): number[] {
  const pattern = keyword
    .split("")
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const re = new RegExp(pattern, "g");

  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function firstOrderNo(text: string, pattern: string): string {
  const m = new RegExp(pattern).exec(text);
  return m ? m[1] ?? m[0] : "";
}

/**
 * 한 파일에 여러 건이 들어 있는 묶음 전표를 건별로 쪼갠다.
 *
 * 건마다 반복되는 머리글("신용카드 매출전표" 등)이 가장 정확한 경계다 — 품목·금액이 주문번호
 * 앞에 찍히든 뒤에 찍히든 한 덩어리로 묶이기 때문. 머리글 개수와 주문번호 개수가 맞아떨어질 때만
 * 그 경계를 믿고, 아니면 주문번호 위치로 자른다.
 * 주문번호를 하나도 못 찾으면 빈 배열 — 호출부가 파일 단위로 한 줄만 남긴다.
 */
function splitByReceipt(text: string, cfg: SiteConfig): OrderChunk[] {
  const pattern = cfg.orderNoPattern || "\\b\\d{12,16}\\b";
  const orderNos = [...new Set((text.match(new RegExp(pattern, "g")) || []).map((v) => v))];

  if (orderNos.length === 0) return [];
  if (orderNos.length === 1) return [{ orderNo: firstOrderNo(text, pattern), text }];

  for (const keyword of cfg.receiptKeywords ?? []) {
    // 문서 제목에도 같은 말이 들어가 머리글이 한두 개 더 잡힐 수 있다. 주문번호가 없는 블록은
    // 전표가 아니므로 버리고, 그러고도 건수가 맞을 때만 이 경계를 믿는다.
    const marks = indexesOf(text, keyword);
    if (marks.length < orderNos.length) continue;

    const chunks = marks
      .map((at, i) => text.slice(at, i + 1 < marks.length ? marks[i + 1] : text.length))
      .map((block) => ({ orderNo: firstOrderNo(block, pattern), text: block }))
      .filter((c) => c.orderNo);

    if (chunks.length === orderNos.length) return chunks;
  }

  // 폴백 — 주문번호가 전표 머리 쪽에 있는 양식으로 보고 그 위치에서 자른다.
  const hits: { orderNo: string; at: number }[] = [];
  const seen = new Set<string>();
  const re = new RegExp(pattern, "g");
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const orderNo = m[1] ?? m[0];
    if (seen.has(orderNo)) continue;
    seen.add(orderNo);
    hits.push({ orderNo, at: m.index });
  }

  return hits.map((hit, i) => ({
    orderNo: hit.orderNo,
    // 첫 건은 문서 머리말(발급 안내 등)까지 함께 본다.
    text: text.slice(i === 0 ? 0 : hit.at, i + 1 < hits.length ? hits[i + 1].at : text.length),
  }));
}

export async function importInbox(
  site: string,
  opts: { keep?: boolean } = {}
): Promise<{ files: number; rows: number; skipped: number }> {
  const cfg = loadSiteConfig(site);
  const tag = `[${site}]`;

  const inbox = ensureSiteDir(site, "inbox");
  const pdfs = fs
    .readdirSync(inbox)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (pdfs.length === 0) {
    console.log(`${tag} 가져올 PDF 가 없습니다.`);
    console.log(`${tag} 이 폴더에 전표 PDF 를 넣고 다시 실행하세요: ${inbox}`);
    return { files: 0, rows: 0, skipped: 0 };
  }

  const label = cfg.receiptLabel ? `${cfg.receiptLabel}(수동)` : "전표(수동)";
  const collected = loadCollectedKeys(site);
  let rows = 0;
  let skipped = 0;

  for (const name of pdfs) {
    const source = path.join(inbox, name);
    const text = await extractPdfText(source).catch((e) => {
      console.log(`${tag} ❌ ${name}: 텍스트를 읽지 못했습니다 — ${(e as Error).message}`);
      return "";
    });

    if (!text.trim()) {
      console.log(`${tag}   스캔 이미지 PDF 이면 글자를 뽑을 수 없습니다. 파일은 그대로 두었습니다.`);
      skipped++;
      continue;
    }

    const chunks = splitByReceipt(text, cfg);

    // 이미 다 들어가 있는 파일이면 옮기지 않는다 — 같은 PDF 가 receipts/ 아래에 겹쳐 쌓일 이유가 없다.
    const fresh = chunks.filter((c) => !collected.has(`${c.orderNo}::${label}`));
    if (chunks.length > 0 && fresh.length === 0) {
      console.log(`${tag} — ${name}: ${chunks.length}건 모두 이미 대장에 있습니다. 파일은 그대로 두었습니다.`);
      skipped += chunks.length;
      continue;
    }

    const base = safeName(path.basename(name, path.extname(name)));
    const docDate = dateFromText(text);
    const month = (docDate || new Date().toISOString().slice(0, 10)).slice(0, 7);

    // 파일을 먼저 옮겨야 대장에 적을 상대경로가 정해진다.
    const outDir = ensureSiteDir(site, path.join("receipts", month));
    const target = path.join(outDir, `${base}.pdf`);
    const textPath = path.join(outDir, `${base}.txt`);

    if (opts.keep) fs.copyFileSync(source, target);
    else fs.renameSync(source, target);
    fs.writeFileSync(textPath, text, "utf-8");

    const files = [target, textPath].map((f) => path.relative(siteDir(site), f)).join(" | ");
    const collectedAt = new Date().toISOString();

    if (chunks.length === 0) {
      console.log(`${tag} ⚠ ${name}: 주문번호를 찾지 못해 파일 단위로 한 줄만 남깁니다.`);
      appendLedger(site, {
        site,
        orderNo: base,
        orderDate: docDate,
        title: "수동 가져오기",
        amount: "",
        receiptType: label,
        method: "manual-import",
        files,
        collectedAt,
      });
      rows++;
      continue;
    }

    let added = 0;
    let filled = 0;

    for (const chunk of fresh) {
      const key = `${chunk.orderNo}::${label}`;
      const fields = extractDocumentFields(chunk.text, cfg);
      const row: LedgerRow = {
        site,
        orderNo: chunk.orderNo,
        orderDate: dateFromText(chunk.text) || docDate,
        title: fields.title,
        amount: fields.amount,
        receiptType: label,
        method: "manual-import",
        files,
        collectedAt,
      };

      appendLedger(site, row);
      collected.add(key);
      added++;
      if (fields.title || fields.amount) filled++;
    }

    rows += added;
    console.log(`${tag} ✅ ${name}: ${added}건 등록(품목·금액 ${filled}건) → ${path.relative(siteDir(site), target)}`);
    if (added > 0 && filled === 0) {
      console.log(`${tag}   품목·금액을 못 읽었습니다. ${path.basename(textPath)} 를 열어 실제 문구를 확인해 주세요.`);
    }
  }

  console.log(`${tag} 가져오기 ${rows}건 / 건너뜀 ${skipped}건`);
  console.log(`${tag} 산출물: ${siteDir(site)}`);
  return { files: pdfs.length, rows, skipped };
}
