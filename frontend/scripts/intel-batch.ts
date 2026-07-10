// 야간 배치 엔트리: DART 신호 전량 수집(모집단 역전) + EIASS 협의진행현황 증분 수집. ECS RunTask에서 실행.
// next 이미지의 node_modules(pg·undici 등)를 그대로 쓰고, 소스는 esbuild로 단일 번들(.next/intel-batch.cjs).
// 환경변수: INTEL_BATCH_DAYS(기본 1=전일 증분), INTEL_BATCH_EIASS_PAGES(kind당 리스트 페이지, 기본 5.
//           백필 시 크게 — 예: 400이면 소규모 전량). DB/DART/ANTHROPIC 설정은 next task def env 재사용.
import { getDb } from "@/lib/db";
import { collectDartSignals } from "@/lib/intel/collect";
import { collectEiassSignals } from "@/lib/intel/collect-eiass";
import { collectGosiSignals } from "@/lib/intel/collect-gosi";
import { collectNewsSignals } from "@/lib/intel/collect-news";
import { collectPressSignals } from "@/lib/intel/collect-press";
import { disclosureCutoffIso, loadIntelSettings } from "@/lib/intel/intel-settings";

async function main() {
  // 수집 설정(intel_settings)을 읽어 각 수집기에 전달. env 는 설정보다 우선(백필 오버라이드용).
  const settings = await loadIntelSettings(await getDb());
  const cutoff = disclosureCutoffIso(settings);
  const days = Number(process.env.INTEL_BATCH_DAYS) > 0 ? Number(process.env.INTEL_BATCH_DAYS) : settings.dart.days;
  console.log(`[intel-batch] start days=${days} cutoff=${cutoff ?? "none"}`);

  if (settings.dart.enabled) {
    const started = Date.now();
    const result = await collectDartSignals({
      days,
      ...(settings.dart.counterpartyScan ? {} : { maxDocs: 0 }),
    }); // maxPages 미지정 = 전 페이지 완주
    console.log(`[intel-batch] dart done in ${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(result));
  } else {
    console.log("[intel-batch] dart disabled by settings");
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
  process.exit(0);
}

main().catch((err) => {
  console.error("[intel-batch] error", err);
  process.exit(1);
});
