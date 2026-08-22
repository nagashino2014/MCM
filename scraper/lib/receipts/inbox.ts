/**
 * 손으로 받은 전표 PDF 를 대장에 넣기 (import)
 *
 * 쿠팡은 로그인 화면이 봇 확인에 막혀 자동 수집을 접었다. 대신 일괄 신청 결과 페이지를
 * 사용자가 브라우저에서 PDF 로 저장하고(분기당 2장 남짓), 그 파일을 여기서 읽어 대장에 올린다.
 * 그러면 증빙 파일 위치와 품목·금액이 다른 네 몰과 같은 모양으로 남는다.
 *
 * 묶음 파일(한 PDF 에 전표 수십 장)은 **건별 1장짜리 PDF 로 물리 분리**한다 —
 * 카드 원장과 전표를 1:1 로 매칭하려면 원장 한 건이 자기 전표 파일 하나를 가리켜야 한다.
 * 원본 묶음은 receipts/<월>/bundles/ 에 보관만 한다(대장에는 분리본이 실린다).
 *
 * 흐름: data/receipts/<몰>/inbox/*.pdf → 페이지별 텍스트 → 전표 머리글로 건별 분리
 *       → 건별 PDF·TXT 저장 + 대장 기록(품목·금액·승인번호·카드끝4)
 */

import path from "node:path";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

import { ensureSiteDir, siteDir } from "./session";
import { loadSiteConfig, SiteConfig } from "./config";
import { appendLedger, loadCollectedKeys, LedgerRow } from "./ledger";
import { extractDocumentFields, extractPaymentFields, dateFromText } from "./parse";
import { extractPdfPages } from "./pdf-text";
import { safeName } from "./pdf";

