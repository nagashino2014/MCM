/**
 * 외부 메일 프로그램 게이트웨이 ECS 서비스 켜기·끄기(관리자 연결 허용 스위치와 연동).
 * 스위치를 켜면 서비스를 1대로 올리고, 끄면 0대로 내려 상시 비용(Fargate)을 멈춘다. NLB 는 그대로 남는다.
 * 권한: next 태스크 역할의 app_access 정책(ecs:DescribeServices·UpdateService, 같은 클러스터 한정 — backend-warmup 과 공용).
 * 순서: 켤 때는 서버를 먼저 올리고 허용을 저장, 끌 때는 허용을 먼저 끊고(붙어 있던 연결은 1분 안에 BYE) 서버를 내린다.
 */
import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from "@aws-sdk/client-ecs";

const CLUSTER = process.env.MAIL_GATEWAY_ECS_CLUSTER || process.env.MCM_ECS_CLUSTER || "mcm-ieps-staging";
const SERVICE = process.env.MAIL_GATEWAY_ECS_SERVICE || `${CLUSTER}-mail-gateway`;

export interface GatewayServiceStatus {
  /** ECS 서비스를 조회할 수 있었는지(권한·서비스 부재·로컬 개발이면 false). */
  available: boolean;
  desired: number;
  running: number;
  pending: number;
  /** 화면 표시용 상태. */
  state: "running" | "starting" | "stopping" | "stopped" | "unavailable";
  error?: string;
}

/** ECS 호출 경계(테스트에서 바꿔 끼운다). */
export interface GatewayEcs {
  describe(): Promise<{ desired: number; running: number; pending: number } | null>;
  setDesired(count: number): Promise<void>;
}

function defaultEcs(): GatewayEcs {
  const ecs = new ECSClient({ region: process.env.AWS_REGION || "ap-northeast-2" });
  return {
    async describe() {
      const out = await ecs.send(new DescribeServicesCommand({ cluster: CLUSTER, services: [SERVICE] }));
      const svc = out.services?.find((s) => s.status === "ACTIVE");
      if (!svc) return null;
      return { desired: svc.desiredCount ?? 0, running: svc.runningCount ?? 0, pending: svc.pendingCount ?? 0 };
    },
    async setDesired(count: number) {
      await ecs.send(new UpdateServiceCommand({ cluster: CLUSTER, service: SERVICE, desiredCount: count }));
    },
  };
}

export function toStatus(d: { desired: number; running: number; pending: number } | null, error?: string): GatewayServiceStatus {
  if (!d) return { available: false, desired: 0, running: 0, pending: 0, state: "unavailable", error };
  let state: GatewayServiceStatus["state"];
  if (d.desired > 0) state = d.running >= d.desired ? "running" : "starting";
  else state = d.running > 0 || d.pending > 0 ? "stopping" : "stopped";
  return { available: true, ...d, state };
}

export async function getGatewayServiceStatus(ecs: GatewayEcs = defaultEcs()): Promise<GatewayServiceStatus> {
  try {
    const d = await ecs.describe();
    return toStatus(d, d ? undefined : "게이트웨이 서비스가 없습니다(인프라 미구성).");
  } catch (err) {
    return toStatus(null, (err as Error).message);
  }
}

/**
 * 연결 허용 값에 맞춰 서비스 대수를 맞춘다(켜짐=1, 꺼짐=0). 이미 맞으면 호출하지 않는다.
 * 실패해도 던지지 않고 상태에 오류를 담아 돌려준다 — 허용 설정 저장 자체는 막지 않는다.
 */
export async function syncGatewayService(enabled: boolean, ecs: GatewayEcs = defaultEcs()): Promise<GatewayServiceStatus> {
  try {
    const d = await ecs.describe();
    if (!d) return toStatus(null, "게이트웨이 서비스가 없습니다(인프라 미구성).");
    const want = enabled ? 1 : 0;
    if (d.desired !== want) {
      await ecs.setDesired(want);
      return toStatus({ ...d, desired: want });
    }
    return toStatus(d);
  } catch (err) {
    console.warn("[mail-gateway-service] ECS 제어 실패: " + (err as Error).message);
    return toStatus(null, (err as Error).message);
  }
}
