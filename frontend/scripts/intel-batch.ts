// 야간 배치 엔트리: DART 신호 전량 수집(모집단 역전) + EIASS 협의진행현황 증분 수집. ECS RunTask에서 실행.
// next 이미지의 node_modules(pg·undici 등)를 그대로 쓰고, 소스는 esbuild로 단일 번들(.next/intel-batch.cjs).
// 환경변수: INTEL_BATCH_DAYS(기본 1=전일 증분), INTEL_BATCH_EIASS_PAGES(kind당 리스트 페이지, 기본 5.
//           백필 시 크게 — 예: 400이면 소규모 전량). DB/DART/ANTHROPIC 설정은 next task def env 재사용.
import { collectDartSignals } from "@/lib/intel/collect";
import { collectEiassSignals } from "@/lib/intel/collect-eiass";
import { collectNewsSignals } from "@/lib/intel/collect-news";
import { collectPressSignals } from "@/lib/intel/collect-press";

async function main() {
  const days = Number(process.env.INTEL_BATCH_DAYS) > 0 ? Number(process.env.INTEL_BATCH_DAYS) : 1;
  console.log(`[intel-batch] start days=${days}`);
  const started = Date.now();
  const result = await collectDartSignals({ days }); // maxPages 미지정 = 전 페이지 완주
  console.log(`[intel-batch] dart done in ${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(result));

  // EIASS 는 개별 실패가 DART 결과를 잃게 하지 않도록 분리 실행(실패해도 exit 0 유지, 로그로 확인).
  try {
    const eiassPages = Number(process.env.INTEL_BATCH_EIASS_PAGES) > 0 ? Number(process.env.INTEL_BATCH_EIASS_PAGES) : 5;
    const eiassStarted = Date.now();
    const eiassResult = await collectEiassSignals({ maxPages: eiassPages });
    console.log(
      `[intel-batch] eiass done in ${Math.round((Date.now() - eiassStarted) / 1000)}s`,
      JSON.stringify(eiassResult)
    );
  } catch (err) {
    console.error("[intel-batch] eiass error", err);
  }

  // 보도자료(울산·전남·경북·mcee)도 소스별 분리 실행 — 개별 실패가 전체를 막지 않는다.
  try {
    const pressStarted = Date.now();
    const pressResult = await collectPressSignals();
    console.log(
      `[intel-batch] press done in ${Math.round((Date.now() - pressStarted) / 1000)}s`,
      JSON.stringify(pressResult)
    );
  } catch (err) {
    console.error("[intel-batch] press error", err);
  }

  // 네이버 뉴스: 키워드 8개 × 최신 30건 → Haiku 분류(하루 최대 ~240콜, link 중복은 skip).
  try {
    const newsStarted = Date.now();
    const newsResult = await collectNewsSignals();
    console.log(
      `[intel-batch] news done in ${Math.round((Date.now() - newsStarted) / 1000)}s`,
      JSON.stringify(newsResult)
    );
  } catch (err) {
    console.error("[intel-batch] news error", err);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[intel-batch] error", err);
  process.exit(1);
});
