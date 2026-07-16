// 야간 배치 엔트리: DART 신호 전량 수집(모집단 역전) + EIASS 협의진행현황 증분 수집. ECS RunTask에서 실행.
// next 이미지의 node_modules(pg·undici 등)를 그대로 쓰고, 소스는 esbuild로 단일 번들(.next/intel-batch.cjs).
// 환경변수: INTEL_BATCH_DAYS(기본 1=전일 증분), INTEL_BATCH_EIASS_PAGES(kind당 리스트 페이지, 기본 5.
//           백필 시 크게 — 예: 400이면 소규모 전량). DB/DART/ANTHROPIC 설정은 next task def env 재사용.
// DART 과거 백필: INTEL_BATCH_DART_BGN_DE/END_DE(YYYYMMDD, DART 제약상 창은 최대 30일) +
//                INTEL_BATCH_ONLY=dart(다른 소스 skip). 청크 분할·순차 실행은 호출측 책임.
import { getDb } from "@/lib/db";
import { collectDartSignals } from "@/lib/intel/collect";
import { collectEiassSignals } from "@/lib/intel/collect-eiass";
import { collectGosiSignals } from "@/lib/intel/collect-gosi";
import { collectNewsSignals } from "@/lib/intel/collect-news";
import { collectPressSignals } from "@/lib/intel/collect-press";
import { indexPendingEmbeddings, markNewsDuplicates } from "@/lib/intel/rag-indexer";
import { disclosureCutoffIso, loadIntelSettings } from "@/lib/intel/intel-settings";
import { listEnabledCustomCollectors, updateEndpoint } from "@/lib/scraper/sources-store";
import { collectCustomSource } from "@/lib/intel/custom-sink";
import { collectBidSource } from "@/lib/bid/bid-sink";
import { buildChunkConfig, nextYm, totalMonths, type BackfillState } from "@/lib/scraper/backfill";

