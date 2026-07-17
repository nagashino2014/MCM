/**
 * OCR 백엔드 on-demand 기동.
 * - 비용 절감으로 backend ECS 서비스는 평소 desired=0(유휴 시 backend-idle-shutdown Lambda가 내림).
 * - 파싱 요청 시 백엔드가 꺼져 있으면 여기서 desired=1 로 기동을 트리거한다(블로킹 대기 없음).
 * - 콜드스타트(이미지 ~15GB pull + PaddleOCR 로드)는 수 분 걸리므로, 호출부는 "기동 중, 잠시 후 재시도"를 안내한다.
 * - idle-shutdown Lambda가 유휴 60분 뒤 다시 자동으로 내린다.
 */

import { ECSClient, DescribeServicesCommand, UpdateServiceCommand } from "@aws-sdk/client-ecs";

const CLUSTER = process.env.MCM_ECS_CLUSTER || "mcm-ieps-staging";
const BACKEND_SERVICE = process.env.MCM_BACKEND_SERVICE || "mcm-ieps-staging-backend";

export type BackendWarmup =
  | "running"      // 이미 태스크 가동 중(파싱 실패는 일시적/백엔드 오류)
  | "starting"     // 기동을 트리거함(또는 이미 기동 중)
  | "unavailable"; // 권한/설정 부재로 ECS 제어 불가

/**
 * 백엔드가 미가동이면 desired=1 로 기동을 트리거한다. 완료를 기다리지 않는다.
 */
export async function ensureBackendRunning(): Promise<BackendWarmup> {
  try {
    const ecs = new ECSClient({ region: process.env.AWS_REGION || "ap-northeast-2" });
    const desc = await ecs.send(
      new DescribeServicesCommand({ cluster: CLUSTER, services: [BACKEND_SERVICE] })
    );
    const svc = desc.services?.[0];
    const running = svc?.runningCount ?? 0;
    const desired = svc?.desiredCount ?? 0;

    if (running >= 1) return "running";
    if (desired < 1) {
      await ecs.send(
        new UpdateServiceCommand({ cluster: CLUSTER, service: BACKEND_SERVICE, desiredCount: 1 })
      );
    }
    return "starting";
  } catch (err) {
    console.warn("[backend-warmup] ECS 제어 실패: " + (err as Error).message);
    return "unavailable";
  }
}
