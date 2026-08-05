/**
 * 1단계: 문서 목록 전량 수집
 * - 관리자 목록 API 를 페이징하며 전 기간·전 상태 문서 메타데이터를 모은다.
 * - 목록 레코드만으로도 문서번호·양식명·제목·기안자/부서/직위·기안일·완료일·상태·첨부수를 확보한다.
 * - 중단되면 마지막 완료 페이지부터 재개한다.
 */

import path from "node:path";
import fs from "node:fs";
import { APIRequestContext } from "playwright";

import { DAOU_DIR, ensureDaouDir } from "./session";
import { openDaouApi, fetchListPage, fetchForms, DocListItem } from "./client";

const LIST_FILE = path.join(DAOU_DIR, "documents.jsonl");
const PROGRESS_FILE = path.join(DAOU_DIR, "list-progress.json");
const FORMS_FILE = path.join(DAOU_DIR, "forms.json");

interface ListProgress {
  startAt: string;
  endAt: string;
  offset: number;
  nextPage: number;
  total: number;
  totalPage: number;
  collected: number;
  updatedAt: string;
}

function loadProgress(): ListProgress | null {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveProgress(p: ListProgress): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2), "utf-8");
}

export async function collectList(
  baseUrl: string,
  opts: { from?: string; to?: string; offset?: number; resume?: boolean } = {}
): Promise<void> {
  ensureDaouDir();

  const startAt = `${opts.from || "2015-01-01"}T00:00:00.000+09:00`;
  const endAt = `${opts.to || new Date().toISOString().slice(0, 10)}T23:59:59.000+09:00`;
  const offset = opts.offset || 100;

  let handle: Awaited<ReturnType<typeof openDaouApi>> | null = null;

  try {
    handle = await openDaouApi(baseUrl);
    const api = handle.api;

    // 양식 목록은 한 번만 받아 둔다(수집 후 양식별 통계·MCM 양식 매핑에 사용)
    if (!fs.existsSync(FORMS_FILE)) {
      const forms = await fetchForms(api);
      fs.writeFileSync(FORMS_FILE, JSON.stringify(forms, null, 2), "utf-8");
      console.log(`[DAOU] 양식 목록 ${forms.length}종 저장: ${FORMS_FILE}`);
    }

    const prev = opts.resume === false ? null : loadProgress();
    const sameRange = prev && prev.startAt === startAt && prev.endAt === endAt && prev.offset === offset;

    let page = sameRange ? prev!.nextPage : 0;
    let collected = sameRange ? prev!.collected : 0;

    if (!sameRange && fs.existsSync(LIST_FILE)) {
      fs.unlinkSync(LIST_FILE); // 조회 조건이 바뀌면 처음부터
    }
    if (sameRange) {
      console.log(`[DAOU] 이어서 수집: page=${page} (기수집 ${collected}건)`);
    }

    const stream = fs.createWriteStream(LIST_FILE, { flags: sameRange ? "a" : "w" });
    const startedAt = Date.now();
    let total = 0;
    let totalPage = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let result;
      let lastErr: unknown = null;

      // 일시적 오류는 3회까지 재시도
      for (let retry = 0; retry < 3; retry++) {
        try {
          result = await fetchListPage(api, { startAt, endAt, page, offset });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.log(`[DAOU] page=${page} 조회 실패(${retry + 1}/3): ${err}`);
          if (/HTTP 401/.test(String(err))) await handle.refresh(); // AccessToken 만료 → 갱신
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (lastErr || !result) {
        stream.end();
        throw lastErr || new Error("목록 조회 실패");
      }

      total = result.total;
      totalPage = result.totalPage;

      for (const item of result.items as DocListItem[]) {
        stream.write(JSON.stringify(item) + "\n");
      }
      collected += result.items.length;
      page++;

      saveProgress({
        startAt,
        endAt,
        offset,
        nextPage: page,
        total,
        totalPage,
        collected,
        updatedAt: new Date().toISOString(),
      });

      const pct = total ? ((collected / total) * 100).toFixed(1) : "?";
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`[DAOU] page ${page}/${totalPage}  누적 ${collected}/${total} (${pct}%)  ${elapsed}s`);

      if (!result.hasNext || result.items.length === 0) break;

      await new Promise((r) => setTimeout(r, 200)); // 서버 부하 완화
    }

    stream.end();
    console.log(`\n[DAOU] 목록 수집 완료: ${collected}건 → ${LIST_FILE}`);
  } finally {
    await handle?.close();
  }
}