async function main() {
  // 수집 설정(intel_settings)을 읽어 각 수집기에 전달. env 는 설정보다 우선(백필 오버라이드용).
  const settings = await loadIntelSettings(await getDb());
  const cutoff = disclosureCutoffIso(settings);
  const days = Number(process.env.INTEL_BATCH_DAYS) > 0 ? Number(process.env.INTEL_BATCH_DAYS) : settings.dart.days;
  // DART 과거 백필용 창 직접 지정(YYYYMMDD). 지정 시 days 대신 사용.
  const dartBgnDe = /^\d{8}$/.test(process.env.INTEL_BATCH_DART_BGN_DE ?? "") ? process.env.INTEL_BATCH_DART_BGN_DE : undefined;
  const dartEndDe = /^\d{8}$/.test(process.env.INTEL_BATCH_DART_END_DE ?? "") ? process.env.INTEL_BATCH_DART_END_DE : undefined;
  // INTEL_BATCH_ONLY=dart 면 다른 소스는 건너뛴다(백필 반복 실행 시 낭비 방지)
  const only = (process.env.INTEL_BATCH_ONLY ?? "").trim().toLowerCase();
  console.log(`[intel-batch] start days=${days} cutoff=${cutoff ?? "none"}${dartBgnDe ? ` dartRange=${dartBgnDe}~${dartEndDe ?? "today"}` : ""}${only ? ` only=${only}` : ""}`);

  if (settings.dart.enabled && (!only || only === "dart")) {
    const started = Date.now();
    const result = await collectDartSignals({
      ...(dartBgnDe ? { bgnDe: dartBgnDe, endDe: dartEndDe } : { days }),
      ...(settings.dart.counterpartyScan ? {} : { maxDocs: 0 }),
    }); // maxPages 미지정 = 전 페이지 완주
    console.log(`[intel-batch] dart done in ${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(result));
  } else {
    console.log("[intel-batch] dart skipped");
  }

  if (only && only !== "dart") {
    console.log(`[intel-batch] unknown INTEL_BATCH_ONLY=${only} — nothing else to run`);
  }
  if (only) {
    process.exit(0);
  }

  // EIASS 는 개별 실패가 DART 결과를 잃게 하지 않도록 분리 실행(실패해도 exit 0 유지, 로그로 확인).
  if (settings.eiass.enabled) {
    try {
      const eiassPages =
        Number(process.env.INTEL_BATCH_EIASS_PAGES) > 0
          ? Number(process.env.INTEL_BATCH_EIASS_PAGES)
          : settings.eiass.maxPages;
      const eiassStarted = Date.now();
      const eiassResult = await collectEiassSignals({
        maxPages: eiassPages,
        positiveKeywords: settings.eiass.positiveKeywords,
        negativeKeywords: settings.eiass.negativeKeywords,
        disclosureCutoffIso: cutoff,
        industries: settings.industries.list,
      });
      console.log(
        `[intel-batch] eiass done in ${Math.round((Date.now() - eiassStarted) / 1000)}s`,
        JSON.stringify(eiassResult)
      );
    } catch (err) {
      console.error("[intel-batch] eiass error", err);
    }
  }

  // 보도자료도 소스별 분리 실행 — 개별 실패가 전체를 막지 않는다.
  if (settings.press.enabled) {
    try {
      const pressStarted = Date.now();
      const pressResult = await collectPressSignals({
        adapters: settings.press.adapters,
        titleKeywords: settings.press.titleKeywords,
        deptKeywords: settings.press.deptKeywords,
        disclosureCutoffIso: cutoff,
        industries: settings.industries.list,
      });
      console.log(
        `[intel-batch] press done in ${Math.round((Date.now() - pressStarted) / 1000)}s`,
        JSON.stringify(pressResult)
      );
    } catch (err) {
      console.error("[intel-batch] press error", err);
    }
  }

  // 네이버 뉴스: 설정 키워드 × 최신 N건 → Haiku 분류(link 중복은 분류 전에 skip).
  if (settings.news.enabled) {
    try {
      const newsStarted = Date.now();
      const newsResult = await collectNewsSignals({
        keywords: settings.news.keywords,
        displayPerKeyword: settings.news.displayPerKeyword,
        industries: settings.industries.list,
        ...(settings.news.maxClassify > 0 ? { maxClassify: settings.news.maxClassify } : {}),
      });
      console.log(
        `[intel-batch] news done in ${Math.round((Date.now() - newsStarted) / 1000)}s`,
        JSON.stringify(newsResult)
      );
    } catch (err) {
      console.error("[intel-batch] news error", err);
    }
  }

  // 고시공고(토지이음 산단 고시 + 환경청 8곳 RSS) — LLM 미사용, 경량.
  if (settings.gosi.enabled) {
    try {
      const gosiStarted = Date.now();
      const gosiResult = await collectGosiSignals({
        maxPagesPerKeyword: settings.gosi.maxPagesPerKeyword,
        eumKeywords: settings.gosi.eumKeywords,
        rssEnabled: settings.gosi.rssEnabled,
        disclosureCutoffIso: cutoff,
      });
      console.log(
        `[intel-batch] gosi done in ${Math.round((Date.now() - gosiStarted) / 1000)}s`,
        JSON.stringify(gosiResult)
      );
    } catch (err) {
      console.error("[intel-batch] gosi error", err);
    }
  }

  // 커스텀 소스(범용 스크래퍼, purpose='intel'): DB에 등록·활성화된 소스×엔드포인트 순회.
  // 개별 실패 격리(하나 실패해도 나머지·임베딩 계속). intel_signals 로 적재된다.
  try {
    const customDb = await getDb();
    const collectors = await listEnabledCustomCollectors(customDb, "intel");
    for (const { source, endpoint } of collectors) {
      try {
        const started = Date.now();
        const r = await collectCustomSource(source, endpoint, {});
        console.log(
          `[intel-batch] custom:${source.slug} done in ${Math.round((Date.now() - started) / 1000)}s`,
          JSON.stringify({ scanned: r.scanned, inserted: r.inserted, matched: r.matched, error: r.error })
        );
      } catch (err) {
        console.error(`[intel-batch] custom:${source.slug} error`, err);
      }
    }
  } catch (err) {
    console.error("[intel-batch] custom sources error", err);
  }

  // 공공입찰(bid) 커스텀 소스: purpose='bid' 소스×엔드포인트 순회 → 종류별 bid 테이블 적재. 개별 실패 격리.
  try {
    const bidDb = await getDb();
    const bidCollectors = await listEnabledCustomCollectors(bidDb, "bid");
    for (const { source, endpoint } of bidCollectors) {
      try {
        const started = Date.now();
        const r = await collectBidSource(source, endpoint, {});
        console.log(
          `[intel-batch] bid:${source.slug} done in ${Math.round((Date.now() - started) / 1000)}s`,
          JSON.stringify({ bidType: r.bidType, scanned: r.scanned, inserted: r.inserted, error: r.error })
        );
      } catch (err) {
        console.error(`[intel-batch] bid:${source.slug} error`, err);
      }
    }
  } catch (err) {
    console.error("[intel-batch] bid sources error", err);
  }

  // 백필(과거 대량 수집) 진행 — running 상태 엔드포인트를 실행당 최대 N개월씩 이어서 수집.
  // UI에서 시작/중지, 배치는 매일 조금씩 과거로 확장한다(호출량 분산). 개별 실패 격리.
  try {
    const bfDb = await getDb();
    const maxChunks = Number(process.env.INTEL_BATCH_BACKFILL_CHUNKS) > 0 ? Number(process.env.INTEL_BATCH_BACKFILL_CHUNKS) : 12;
    const all = [
      ...(await listEnabledCustomCollectors(bfDb, "intel")),
      ...(await listEnabledCustomCollectors(bfDb, "bid")),
    ];
    for (const { source, endpoint } of all) {
      const st = endpoint.backfill as BackfillState | null;
      if (!st || st.status !== "running" || !endpoint.apiConfig?.date_filters?.length) continue;
      let cursor = st.cursor;
      for (let i = 0; i < maxChunks; i++) {
        if (totalMonths(cursor, st.to) === 0) break;
        const chunk = cursor;
        try {
          const cfg = buildChunkConfig(endpoint.apiConfig, chunk);
          if (cfg.pagination) cfg.pagination = { ...cfg.pagination, max_pages: Math.max(cfg.pagination.max_pages || 1, 200) };
          const chunkEp = { ...endpoint, apiConfig: cfg };
          const r = source.purpose === "bid"
            ? await collectBidSource(source, chunkEp)
            : await collectCustomSource(source, chunkEp);
          cursor = nextYm(chunk);
          const finished = totalMonths(cursor, st.to) === 0;
          const next: BackfillState = {
            ...st,
            cursor,
            status: finished ? "done" : "running",
            updated_at: new Date().toISOString(),
            last_result: {
              chunk,
              scanned: r.scanned,
              inserted: r.inserted,
              updated: (r as { updated?: number }).updated ?? 0,
              ...(r.error ? { error: r.error } : {}),
            },
          };
          await updateEndpoint(endpoint.endpointId, { backfill: next as unknown as Record<string, unknown> });
          console.log(`[intel-batch] backfill ${source.slug}/${endpoint.name} ${chunk}: +${r.inserted} (scan ${r.scanned})${finished ? " done" : ""}`);
          if (finished) break;
        } catch (err) {
          console.error(`[intel-batch] backfill ${source.slug}/${endpoint.name} ${chunk} error`, err);
          break; // 이 엔드포인트는 중단(cursor 보존) — 다음 배치에서 재시도
        }
      }
    }
  } catch (err) {
    console.error("[intel-batch] backfill error", err);
  }

  // 마지막: 신규 수집분 벡터 임베딩 적재(D단계 RAG). 미적재분을 500건씩 소진.
  // VOYAGE_API_KEY 미설정이면 skip. 실패해도 수집 결과에는 영향 없음(exit 0 유지).
  try {
    const embStarted = Date.now();
    let indexed = 0;
    let remaining = -1;
    for (let i = 0; i < 40; i++) { // 안전 상한 40회(2만건) — 일일 증분에는 충분
      const r = await indexPendingEmbeddings(500);
      if (!r.configured) {
        console.log("[intel-batch] embed skipped (VOYAGE_API_KEY not set)");
        remaining = -1;
        break;
      }
      indexed += r.indexed;
      remaining = r.remaining;
      if (r.remaining === 0 || r.indexed === 0) break;
    }
    console.log(
      `[intel-batch] embed done in ${Math.round((Date.now() - embStarted) / 1000)}s indexed=${indexed}${remaining >= 0 ? ` remaining=${remaining}` : ""}`
    );
    // 임베딩 이후: 뉴스 중복(동일 사건 변형 기사) 병합 마킹 — 삭제 없이 duplicate_of 기록
    if (remaining >= 0) {
      const dedup = await markNewsDuplicates();
      console.log(`[intel-batch] dedup done marked=${dedup.marked} total=${dedup.totalDuplicates}`);
    }
  } catch (err) {
    console.error("[intel-batch] embed error", err);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[intel-batch] error", err);
  process.exit(1);
});
