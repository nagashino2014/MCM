// 야간 배치 엔트리: DART 신호 전량 수집(모집단 역전). ECS RunTask에서 실행.
// next 이미지의 node_modules(pg·undici 등)를 그대로 쓰고, 소스는 esbuild로 단일 번들(.next/intel-batch.cjs).
// 환경변수: INTEL_BATCH_DAYS(기본 1=전일 증분). DB/DART 설정은 next task def env 재사용.
import { collectDartSignals } from "@/lib/intel/collect";

async function main() {
  const days = Number(process.env.INTEL_BATCH_DAYS) > 0 ? Number(process.env.INTEL_BATCH_DAYS) : 1;
  console.log(`[intel-batch] start days=${days}`);
  const started = Date.now();
  const result = await collectDartSignals({ days }); // maxPages 미지정 = 전 페이지 완주
  console.log(`[intel-batch] done in ${Math.round((Date.now() - started) / 1000)}s`, JSON.stringify(result));
  process.exit(0);
}

main().catch((err) => {
  console.error("[intel-batch] error", err);
  process.exit(1);
});