/**
 * 대사(검증): 연도별로 서버가 보고하는 total 과 실제 수집 건수를 비교한다.
 * - 목록 API 는 최신순 정렬이라 페이징 중 문서가 추가되면 경계에서 누락이 생길 수 있다.
 * - 연도 구간별 total 합계와 수집 건수가 일치해야 전량 확보로 본다.
 */
export async function verifyList(baseUrl: string, opts: { from?: string; to?: string } = {}): Promise<void> {
  if (!fs.existsSync(LIST_FILE)) {
    console.log("[DAOU] 목록 파일이 없습니다. 먼저 list 를 실행하세요.");
    return;
  }

  const fromYear = Number((opts.from || "2019-01-01").slice(0, 4));
  const toYear = Number((opts.to || new Date().toISOString().slice(0, 10)).slice(0, 4));

  // 수집분 연도별 집계(기안일 기준, 없으면 생성일)
  const collectedByYear = new Map<number, number>();
  for (const line of fs.readFileSync(LIST_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const d = JSON.parse(line) as DocListItem;
    const y = Number((d.draftedAt || d.createdAt || "").slice(0, 4));
    if (y) collectedByYear.set(y, (collectedByYear.get(y) || 0) + 1);
  }

  const handle = await openDaouApi(baseUrl);
  const api = handle.api;
  try {
    console.log("연도    서버total   수집     차이");
    let sumServer = 0;
    let sumLocal = 0;
    const missingYears: number[] = [];

    for (let year = fromYear; year <= toYear; year++) {
      const res = await fetchListPage(api, {
        startAt: `${year}-01-01T00:00:00.000+09:00`,
        endAt: `${year}-12-31T23:59:59.000+09:00`,
        page: 0,
        offset: 1,
      });
      const local = collectedByYear.get(year) || 0;
      const diff = res.total - local;
      sumServer += res.total;
      sumLocal += local;
      if (diff !== 0) missingYears.push(year);
      console.log(
        `${year}  ${String(res.total).padStart(9)}  ${String(local).padStart(7)}  ${String(diff).padStart(6)}${diff !== 0 ? "  ⚠" : ""}`
      );
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`합계  ${String(sumServer).padStart(9)}  ${String(sumLocal).padStart(7)}  ${String(sumServer - sumLocal).padStart(6)}`);
    if (missingYears.length === 0) {
      console.log("\n[DAOU] ✅ 전 연도 일치 — 목록 전량 확보");
    } else {
      console.log(`\n[DAOU] ⚠ 불일치 연도: ${missingYears.join(", ")} → 해당 연도만 재수집 권장`);
      console.log(`  예) npm run daou -- list --url <주소> --from ${missingYears[0]}-01-01 --to ${missingYears[0]}-12-31`);
    }
  } finally {
    await handle.close();
  }
}

/** 수집된 목록 요약(양식별·연도별·상태별 건수, 첨부 총계) */
export function summarizeList(): void {
  if (!fs.existsSync(LIST_FILE)) {
    console.log("[DAOU] 목록 파일이 없습니다. 먼저 list 를 실행하세요.");
    return;
  }

  const byForm = new Map<string, number>();
  const byYear = new Map<number, number>();
  const byStatus = new Map<string, number>();
  const ids = new Set<string>();
  let attachTotal = 0;
  let rows = 0;

  for (const line of fs.readFileSync(LIST_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const d = JSON.parse(line) as DocListItem;
    rows++;
    ids.add(d.documentId);
    byForm.set(d.formName, (byForm.get(d.formName) || 0) + 1);
    // docYear 는 연도가 아니라 보존연한(5·10) 이므로 기안일에서 연도를 뽑는다.
    byYear.set(Number((d.draftedAt || d.createdAt || "").slice(0, 4)), (byYear.get(Number((d.draftedAt || d.createdAt || "").slice(0, 4))) || 0) + 1);
    byStatus.set(d.docStatusName || d.docStatus, (byStatus.get(d.docStatusName || d.docStatus) || 0) + 1);
    attachTotal += d.attachCount || 0;
  }

  console.log(`\n총 ${rows}행 / 고유 문서 ${ids.size}건 / 첨부 ${attachTotal}개`);

  console.log("\n[연도별]");
  for (const [year, n] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${year}  ${String(n).padStart(6)}`);
  }

  console.log("\n[상태별]");
  for (const [status, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${status}`);
  }

  console.log("\n[양식별 상위 30]");
  for (const [form, n] of [...byForm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${String(n).padStart(6)}  ${form}`);
  }
  console.log(`  ... 양식 총 ${byForm.size}종`);
}
