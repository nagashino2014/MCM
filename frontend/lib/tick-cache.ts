/**
 * 인프로세스 주기 틱(instrumentation.ts)이 "지금 할 일이 없음" 을 DB 조회 없이 판정하기 위한
 * 설정 TTL 캐시.
 *
 * ⚠ 왜 필요한가 — Aurora Serverless v2 는 커넥션이 끊긴 뒤 300초(infra/aws/main.tf 의
 *   seconds_until_auto_pause)에 auto-pause 되어 ACU 과금이 0 이 된다. 그런데 5분 주기 틱이
 *   매번 설정 테이블을 조회하면 트래픽이 없는 야간에도 커넥션이 계속 들어와 auto-pause 가
 *   영원히 발동하지 못한다(= next 를 24/7 로 띄우면 ACU 가 24시간 과금). 설정은 자주 바뀌지
 *   않으므로 TTL 동안 캐시해 조회 자체를 없앤다. ALB 헬스체크가 DB 를 안 건드리는 것과 같은 이유.
 *
 * 규칙 — 캐시는 **사전 판정(=할 일 없음 확인)에만** 쓰고, 실제 작업은 항상 DB 최신값으로 한다.
 *   캐시가 낡으면 "할 일이 있을 수도" 쪽으로만 틀리고(→ 최신 로드로 넘어감), "할 일 없음" 을
 *   잘못 단정하지 않는다. 따라서 중복 발송·중복 수집이 생기지 않는다.
 *   설정 저장 경로에서는 invalidateTickCache 로 즉시 무효화해 UI 변경이 바로 반영된다.
 *
 * next 는 ECS 단일 태스크라 프로세스 내 캐시로 충분하다(instrumentation.ts 와 같은 전제).
 */

/** 공공입찰 발송 설정(intel_settings) */
export const TICK_CACHE_BID_NOTIFY = "bid-notify-config";
/** 공공입찰 수집 소스·엔드포인트(scraper_sources/endpoints) */
export const TICK_CACHE_BID_COLLECTORS = "bid-collectors";
/** 미결재 리마인드 설정(approval_notify_settings) */
export const TICK_CACHE_APPROVAL_REMIND = "approval-remind-setting";

/** 설정 변경은 저장 경로에서 invalidate 되므로 길게 잡아도 안전하다. */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

const store = new Map<string, { loadedAt: number; value: unknown }>();

/**
 * key 의 캐시가 살아 있으면 그대로 주고, 없으면 loader 로 채운다.
 * 틱이 겹쳐 loader 가 중복 실행돼도 결과가 같으므로 락은 두지 않는다.
 */
export async function loadTickCached<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.loadedAt < ttlMs) return hit.value as T;
  const value = await loader();
  store.set(key, { loadedAt: Date.now(), value });
  return value;
}

/** 설정 저장·상태 기록 직후 호출 — 다음 틱이 최신값을 다시 읽는다. */
export function invalidateTickCache(key: string): void {
  store.delete(key);
}