interface ReceiptChunk {
  orderNo: string;
  text: string;
  /** 이 전표가 차지하는 페이지 범위(분리 가능할 때만; 0-기준, 양끝 포함) */
  pageFrom?: number;
  pageTo?: number;
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
 * 앞에 찍히든 뒤에 찍히든 한 덩어리로 묶이기 때문. 머리글 블록 중 주문번호가 없는 것(문서 제목 등)을
 * 버리고도 건수가 맞을 때만 그 경계를 믿고, 아니면 주문번호 위치로 자른다.
 *
 * 페이지 범위: 전표들이 서로 다른 페이지에서 시작하면(쿠팡 묶음: 페이지당 1장) 각 전표에
 * [시작 페이지, 다음 전표 시작 전 페이지] 를 붙인다 — 이 범위로 PDF 를 물리 분리한다.
 * 주문번호를 하나도 못 찾으면 빈 배열 — 호출부가 파일 단위로 한 줄만 남긴다.
 */
function splitByReceipt(pages: string[], cfg: SiteConfig): ReceiptChunk[] {
  const JOINER = "\n\n";
  const text = pages.join(JOINER);
  const pattern = cfg.orderNoPattern || "\\b\\d{12,16}\\b";
  const orderNos = [...new Set(text.match(new RegExp(pattern, "g")) || [])];

  if (orderNos.length === 0) return [];
  if (orderNos.length === 1) return [{ orderNo: firstOrderNo(text, pattern), text }];

  // ── 0순위: 페이지 단위 — 전표가 페이지마다 한 장씩 찍히는 묶음(쿠팡 뷰어)에서 가장 정확하다.
  // 아래 텍스트 기반 방법들은 경계를 추정하는데, 쿠팡은 거래일시·승인번호가 **주문번호보다 앞에**
  // 찍혀 있어 주문번호 위치로 자르면 옆 전표의 날짜·승인번호가 섞여 들어온다(실사고 2026-08).
  // 페이지가 곧 전표면 추정이 필요 없다.
  const byPage = splitByPage(pages, pattern, orderNos.length);
  if (byPage) return byPage;

  // 오프셋 → 페이지 번호 변환표
  const pageStarts: number[] = [];
  let acc = 0;
  for (const page of pages) {
    pageStarts.push(acc);
    acc += page.length + JOINER.length;
  }
  const pageOf = (offset: number): number => {
    let idx = 0;
    for (let i = 0; i < pageStarts.length; i++) if (pageStarts[i] <= offset) idx = i;
    return idx;
  };

  const attachPageRanges = (chunks: { orderNo: string; text: string; at: number }[]): ReceiptChunk[] => {
    const startPages = chunks.map((c) => pageOf(c.at));
    const distinct = new Set(startPages).size === chunks.length;

    return chunks.map((c, i) => {
      if (!distinct) return { orderNo: c.orderNo, text: c.text };
      return {
        orderNo: c.orderNo,
        text: c.text,
        pageFrom: startPages[i],
        pageTo: i + 1 < chunks.length ? startPages[i + 1] - 1 : pages.length - 1,
      };
    });
  };

  for (const keyword of cfg.receiptKeywords ?? []) {
    // 문서 제목에도 같은 말이 들어가 머리글이 한두 개 더 잡힐 수 있다. 주문번호가 없는 블록은
    // 전표가 아니므로 버리고, 그러고도 건수가 맞을 때만 이 경계를 믿는다.
    const marks = indexesOf(text, keyword);
    if (marks.length < orderNos.length) continue;

    const chunks = marks
      .map((at, i) => ({ at, text: text.slice(at, i + 1 < marks.length ? marks[i + 1] : text.length) }))
      .map((block) => ({ ...block, orderNo: firstOrderNo(block.text, pattern) }))
      .filter((c) => c.orderNo);

    if (chunks.length === orderNos.length) return attachPageRanges(chunks);
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

  return attachPageRanges(
    hits.map((hit, i) => ({
      orderNo: hit.orderNo,
      at: hit.at,
      // 첫 건은 문서 머리말(발급 안내 등)까지 함께 본다.
      text: text.slice(i === 0 ? 0 : hit.at, i + 1 < hits.length ? hits[i + 1].at : text.length),
    }))
  );
}

/**
 * 페이지 단위 분할.
 * 규칙: 주문번호가 정확히 1개인 페이지가 전표의 시작(같은 번호가 이어지면 같은 전표),
 * 주문번호 없는 페이지는 앞이면 표지(버림), 뒤면 직전 전표의 이어짐이다.
 * 한 페이지에 서로 다른 주문번호가 2개 이상이거나 건수가 안 맞으면 이 방법을 포기한다(null).
 */
function splitByPage(pages: string[], pattern: string, expected: number): ReceiptChunk[] | null {
  const chunks: Required<ReceiptChunk>[] = [];

  for (let i = 0; i < pages.length; i++) {
    const found = [...new Set(pages[i].match(new RegExp(pattern, "g")) || [])];
    if (found.length > 1) return null;

    const last = chunks[chunks.length - 1];
    if (found.length === 0) {
      // 표지/안내 페이지(앞) 또는 직전 전표의 이어짐(뒤)
      if (last) {
        last.text += "\n\n" + pages[i];
        last.pageTo = i;
      }
      continue;
    }

    if (last && last.orderNo === found[0]) {
      last.text += "\n\n" + pages[i];
      last.pageTo = i;
    } else {
      chunks.push({ orderNo: found[0], text: pages[i], pageFrom: i, pageTo: i });
    }
  }

  return chunks.length === expected ? chunks : null;
}

/** 원본 PDF 에서 페이지 범위만 뽑아 새 PDF 로 저장한다. */
async function extractPdfRange(src: PDFDocument, from: number, to: number, target: string): Promise<void> {
  const out = await PDFDocument.create();
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  fs.writeFileSync(target, await out.save());
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
    const pages = await extractPdfPages(source).catch((e) => {
      console.log(`${tag} ❌ ${name}: 텍스트를 읽지 못했습니다 — ${(e as Error).message}`);
      return [] as string[];
    });
    const text = pages.join("\n\n");

    if (!text.trim()) {
      console.log(`${tag}   스캔 이미지 PDF 이면 글자를 뽑을 수 없습니다. 파일은 그대로 두었습니다.`);
      skipped++;
      continue;
    }

    const chunks = splitByReceipt(pages, cfg);

    // 이미 다 들어가 있는 파일이면 옮기지 않는다 — 같은 PDF 가 receipts/ 아래에 겹쳐 쌓일 이유가 없다.
    const fresh = chunks.filter((c) => !collected.has(`${c.orderNo}::${label}`));
    if (chunks.length > 0 && fresh.length === 0) {
      console.log(`${tag} — ${name}: ${chunks.length}건 모두 이미 대장에 있습니다. 파일은 그대로 두었습니다.`);
      console.log(`${tag}   같은 파일을 다시 처리하려면(예: 날짜 재추출) ledger.csv 를 지우고 다시 실행하세요.`);
      skipped += chunks.length;
      continue;
    }

    const base = safeName(path.basename(name, path.extname(name)));
    const docDate = dateFromText(text);
    const docMonth = (docDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const collectedAt = new Date().toISOString();

    // ── 주문번호를 못 찾은 파일 — 통째로 한 줄 ─────────────────────
    if (chunks.length === 0) {
      const outDir = ensureSiteDir(site, path.join("receipts", docMonth));
      const target = path.join(outDir, `${base}.pdf`);
      const textPath = path.join(outDir, `${base}.txt`);

      if (opts.keep) fs.copyFileSync(source, target);
      else fs.renameSync(source, target);
      fs.writeFileSync(textPath, text, "utf-8");

      console.log(`${tag} ⚠ ${name}: 주문번호를 찾지 못해 파일 단위로 한 줄만 남깁니다.`);
      appendLedger(site, {
        site,
        orderNo: base,
        orderDate: docDate,
        title: "수동 가져오기",
        amount: "",
        receiptType: label,
        method: "manual-import",
        files: [target, textPath].map((f) => path.relative(siteDir(site), f)).join(" | "),
        collectedAt,
      });
      rows++;
      continue;
    }

    // ── 건별 분리 저장 ────────────────────────────────────────────
    // 전표마다 시작 페이지가 다르면(쿠팡: 페이지당 1장) 자기 페이지 범위를 갖고 있다 → 물리 분리.
    const splittable = chunks.length > 1 && chunks.every((c) => c.pageFrom !== undefined);
    let srcDoc: PDFDocument | null = null;
    if (splittable) {
      srcDoc = await PDFDocument.load(new Uint8Array(fs.readFileSync(source)), { ignoreEncryption: true });
    } else if (chunks.length > 1) {
      console.log(`${tag}   ⚠ 전표들이 페이지를 공유해 물리 분리는 건너뜁니다(모든 행이 묶음 파일을 가리킵니다).`);
    }

    // 분리가 안 되는 경우에 쓰는 공용(묶음) 파일 — 필요할 때 한 번만 만든다.
    let bundleFiles: string | null = null;
    const ensureBundle = (): string => {
      if (bundleFiles) return bundleFiles;
      const outDir = ensureSiteDir(site, path.join("receipts", docMonth));
      const target = path.join(outDir, `${base}.pdf`);
      const textPath = path.join(outDir, `${base}.txt`);
      fs.copyFileSync(source, target);
      fs.writeFileSync(textPath, text, "utf-8");
      bundleFiles = [target, textPath].map((f) => path.relative(siteDir(site), f)).join(" | ");
      return bundleFiles;
    };

    let added = 0;
    let filled = 0;
    let matched = 0;

    for (const chunk of fresh) {
      const fields = extractDocumentFields(chunk.text, cfg);
      const payment = extractPaymentFields(chunk.text);
      const orderDate = dateFromText(chunk.text) || docDate;
      const month = (orderDate || docDate || "unknown").slice(0, 7);

      let files: string;
      if (splittable && srcDoc) {
        const outDir = ensureSiteDir(site, path.join("receipts", month));
        const stem = safeName(`${orderDate || "nodate"}_${chunk.orderNo}_${label}`);
        const target = path.join(outDir, `${stem}.pdf`);
        const textPath = path.join(outDir, `${stem}.txt`);

        await extractPdfRange(srcDoc, chunk.pageFrom!, chunk.pageTo!, target);
        fs.writeFileSync(textPath, chunk.text, "utf-8");
        files = [target, textPath].map((f) => path.relative(siteDir(site), f)).join(" | ");
      } else {
        files = ensureBundle();
      }

      const row: LedgerRow = {
        site,
        orderNo: chunk.orderNo,
        orderDate,
        title: fields.title,
        amount: fields.amount,
        receiptType: label,
        method: "manual-import",
        files,
        collectedAt,
        approvalNum: payment.approvalNum,
        cardLast4: payment.cardLast4,
      };

      appendLedger(site, row);
      collected.add(`${chunk.orderNo}::${label}`);
      added++;
      if (fields.title || fields.amount) filled++;
      if (payment.approvalNum || payment.cardLast4) matched++;

      console.log(
        `${tag}   · ${chunk.orderNo} | ${orderDate || "날짜?"} | ${fields.amount || "-"} | ` +
          `승인 ${payment.approvalNum || "-"} | ${fields.title.slice(0, 24) || "-"}`
      );
    }

    rows += added;

    // 원본 묶음은 보관용으로 옮겨 둔다(분리본이 대장에 실렸다).
    if (splittable) {
      const keepDir = ensureSiteDir(site, path.join("receipts", docMonth, "bundles"));
      if (opts.keep) fs.copyFileSync(source, path.join(keepDir, `${base}.pdf`));
      else fs.renameSync(source, path.join(keepDir, `${base}.pdf`));
    } else if (!opts.keep) {
      fs.rmSync(source, { force: true });
    }

    const how = splittable ? `건별 PDF ${added}개로 분리` : "묶음 파일 참조";
    console.log(`${tag} ✅ ${name}: ${added}건 등록(품목·금액 ${filled}건, 매칭키 ${matched}건) — ${how}`);
    if (added > 0 && filled === 0) {
      console.log(`${tag}   품목·금액을 못 읽었습니다. 같은 이름의 .txt 를 열어 실제 문구를 확인해 주세요.`);
    }
  }

  console.log(`${tag} 가져오기 ${rows}건 / 건너뜀 ${skipped}건`);
  console.log(`${tag} 산출물: ${siteDir(site)}`);
  return { files: pdfs.length, rows, skipped };
}
