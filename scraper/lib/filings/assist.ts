/**
 * 반자동 신고 흐름 — 로그인된 브라우저로 신고 화면을 열고, 화면 위 패널로 대기열 값을 입력·복사하게 한 뒤
 * 사람이 사이트에서 저장·제출한다. 패널의 [제출 완료]/[제외] 가 MCM 대기열 상태를 바꾼다.
 *
 * 한 번 실행에 같은 종류의 대기 건을 [이전]/[다음] 으로 순회한다(IEPS 세션 1시간 안에 몰아서 처리).
 */
import { BrowserContext, Page } from "playwright";
import { SiteConfig } from "./config";
import { FillTarget, FilingKind, FilingsConfig, KIND_LABEL, KIND_SITE } from "./config";
import fs from "node:fs";
import path from "node:path";
import { tmpDir } from "./config";
import {
  FilingAttachment,
  FilingRow,
  ReportDeliveryMode,
  ReportDeliveryResult,
  downloadAttachment,
  getFiling,
  getFilingSettings,
  listContractAgencyReports,
  listPendingFilings,
  markFiling,
  mcmBaseUrl,
  patchContractPeriod,
  uploadAgencyReportPdf,
} from "./mcm-api";
import { ACTION_FN, OverlayAction, OverlayData, RENDER_FN, renderOverlay } from "./overlay";
import { dumpPage } from "./probe";
import { openContext, snapshotCookies, waitForContextClose } from "./session";

const DATA_FN = "__mcmFilingsGetData";

function toOverlay(
  f: FilingRow | null,
  index: number,
  total: number,
  fill: Record<string, FillTarget>,
  defaults: Record<string, string>
): OverlayData {
  if (!f) {
    return {
      filingId: "",
      kindLabel: "",
      title: "대기 건이 없습니다",
      subtitle: null,
      screen: "창을 닫으면 종료됩니다",
      dueOn: null,
      fields: [],
      index: 0,
      total: 0,
      fill: {},
    };
  }
  return {
    filingId: f.filingId,
    kindLabel: KIND_LABEL[f.filingKind],
    title: f.title,
    subtitle: f.subtitle,
    screen: f.payload.screen,
    dueOn: f.dueOn,
    // MCM 값이 비어 있으면 자사 상수(config.defaults)로 보충
    fields: f.payload.fields.map((fld) =>
      !fld.value && defaults[fld.label] ? { ...fld, value: defaults[fld.label], hint: fld.hint ?? "설정 기본값" } : fld
    ),
    index,
    total,
    fill,
  };
}

/**
 * 신고 항목 최신본 — 단건 조회(GET /api/filings/{id})는 대기열을 재계산하지 않아, 계약을 막 고친 직후엔
 * 옛 양식이 온다(2026-09-16 대행업무 기간을 [계약에 반영]했는데 패널이 그대로였던 원인). 재계산을 거치는
 * 목록 조회로 받고, 대기가 아닌 건(이미 제출 등)이면 단건 조회로 대신한다.
 */
async function refetchFiling(filingId: string): Promise<FilingRow | null> {
  const pending = await listPendingFilings().catch(() => [] as FilingRow[]);
  return pending.find((f) => f.filingId === filingId) ?? (await getFiling(filingId).catch(() => null));
}

