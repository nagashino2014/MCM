/**
 * 2단계: 문서 상세·첨부 전량 반출
 * - 문서 1건당 `data/daou/docs/{docId}/` 아래에 저장:
 *     detail.json  상세 API 원본(본문 HTML·결재선·의견·첨부 메타 포함)
 *     print.html   인쇄용 HTML(결재 도장·결재선이 렌더된 보존용 원본)
 *     files/*      첨부 원본
 *     done.json    완료 표식(재실행 시 skip 기준)
 * - 중단·재실행하면 done.json 이 있는 문서는 건너뛴다.
 *
 * 첨부 다운로드 URL(실측): GET /gw/api/approval/document/{docId}/download/{attachId}
 */

import path from "node:path";
import fs from "node:fs";
import { APIRequestContext } from "playwright";

import { DAOU_DIR, ensureDaouDir } from "./session";
import { openDaouApi, fetchDocDetail, fetchPrintHtml, DocListItem, DaouApi } from "./client";

const LIST_FILE = path.join(DAOU_DIR, "documents.jsonl");
const DOCS_DIR = path.join(DAOU_DIR, "docs");
const FAILED_FILE = path.join(DAOU_DIR, "failed.jsonl");

export interface FetchOptions {
  concurrency?: number;
  withPrint?: boolean;
  limit?: number;
  /** 완료 표식이 있어도 첨부가 부족한 문서를 다시 받는다 */
  fixAttach?: boolean;
}

/** done.json 기준 첨부가 부족한 문서인지 */
function isAttachShort(docId: string): boolean {
  const donePath = path.join(docDir(docId), "done.json");
  if (!fs.existsSync(donePath)) return false;
  try {
    const d = JSON.parse(fs.readFileSync(donePath, "utf-8"));
    return (d.attachExpected || 0) > (d.attachSaved || 0);
  } catch {
    return false;
  }
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 150);
}

function docDir(docId: string): string {
  return path.join(DOCS_DIR, docId);
}

function isDone(docId: string): boolean {
  return fs.existsSync(path.join(docDir(docId), "done.json"));
}

function loadDocIds(): DocListItem[] {
  if (!fs.existsSync(LIST_FILE)) {
    throw new Error("documents.jsonl 이 없습니다. 먼저 list 를 실행하세요.");
  }
  const seen = new Set<string>();
  const out: DocListItem[] = [];
  for (const line of fs.readFileSync(LIST_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const d = JSON.parse(line) as DocListItem;
    if (seen.has(d.documentId)) continue;
    seen.add(d.documentId);
    out.push(d);
  }
  return out;
}

/** 401(AccessToken 만료) 이면 토큰을 갱신하고 한 번 더 시도한다 */
async function withAuthRetry<T>(handle: DaouApi, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!/HTTP 401/.test(String(err))) throw err;
    await handle.refresh();
    return fn();
  }
}