export async function runAssist(opts: { cfg: FilingsConfig; kind?: FilingKind; filingId?: string }): Promise<void> {
  const { cfg } = opts;
  let items: FilingRow[];
  if (opts.filingId) {
    const one = await refetchFiling(opts.filingId);
    if (!one) throw new Error(`신고 항목을 찾을 수 없습니다: ${opts.filingId}`);
    if (one.status !== "pending") console.log(`[filings] ⚠ 이 항목은 이미 '${one.status}' 상태입니다. 그래도 엽니다.`);
    items = [one];
  } else if (opts.kind) {
    items = await listPendingFilings(opts.kind);
  } else {
    throw new Error("--kind <ieps_staff|ieps_agency|etis_career> 또는 --id <filingId> 가 필요합니다.");
  }
  if (items.length === 0) {
    console.log("[filings] 대기 건이 없습니다.");
    return;
  }
  const kind = (opts.kind ?? items[0].filingKind) as FilingKind;
  const site = KIND_SITE[kind];
  const siteCfg = cfg.sites[site];
  const fill = cfg.fill[kind] ?? {};
  const defaults = cfg.defaults?.[kind] ?? {};
  let index = 0;

  console.log(`[filings] ${KIND_LABEL[kind]} 대기 ${items.length}건 — ${siteCfg.label} 창을 엽니다.`);
  // 사이트 alert 메시지 — 패널 상단 배너로도 보여 준다(페이지가 바뀌어도 20초 안이면 다시 표시).
  // url 이 있으면 배너에 링크 버튼을 단다(예: 실무자 미설정 → 수행인력 설정). sticky 는 10분 남긴다.
  const notices: { at: number; text: string; url?: string; label?: string; sticky?: boolean }[] = [];

  /** 실적 보고서 발송 방식 — 패널에서 이 건만 바꾼 값(null = 설정 기본값). 건을 처리하면 되돌린다. */
  let deliveryMode: ReportDeliveryMode | null = null;
  let deliveryDefault: ReportDeliveryMode = "mail";
  if (kind === "ieps_agency") {
    deliveryDefault = (await getFilingSettings().catch(() => ({ reportDelivery: "mail" as ReportDeliveryMode }))).reportDelivery;
  }

  /** 발송 결과를 패널 알림으로 — 실무자 미설정이면 수행인력 설정 링크를 단다. */
  const noticeDelivery = (d: ReportDeliveryResult | null) => {
    if (!d) return;
    const names = d.recipients.map((r) => r.name).join(", ");
    const via = d.channels.map((c) => (c === "mail" ? "메일" : "메신저")).join("·");
    if (d.status === "sent") {
      notices.push({ at: Date.now(), text: `실적 보고서를 실무자 ${names} 님에게 ${via}로 보냈습니다.${d.error ? ` (일부 실패: ${d.error})` : ""}` });
    } else if (d.status === "held") {
      notices.push({ at: Date.now(), text: "실적 보고서 발송을 보류했습니다 — 계약 상세의 신고 이력에서 [발송] 할 수 있습니다." });
    } else if (d.status === "no_recipient") {
      const base = mcmBaseUrl();
      notices.push({
        at: Date.now(),
        sticky: true,
        text: "실무자가 설정되지 않아 실적 보고서를 보내지 못했습니다 — 수행인력에서 실무(정)을 지정한 뒤 계약 상세에서 [발송] 하세요.",
        url: base && d.staffingPath ? `${base}${d.staffingPath}` : undefined,
        label: "수행인력 설정",
      });
    } else {
      notices.push({ at: Date.now(), sticky: true, text: `실적 보고서 발송 실패: ${d.error ?? "알 수 없는 오류"}` });
    }
    console.log(`[filings] 실적 보고서 발송: ${d.status}${names ? ` (${names})` : ""}${d.error ? ` — ${d.error}` : ""}`);
  };

  /**
   * 실적 보고서 PDF 를 IEPS 에서 받아 MCM 신고 이력에 붙인다 — 붙으면 서버가 실무자에게 발송한다(254).
   * 이력은 대기열 건(filing_id)으로 찾고, 없으면 같은 구분의 PDF 없는 최근 이력에 붙인다.
   */
  const attachReport = async (filing: FilingRow, ids: { cnclCd: string; reqstSn: string }) => {
    if (!filing.contractId) {
      notices.push({ at: Date.now(), text: "계약이 연결되지 않은 건이라 실적 보고서를 붙일 곳이 없습니다." });
      return;
    }
    notices.push({ at: Date.now(), text: `실적 보고서(보고회차 ${ids.reqstSn}) PDF 를 받는 중…` });
    await rerender();
    const { pdf, fileName } = await fetchReportPdf(context, ids.cnclCd, ids.reqstSn);
    const reports = await listContractAgencyReports(filing.contractId);
    const target =
      reports.find((r) => r.filingId === filing.filingId) ??
      reports.filter((r) => r.reportKind === filing.triggerKind && !r.documentId).pop();
    if (!target) {
      notices.push({
        at: Date.now(),
        sticky: true,
        text: "PDF 는 받았지만 붙일 신고 이력이 없습니다 — 계약 상세에서 이력을 추가한 뒤 다시 받으세요.",
      });
      return;
    }
    const { delivery } = await uploadAgencyReportPdf(filing.contractId, target.reportId, {
      pdf,
      fileName,
      receiptNo: ids.reqstSn,
      deliveryMode,
    });
    notices.push({ at: Date.now(), text: `실적 보고서 PDF 를 계약 상세 신고 이력에 붙였습니다(보고회차 ${ids.reqstSn}).` });
    noticeDelivery(delivery);
  };

  /**
   * 사이트가 제출 성공을 알리면("제출 되었습니다") 현재 건을 MCM 에 제출 완료로 바로 기록한다(2026-09-16 사용자 결정).
   * 패널의 [제출 완료] → [제출 완료로 기록] 두 단계를 부산·익산 두 번 모두 빠뜨렸다 — 사이트 제출과 MCM 기록은
   * 늘 함께 일어나야 하므로 알림을 신호로 잇는다. 대행 실적 보고는 이어서 보고회차를 접수번호로 남기고,
   * 실적 보고서 PDF 를 받아 이력에 붙인다(→ 실무자 발송).
   */
  let recording = false;
  const autoRecordSubmit = async (text: string) => {
    if (!/제출\s*되었습니다|제출이\s*완료/.test(text)) return;
    const cur = items[index];
    if (!cur || cur.status !== "pending" || recording) return;
    recording = true;
    try {
      // 알림을 닫으면 제출된 보고서 화면으로 넘어간다 — 그 주소에서 보고회차를 읽는다
      await new Promise((r) => setTimeout(r, 2000));
      const page = mainPage();
      const ids = page ? await readReportIds(page, siteCfg.agencyCode) : null;
      await markFiling(cur.filingId, { status: "submitted", receiptNo: ids?.reqstSn ?? null, deliveryMode });
      console.log(`[filings] ${cur.title} → 제출 완료 자동 기록(사이트 제출 알림${ids?.reqstSn ? `, 보고회차 ${ids.reqstSn}` : ""})`);
      notices.push({
        at: Date.now(),
        text: `사이트 제출을 확인해 MCM 에 제출 완료로 기록했습니다${ids?.reqstSn ? `(보고회차 ${ids.reqstSn})` : ""}.`,
      });
      if (cur.filingKind === "ieps_agency") {
        if (ids?.reqstSn && ids.cnclCd) {
          await attachReport(cur, { cnclCd: ids.cnclCd, reqstSn: ids.reqstSn }).catch((e) => {
            notices.push({
              at: Date.now(),
              sticky: true,
              text: `실적 보고서 자동 첨부 실패 — [실적보고서 받기] 로 다시 시도하세요: ${(e as Error).message}`,
            });
          });
        } else {
          notices.push({
            at: Date.now(),
            sticky: true,
            text: "보고회차를 읽지 못해 실적 보고서를 받지 못했습니다 — IEPS 목록의 보고회차로 [실적보고서 받기] 를 누르세요.",
          });
        }
      }
      items.splice(index, 1);
      if (index >= items.length) index = 0;
      deliveryMode = null;
    } catch (err) {
      console.log(`[filings] ⚠ 제출 자동 기록 실패: ${(err as Error).message}`);
      notices.push({ at: Date.now(), sticky: true, text: `제출 자동 기록 실패 — 패널의 [제출 완료] 로 직접 기록하세요: ${(err as Error).message}` });
    } finally {
      recording = false;
      await rerender();
    }
  };

  const { context } = await openContext(site, {
    onNotice: (text) => {
      notices.push({ at: Date.now(), text });
      void rerender();
      void autoRecordSubmit(text);
    },
  });

  const siteSearch = siteCfg.siteSearch;
  const searchQueryOf = (f: FilingRow | undefined): string | undefined => {
    if (!siteSearch || !f) return undefined;
    const v = f.payload.fields.find((x) => x.label === siteSearch.queryLabel)?.value?.trim();
    return v || undefined;
  };
  const attCfg = cfg.attachments;
  const sealAvailable = Boolean(attCfg?.sealPath && fs.existsSync(attCfg.sealPath));
  const current = (): OverlayData => {
    const cur = items[index];
    const docs = cur ? pickAttachments(cur) : [];
    return {
      ...toOverlay(cur ?? null, index, items.length, fill, defaults),
      notices: notices
        .filter((n) => Date.now() - n.at < (n.sticky ? 10 * 60_000 : 20_000))
        .map((n) => (n.url ? { text: n.text, url: n.url, label: n.label } : n.text)),
      siteSearchQuery: searchQueryOf(cur),
      attach: kind === "ieps_agency" ? { seal: sealAvailable, docs: docs.map((d) => `${d.typeLabel} ${d.name}`) } : undefined,
      delivery: kind === "ieps_agency" ? { mode: deliveryMode, defaultMode: deliveryDefault } : undefined,
    };
  };
  const rerender = async () => {
    const d = current();
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      await p
        .evaluate(({ fn, data }) => {
          const w = window as unknown as Record<string, (d: unknown) => void>;
          if (typeof w[fn] === "function") w[fn](data);
        }, { fn: RENDER_FN, data: d })
        .catch(() => {});
    }
  };

  /**
   * 신고서 본 화면 — 첨부·사업장 검색의 대상. "마지막에 열린 창"을 쓰면 사업장 검색 팝업이 떠 있을 때
   * 팝업 자신을 본 화면으로 착각한다(2026-09-16). 팝업이 아닌 창 중 마지막 것을 고른다.
   */
  const mainPage = (): Page | undefined => {
    const open = context.pages().filter((p) => !p.isClosed());
    return open.filter((p) => !/popup/i.test(p.url())).pop() ?? open.pop();
  };

  await context.exposeFunction(DATA_FN, () => current());
  await context.exposeFunction(ACTION_FN, async (a: OverlayAction) => {
    try {
      const cur = items[index];
      if (a.type === "attachSeal" || a.type === "attachDocs") {
        const target = mainPage();
        if (target && attCfg) {
          if (a.type === "attachSeal") {
            notices.push({ at: Date.now(), text: await attachFile(target, attCfg.sealField, attCfg.sealPath, attCfg.browseButton, attCfg.saveButton) });
          } else if (cur) {
            const docs = pickAttachments(cur);
            if (docs.length === 0) notices.push({ at: Date.now(), text: "이 건에 붙일 계약 첨부가 MCM 에 없습니다." });
            for (const d of docs) {
              try {
                const file = await downloadAttachment(d, path.join(tmpDir(), cur.filingId));
                notices.push({ at: Date.now(), text: await attachFile(target, attCfg.docField, file, attCfg.browseButton, attCfg.saveButton) });
              } catch (err) {
                notices.push({ at: Date.now(), text: `첨부 실패(${d.name}): ${(err as Error).message}` });
              }
            }
            if (cur.triggerKind === "complete") notices.push({ at: Date.now(), text: "이행 보고의 '대행계약 이행증명서'(발주자 발급)는 MCM 에 없어 직접 첨부해야 합니다." });
          }
        }
      } else if (a.type === "siteSearch") {
        const q = searchQueryOf(cur);
        const target = mainPage();
        if (q && target && siteSearch) {
          const result = await runSiteSearch(context, target, siteSearch, q);
          console.log(`[filings] ${result}`);
          notices.push({ at: Date.now(), text: result });
        }
      } else if (a.type === "editPeriod") {
        // 패널에서 고친 대행업무 기간을 MCM 계약에 저장하고, 그 값으로 양식을 다시 만든다.
        if (!cur?.contractId) {
          notices.push({ at: Date.now(), text: "계약이 연결된 건에서만 기간을 고칠 수 있습니다." });
        } else if (a.start > a.end) {
          notices.push({ at: Date.now(), text: "종료일이 시작일보다 빠릅니다." });
        } else {
          await patchContractPeriod(cur.contractId, a.start, a.end);
          const fresh = await refetchFiling(cur.filingId);
          if (fresh) items[index] = fresh;
          notices.push({ at: Date.now(), text: `대행업무 기간을 ${a.start} ~ ${a.end} 로 저장했습니다 — [자동 채우기] 로 화면에 반영하세요.` });
        }
      } else if (a.type === "setDelivery") {
        deliveryMode = a.mode || null;
      } else if (a.type === "fetchReport") {
        // 수동 — 이미 제출한 건(자동 첨부를 놓친 건 포함)도 IEPS 목록의 보고회차로 받아 붙인다
        const sn = a.reqstSn.replace(/\D/g, "");
        if (!cur) {
          notices.push({ at: Date.now(), text: "대기 건이 없어 실적 보고서를 붙일 곳이 없습니다." });
        } else if (!sn) {
          notices.push({ at: Date.now(), text: "보고회차(숫자)를 입력하세요." });
        } else {
          const page = mainPage();
          const fromPage = page ? await readReportIds(page, siteCfg.agencyCode) : null;
          const cnclCd = fromPage?.cnclCd ?? siteCfg.agencyCode;
          if (!cnclCd) {
            notices.push({ at: Date.now(), text: "대행업 등록 코드(CNCL_CD)를 알 수 없습니다 — IEPS 대행 실적보고 화면에서 다시 시도하세요." });
          } else {
            await attachReport(cur, { cnclCd, reqstSn: sn }).catch((e) => {
              notices.push({ at: Date.now(), sticky: true, text: `실적 보고서 받기 실패: ${(e as Error).message}` });
            });
          }
        }
      } else if (a.type === "probe") {
        // 패널이 떠 있는 바로 그 창의 현재 페이지를 덤프한다(별도 창은 같은 프로필을 못 연다)
        const target = context.pages().filter((p) => !p.isClosed()).pop();
        if (target) {
          const file = await dumpPage(site, target);
          notices.push({ at: Date.now(), text: `폼 덤프 저장: ${file}` });
        }
      } else if (a.type === "next") index = items.length ? (index + 1) % items.length : 0;
      else if (a.type === "prev") index = items.length ? (index - 1 + items.length) % items.length : 0;
      else if (cur && (a.type === "submitted" || a.type === "skipped")) {
        await markFiling(cur.filingId, {
          status: a.type,
          receiptNo: a.type === "submitted" ? a.receiptNo || null : null,
          note: a.type === "skipped" ? a.note || null : null,
          deliveryMode: a.type === "submitted" ? deliveryMode : null,
        });
        console.log(`[filings] ${cur.title} → ${a.type === "submitted" ? "제출 완료" : "제외"} 기록`);
        items.splice(index, 1);
        if (index >= items.length) index = 0;
      }
    } catch (err) {
      console.log(`[filings] ⚠ 처리 실패: ${(err as Error).message}`);
    }
    await rerender();
  });
  // 페이지가 바뀔 때마다 패널을 다시 그린다 — 데이터는 노드 측에서 받아 온다(항목이 바뀌어도 초기값에 묶이지 않게).
  await context.addInitScript(
    `(() => { const render = ${renderOverlay.toString()};
       const boot = async () => { try { const d = await window["${DATA_FN}"](); if (d) render(d); } catch (e) { /* 미노출 페이지 */ } };
       if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot(); })();`
  );

  const page: Page = context.pages()[0] || (await context.newPage());
  const startUrl = siteCfg.screens[kind] || siteCfg.loginUrl;
  await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch((e) => console.log(`[filings] ⚠ 이동 실패: ${e.message}`));
  watchLogout(context, siteCfg.loggedOutPattern, site);

  console.log(`[filings] 패널에서 값을 복사·채우고, 사이트에서 저장·제출한 뒤 패널의 [제출 완료] 를 누르세요.`);
  console.log(`[filings] 신고 화면 URL 이 다르면 메뉴로 이동하세요(패널은 어느 화면에서든 따라갑니다). 창을 닫으면 종료.`);
  console.log(`[filings] 사이트 팝업(알림·확인 창)은 이 터미널과 패널에 표시됩니다 — 확인 창은 여기서 y/n 으로 답하세요.`);
  const timer = setInterval(() => void snapshotCookies(site, context), 5000);
  await waitForContextClose(context);
  clearInterval(timer);
  console.log(`[filings] 종료 — 남은 대기 ${items.length}건`);
}

/**
 * 보고 구분별 첨부 선택 — 체결: 계약서, 변경: 변경계약서(없으면 계약서), 이행: 세금계산서(마지막 발행분).
 * (IEPS 안내: 체결=대행계약서 사본, 변경=변경계약서 사본, 이행=이행증명서+세금계산서 사본)
 */
function pickAttachments(f: FilingRow): FilingAttachment[] {
  const all = f.attachments ?? [];
  if (f.filingKind !== "ieps_agency") return [];
  const byType = (t: string) => all.filter((a) => a.type === t);
  if (f.triggerKind === "amend") return byType("amendment").length ? byType("amendment").slice(0, 1) : byType("contract").slice(0, 1);
  if (f.triggerKind === "complete") return byType("invoice").slice(0, 1);
  return byType("contract").slice(0, 1);
}

/**
 * 파일 첨부 — 기준 칸(anchor)과 같은 셀 안의 [찾아보기] 를 눌러 뜨는 파일 선택기를 가로채 파일을 넣고, 같은 셀의 [저장] 을 누른다.
 * 숨겨진 <input type=file> 의 셀렉터를 몰라도 되고, 사이트가 "신청서 저장 후 등록 가능" 같은 alert 를 띄우면 그대로 표시된다.
 */
export async function attachFile(page: Page, anchorSel: string, filePath: string, browseSel: string, saveSel: string): Promise<string> {
  if (!fs.existsSync(filePath)) return `첨부할 파일이 없습니다: ${filePath}`;
  const anchor = page.locator(anchorSel).first();
  if ((await anchor.count()) === 0) return `첨부 칸(${anchorSel})을 찾지 못했습니다 — 신청서를 먼저 저장했는지 확인하세요.`;
  // 같은 셀(td) → 같은 행(tr) 순으로 버튼을 찾는다
  let browse = anchor.locator("xpath=ancestor::td[1]").locator(browseSel).first();
  if ((await browse.count()) === 0) browse = anchor.locator("xpath=ancestor::tr[1]").locator(browseSel).first();
  if ((await browse.count()) === 0) return `[찾아보기] 버튼을 찾지 못했습니다(${anchorSel} 근처) — 직접 첨부하세요: ${filePath}`;
  const chooserP = page.waitForEvent("filechooser", { timeout: 8_000 }).catch(() => null);
  await browse.click().catch(() => {});
  const chooser = await chooserP;
  if (!chooser) return `파일 선택기가 열리지 않았습니다 — 직접 첨부하세요: ${filePath}`;
  // 경로 대신 버퍼로 넘긴다 — 한글 파일명 경로는 선택기에 들어가지 않는 경우가 있다(원래 이름은 유지된다)
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  await chooser.setFiles({ name: path.basename(filePath), mimeType, buffer: fs.readFileSync(filePath) });
  // 사이트가 change 이벤트로 표시 칸에 파일명을 적을 때까지(최대 3초) 기다린 뒤 저장한다
  await anchor.evaluate((el, name) => new Promise<void>((resolve) => {
    const input = el as HTMLInputElement;
    const t0 = Date.now();
    const tick = () => (input.value.includes(name) || Date.now() - t0 > 3000 ? resolve() : setTimeout(tick, 100));
    tick();
  }), path.basename(filePath).replace(/\.[^.]+$/, "")).catch(() => {});
  await page.waitForTimeout(300);
  let save = anchor.locator("xpath=ancestor::td[1]").locator(saveSel).first();
  if ((await save.count()) === 0) save = anchor.locator("xpath=ancestor::tr[1]").locator(saveSel).first();
  if ((await save.count()) > 0) {
    await save.click().catch(() => {});
    await page.waitForTimeout(1500);
    return `첨부 후 저장했습니다: ${path.basename(filePath)} — 화면에서 등록됐는지 확인하세요.`;
  }
  return `파일을 넣었습니다: ${path.basename(filePath)} — [저장] 버튼은 직접 눌러 주세요.`;
}