/** 문서 1건 반출 */
async function fetchOne(
  handle: DaouApi,
  item: DocListItem,
  opts: Required<Pick<FetchOptions, "withPrint">>
): Promise<{ attachOk: number; attachFail: number }> {
  const api = handle.api;
  const dir = docDir(item.documentId);
  fs.mkdirSync(dir, { recursive: true });

  const detail: any = await withAuthRetry(handle, () => fetchDocDetail(api, item.documentId));
  fs.writeFileSync(path.join(dir, "detail.json"), JSON.stringify(detail, null, 2), "utf-8");

  if (opts.withPrint) {
    const html = await withAuthRetry(handle, () => fetchPrintHtml(api, item.documentId));
    if (html) fs.writeFileSync(path.join(dir, "print.html"), html, "utf-8");
  }

  // 첨부
  const attaches: any[] = detail?.data?.document?.attaches || [];
  let attachOk = 0;
  let attachFail = 0;

  if (attaches.length) {
    const filesDir = path.join(dir, "files");
    fs.mkdirSync(filesDir, { recursive: true });

    for (const att of attaches) {
      const target = path.join(filesDir, `${att.id}_${safeName(att.name || "attach")}`);
      // 이미 받은 파일은 크기가 맞으면 skip
      if (fs.existsSync(target) && (!att.size || fs.statSync(target).size === att.size)) {
        attachOk++;
        continue;
      }
      try {
        const buf = await withAuthRetry(handle, async () => {
          const res = await api.get(`/gw/api/approval/document/${item.documentId}/download/${att.id}`, {
            timeout: 120_000,
          });
          if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
          return res.body();
        });
        if (!buf.length) throw new Error("빈 파일");
        fs.writeFileSync(target, buf);
        attachOk++;
      } catch (err) {
        attachFail++;
        fs.appendFileSync(
          FAILED_FILE,
          JSON.stringify({
            type: "attach",
            docId: item.documentId,
            attachId: att.id,
            name: att.name,
            error: String(err),
            at: new Date().toISOString(),
          }) + "\n",
          "utf-8"
        );
      }
    }
  }

  fs.writeFileSync(
    path.join(dir, "done.json"),
    JSON.stringify(
      {
        docId: item.documentId,
        docNum: item.docNum,
        formName: item.formName,
        title: item.title,
        drafterName: item.drafterName,
        draftedAt: item.draftedAt,
        docStatus: item.docStatus,
        attachExpected: item.attachCount,
        attachSaved: attachOk,
        attachFailed: attachFail,
        fetchedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  return { attachOk, attachFail };
}

export async function fetchDocs(baseUrl: string, opts: FetchOptions = {}): Promise<void> {
  ensureDaouDir();
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const concurrency = opts.concurrency || 5;
  // 인쇄 팝업은 SPA 셸(내용 없음)로 실측됐다 → 기본 미수집. 본문·결재선은 detail.json 이 원본.
  const withPrint = opts.withPrint === true;

  const all = loadDocIds();
  const pending = all.filter((d) => !isDone(d.documentId) || (opts.fixAttach && isAttachShort(d.documentId)));
  const todo = opts.limit ? pending.slice(0, opts.limit) : pending;

  console.log(`[DAOU] 전체 ${all.length}건 / 대상 ${pending.length}건${opts.fixAttach ? " (첨부 부족 재시도 포함)" : ""}`);
  console.log(`[DAOU] 이번 실행 대상 ${todo.length}건 (동시 ${concurrency}, 인쇄HTML ${withPrint ? "포함" : "제외"})`);

  if (!todo.length) {
    console.log("[DAOU] 새로 받을 문서가 없습니다.");
    return;
  }

  const handle = await openDaouApi(baseUrl);
  const startedAt = Date.now();
  let done = 0;
  let failed = 0;
  let attachTotal = 0;
  let attachFailTotal = 0;
  let cursor = 0;
  let consecutiveFail = 0;
  let aborted = false;

  async function worker(): Promise<void> {
    while (cursor < todo.length && !aborted) {
      const item = todo[cursor++];
      try {
        const r = await fetchOne(handle, item, { withPrint });
        attachTotal += r.attachOk;
        attachFailTotal += r.attachFail;
        consecutiveFail = 0;
      } catch (err) {
        failed++;
        consecutiveFail++;
        fs.appendFileSync(
          FAILED_FILE,
          JSON.stringify({ type: "doc", docId: item.documentId, error: String(err), at: new Date().toISOString() }) + "\n",
          "utf-8"
        );
        // 세션이 완전히 죽으면 남은 전량을 헛돌며 실패시키지 말고 즉시 중단한다.
        if (consecutiveFail >= 20) {
          aborted = true;
          console.log(`\n[DAOU] ❌ 연속 ${consecutiveFail}건 실패 — 중단합니다. 마지막 오류: ${err}`);
          console.log("[DAOU] 세션이 만료됐을 수 있습니다. 'npm run daou -- probe --url <주소>' 로 다시 로그인 후 재실행하세요(이어받기 됩니다).");
        }
      }
      done++;

      if (done % 50 === 0 || done === todo.length) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = done / elapsed;
        const eta = rate > 0 ? Math.round((todo.length - done) / rate) : 0;
        console.log(
          `[DAOU] ${done}/${todo.length} (${((done / todo.length) * 100).toFixed(1)}%)  ` +
            `첨부 ${attachTotal}개  실패 ${failed}건  ${rate.toFixed(1)}건/s  ETA ${Math.floor(eta / 60)}분 ${eta % 60}초`
        );
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    await handle.close();
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n[DAOU] 반출 완료: 문서 ${done - failed}건 성공 / ${failed}건 실패, 첨부 ${attachTotal}개(실패 ${attachFailTotal}) — ${Math.floor(elapsed / 60)}분 ${elapsed % 60}초`);
  if (failed || attachFailTotal) console.log(`[DAOU] 실패 상세: ${FAILED_FILE} (재실행하면 미완료 문서만 다시 시도)`);
}

/** 반출 결과 대사 — 목록 대비 저장 문서 수·첨부 수 비교 */
export function auditDocs(): void {
  const all = loadDocIds();
  let savedDocs = 0;
  let attachExpected = 0;
  let attachSaved = 0;
  const missing: string[] = [];
  const attachShort: string[] = [];

  for (const item of all) {
    attachExpected += item.attachCount || 0;
    const donePath = path.join(docDir(item.documentId), "done.json");
    if (!fs.existsSync(donePath)) {
      missing.push(item.documentId);
      continue;
    }
    savedDocs++;
    try {
      const d = JSON.parse(fs.readFileSync(donePath, "utf-8"));
      attachSaved += d.attachSaved || 0;
      if ((d.attachExpected || 0) > (d.attachSaved || 0)) attachShort.push(item.documentId);
    } catch {
      /* 무시 */
    }
  }

  console.log(`목록 문서      ${all.length}건`);
  console.log(`반출 완료      ${savedDocs}건  (미완료 ${missing.length}건)`);
  console.log(`첨부 기대      ${attachExpected}개`);
  console.log(`첨부 저장      ${attachSaved}개  (부족 문서 ${attachShort.length}건)`);

  if (missing.length) console.log(`\n미완료 예시: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`);
  if (attachShort.length) console.log(`첨부 부족 예시: ${attachShort.slice(0, 5).join(", ")}${attachShort.length > 5 ? " ..." : ""}`);
  if (!missing.length && !attachShort.length) console.log("\n[DAOU] ✅ 문서·첨부 전량 반출 확인");
}