/** 검색어 정규화 — 법인 표기를 떼고 첫 낱말(IEPS 등록명은 MCM 표기와 다를 수 있어 넓게 검색한 뒤 이름 일치 행을 고른다) */
function searchKeyword(name: string): string {
  const stripped = name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)/g, " ").replace(/\s+/g, " ").trim();
  return stripped.split(" ")[0] || stripped || name;
}
function normalizeName(name: string): string {
  return name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\s+/g, "").trim();
}

/**
 * 사업장명을 비교용 낱말로 쪼갠다 — "국도화학㈜ 경인사업소 제1공장" → ["국도화학", "경인사업소", "제1공장"].
 * 첫 낱말은 회사명이라 반드시 맞아야 하고, 나머지는 겹치는 비율로 점수를 낸다.
 */
function nameTokens(name: string): string[] {
  return name
    .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|\(합\)/g, " ")
    .split(/[\s(),·\-_/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * 사업장 검색 팝업 자동화 — 본문의 [사업장 검색] 을 눌러 팝업을 띄우고, 검색어를 넣어 검색한 뒤
 * 결과에서 사업장명이 일치하는 행을 클릭한다. 어느 단계든 못 찾으면 팝업을 열어 둔 채 사람이 잇는다.
 */
export async function runSiteSearch(context: BrowserContext, page: Page, cfg: NonNullable<SiteConfig["siteSearch"]>, name: string): Promise<string> {
  // 1) 팝업 열기 — 이미 열린 팝업이 있으면 그것을 쓴다
  let popup = context.pages().find((p) => !p.isClosed() && /bplcCodeNmPopup|Popup/i.test(p.url()) && p !== page) ?? null;
  if (!popup) {
    const waitPopup = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
    const opener = page.locator(cfg.openButton).first();
    if ((await opener.count()) > 0) {
      await opener.click().catch(() => {});
    } else if (!(await clickByText(page, "사업장 검색"))) {
      // IEPS 의 [사업장 검색] 은 input/button 이 아니라 onclick 을 단 요소라 셀렉터로 안 잡히는 경우가 있다(2026-09-16).
      return `사업장 검색 버튼을 찾지 못했습니다 — 직접 눌러 "${searchKeyword(name)}" 로 검색하세요.`;
    }
    popup = await waitPopup;
    if (!popup) return `팝업이 열리지 않았습니다 — 직접 [사업장 검색] 을 눌러 "${searchKeyword(name)}" 로 검색하세요.`;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
  }
  if ((await popup.locator(cfg.input).first().count()) === 0) {
    return `팝업의 검색어 칸(${cfg.input})을 찾지 못했습니다 — 직접 "${searchKeyword(name)}" 로 검색하세요.`;
  }

  // 2) 두 단계로 찾는다(2026-09-16 사용자 요청).
  //    ① 사업장명 그대로 검색해 **이름이 그대로 일치**하는 행을 고른다.
  //    ② 못 찾으면 회사명만으로 다시 검색해 **낱말 겹침**으로 가장 비슷한 행을 고른다
  //       (MCM 마스터 명칭과 IEPS 등록명이 ㈜ 표기·지점 표기·띄어쓰기에서 어긋나는 경우가 있다).
  const full = normalizeName(name) === normalizeName(searchKeyword(name)) ? "" : name.replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, " ").replace(/\s+/g, " ").trim();
  const passes: { keyword: string; minScore: number }[] = [];
  if (full) passes.push({ keyword: full, minScore: 1 });
  passes.push({ keyword: searchKeyword(name), minScore: 0.6 });

  for (const pass of passes) {
    const picked = await searchAndPick(popup, page, cfg, name, pass.keyword, pass.minScore);
    if (picked) {
      const how = picked.score === 1 ? "" : ` (이름이 정확히 같지는 않아 가장 비슷한 행을 골랐습니다: ${picked.text})`;
      return `사업장 검색: "${pass.keyword}" 결과에서 "${name}" 행을 선택했습니다${how} — 본문의 사업장 명칭·소재지가 맞는지 확인하세요.`;
    }
  }
  return `사업장 검색: "${passes.map((p) => p.keyword).join('" → "')}" 로 검색했지만 "${name}" 와 맞는 행을 찾지 못했습니다 — 팝업에서 직접 고르세요.`;
}

/**
 * 팝업에서 한 번 검색하고 결과에서 가장 잘 맞는 행을 누른다. minScore 미만이면 아무것도 누르지 않는다.
 * 점수: 이름이 그대로 들어 있으면 1, 아니면 회사명(첫 낱말)을 포함하는 행에 한해 낱말 겹침 비율.
 */
/**
 * 제출된 대행 실적 보고서의 식별자 — 주소의 CNCL_CD(대행업 등록 코드)·REQST_SN(보고회차).
 * 보고회차는 IEPS 대행 실적보고 목록의 "보고회차" 열과 같다. 주소에 없으면 화면의 숨은 입력값을 본다.
 */
export async function readReportIds(page: Page, fallbackCncl?: string): Promise<{ cnclCd: string | null; reqstSn: string | null }> {
  let cnclCd: string | null = null;
  let reqstSn: string | null = null;
  try {
    const u = new URL(page.url());
    cnclCd = u.searchParams.get("CNCL_CD");
    reqstSn = u.searchParams.get("REQST_SN");
  } catch {
    // 주소를 못 읽으면 화면 값으로
  }
  if (!reqstSn || !cnclCd) {
    const fromDom = await page
      .evaluate(() => {
        const v = (name: string) =>
          (document.querySelector(`input[name="${name}"], #${name}`) as HTMLInputElement | null)?.value?.trim() || null;
        return { cnclCd: v("CNCL_CD"), reqstSn: v("REQST_SN") };
      })
      .catch(() => ({ cnclCd: null as string | null, reqstSn: null as string | null }));
    cnclCd = cnclCd ?? fromDom.cnclCd;
    reqstSn = reqstSn ?? fromDom.reqstSn;
  }
  return { cnclCd: cnclCd ?? fallbackCncl ?? null, reqstSn: reqstSn && /^\d+$/.test(reqstSn) ? reqstSn : null };
}

/**
 * 실적 보고서 원본 PDF 받기 — IEPS "실적보고 출력"과 같은 AIReport 뷰어를 새 탭으로 열고 [PDF저장](#pdfConvert)을 누른다.
 * 서버에 PDF 를 직접 요청(reportMode=PDF)하면 응답이 오지 않고, 화면 인쇄는 툴바가 찍히고 쪽이 나뉘어서
 * 뷰어의 저장 버튼만이 원본과 같은 A4 1장을 준다(2026-09-16 실측, 약 7초).
 *
 * 저장 버튼이 내려받게 하는 응답(AIprint.jsp?reportMode=PDF&key=…)을 **네트워크에서 가로채** 바이트를 직접 받는다.
 * 브라우저 다운로드로 받으면 실제 Chrome 채널에서 뷰어 창이 스스로 닫히고 브라우저 컨텍스트까지 내려가
 * "Target page, context or browser has been closed" 로 실패했다 — 가로챈 뒤 빈 응답을 돌려줘 다운로드 자체를 없앤다.
 */
export async function fetchReportPdf(
  context: BrowserContext,
  cnclCd: string,
  reqstSn: string
): Promise<{ pdf: Buffer; fileName: string }> {
  const url =
    `https://ieps.nier.go.kr/web/report/agcyContract.jsp?reportMode=HTML&CNCL_CD=${encodeURIComponent(cnclCd)}` +
    `&REQST_SN=${encodeURIComponent(reqstSn)}` +
    "&reportParams=useReportFile:true,pdf_convert:true,excel_convert:true,hwp_convert:true,skip_decimal_point:true,decimal_round:true&CPY_VIEW=N";
  const view = await context.newPage();
  let captured: Buffer | null = null;
  let captureError: string | null = null;
  try {
    await view.route(/\/AIprint\.jsp\?.*reportMode=PDF/i, async (route) => {
      try {
        const resp = await route.fetch();
        captured = await resp.body();
      } catch (e) {
        captureError = (e as Error).message;
      }
      await route.fulfill({ status: 204, body: "" }).catch(() => {});
    });
    // 뷰어 스크립트가 다 뜬 뒤에 눌러야 저장이 안정적이다
    await view.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    const btn = view.locator("#pdfConvert").first();
    await btn.waitFor({ state: "attached", timeout: 30_000 });
    await view.waitForTimeout(1000);
    await view.evaluate(() => {
      window.close = () => undefined; // 저장 뒤 스스로 창을 닫지 않게
    });
    await btn.click();
    const deadline = Date.now() + 60_000;
    while (!captured && !captureError && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const pdf = captured as Buffer | null;
    if (!pdf) throw new Error(captureError ?? "실적 보고서 PDF 응답을 받지 못했습니다(60초).");
    if (pdf.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("받은 파일이 PDF 가 아닙니다.");
    return { pdf, fileName: `대행실적보고서-${reqstSn}.pdf` };
  } finally {
    await view.close().catch(() => {});
  }
}

/** 결과 영역의 현재 글자 — 검색 전후 비교용. 페이지가 바뀌는 중이면 빈 문자열. */
async function resultText(popup: Page): Promise<string> {
  return popup
    .evaluate(() => Array.from(document.querySelectorAll("table tbody tr, table tr")).map((r) => r.textContent ?? "").join("|"))
    .catch(() => "");
}

/**
 * 팝업에 검색어를 넣고 조회한 뒤 **결과가 실제로 바뀔 때까지** 기다린다.
 *
 * IEPS 사업장 검색의 [조회] 는 페이지를 새로 불러온다. 로드 시작 직후를 "끝났다"고 보면, 아직 이전 화면에서
 * 결과를 읽고 다음 검색어를 곧 사라질 입력칸에 넣게 된다 — 두 번째 검색이 증발하고 첫 검색의
 * "자료가 없습니다" 화면만 남던 원인(2026-09-16 익산지점). 새 문서 로드와 같은 문서 안의 결과 갱신 중
 * 먼저 오는 쪽을 기다린다(최대 8초).
 */
async function submitSearch(popup: Page, cfg: NonNullable<SiteConfig["siteSearch"]>, keyword: string): Promise<void> {
  const input = popup.locator(cfg.input).first();
  await input.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
  await input.fill(keyword).catch(() => {});
  const before = await resultText(popup);
  const navigated = popup
    .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const submit = popup.locator(cfg.submit).first();
  if ((await submit.count()) > 0) await submit.click().catch(() => {});
  else await input.press("Enter").catch(() => {});
  const changed = (async () => {
    for (let i = 0; i < 40; i++) {
      await popup.waitForTimeout(200);
      const now = await resultText(popup);
      if (now && now !== before) return true;
    }
    return false;
  })();
  await Promise.race([navigated, changed]);
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  await popup.waitForTimeout(400);
}

async function searchAndPick(
  popup: Page,
  page: Page,
  cfg: NonNullable<SiteConfig["siteSearch"]>,
  name: string,
  keyword: string,
  minScore: number
): Promise<{ score: number; text: string } | null> {
  await submitSearch(popup, cfg, keyword);

  const want = normalizeName(name);
  const tokens = nameTokens(name);
  // 결과 표의 행만 본다. 예전엔 "li, .row" 도 후보에 넣었는데, 팝업에 주입된 신고 보조 패널의 양식 행(.row)이
  // 섞여 1차 검색 결과가 비었을 때 패널의 "대행사업장 명칭" 행을 정답으로 골랐다(2026-09-16 익산지점). 패널엔 table 이 없다.
  const rows = popup.locator("table tr");
  const n = await rows.count().catch(() => 0);
  let best: { index: number; score: number; text: string } | null = null;
  for (let i = 0; i < Math.min(n, 200); i++) {
    const text = ((await rows.nth(i).textContent().catch(() => "")) ?? "").trim();
    if (!text) continue;
    const flat = normalizeName(text);
    if (!flat) continue;
    // 양방향 포함 — IEPS 등록명이 MCM 명칭보다 짧을 수도, 길 수도 있다
    let score = flat.includes(want) || (want.length >= 4 && want.includes(flat)) ? 1 : 0;
    if (score === 0 && tokens.length) {
      if (!flat.includes(tokens[0])) continue; // 회사명은 반드시 맞아야 한다
      score = tokens.filter((t) => flat.includes(t)).length / tokens.length;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { index: i, score, text: text.replace(/\s+/g, " ").trim().slice(0, 60) };
    }
  }
  if (!best || best.score < minScore) return null;
  const row = rows.nth(best.index);
  const link = row.locator("a, [onclick], button").first();
  if ((await link.count()) > 0) await link.click().catch(() => {});
  else await row.click().catch(() => {});
  await page.waitForTimeout(500);
  return { score: best.score, text: best.text };
}

/**
 * 라벨 텍스트로 버튼을 찾아 누른다 — 셀렉터로 안 잡히는 요소(onclick 을 단 span·td·img)까지 훑는 폴백.
 * 화면에 보이고 텍스트가 정확히 일치하는 것 중 가장 안쪽 요소를 누른다(조상까지 함께 잡히는 것을 피한다).
 */
async function clickByText(page: Page, label: string): Promise<boolean> {
  return page
    .evaluate((want) => {
      const flat = (s: string) => s.replace(/\s+/g, "");
      const target = flat(want);
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>("a, button, input, span, td, th, label, img, div, li")
      ).filter((el) => {
        if (!el.getClientRects().length) return false;
        const text =
          el.tagName === "INPUT"
            ? (el as HTMLInputElement).value
            : el.getAttribute("alt") || el.getAttribute("title") || el.textContent || "";
        return flat(text) === target;
      });
      if (!nodes.length) return false;
      // 가장 안쪽(자식 수가 적은) 요소 — 조상 div 가 아니라 실제 버튼을 누르기 위해
      nodes.sort((a, b) => a.getElementsByTagName("*").length - b.getElementsByTagName("*").length);
      nodes[0].click();
      return true;
    }, label)
    .catch(() => false);
}

function watchLogout(context: BrowserContext, pattern: string, site: string): void {
  const re = new RegExp(pattern, "i");
  const hook = (p: Page) =>
    p.on("framenavigated", (fr) => {
      if (fr !== p.mainFrame() || !re.test(fr.url())) return;
      // 사업장 검색 팝업(/web/mypage/memberjoin/bplcCodeNmPopup)처럼 경로에 member 가 든 창은 로그아웃이 아니다.
      void p
        .opener()
        .then((opener) => {
          if (opener) return;
          console.log(`[${site}] ⚠ 로그인 페이지로 이동했습니다 — 세션이 끝났으면 창에서 다시 로그인하세요(쿠키는 계속 저장됩니다).`);
        })
        .catch(() => {});
    });
  context.pages().forEach(hook);
  context.on("page", hook);
}
