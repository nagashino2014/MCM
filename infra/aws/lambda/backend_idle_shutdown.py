"""
backend-idle-shutdown

유휴 상태의 OCR backend ECS 서비스를 자동으로 desired_count=0 으로 내려 비용을 절감한다.
EventBridge 스케줄(기본 10분마다)로 호출된다.

판정 로직:
- backend 서비스가 이미 0 이면 아무것도 안 함.
- 최근 IDLE_MINUTES(기본 60분) 동안의 ECS CPUUtilization(5분 평균)을 조회.
- 그 구간의 '최대' 평균 CPU 가 CPU_THRESHOLD(기본 3%) 미만이면 유휴로 보고 0 으로 내린다.
- 데이터포인트가 구간 전체를 못 덮으면(=최근에 막 기동됨) 내리지 않는다
  → 방금 켠 backend 를 곧바로 죽이는 오작동 방지.
"""

import os
import datetime

import boto3

ecs = boto3.client("ecs")
cw = boto3.client("cloudwatch")

CLUSTER = os.environ["CLUSTER"]
SERVICE = os.environ["SERVICE"]
IDLE_MINUTES = int(os.environ.get("IDLE_MINUTES", "60"))
CPU_THRESHOLD = float(os.environ.get("CPU_THRESHOLD", "3.0"))
PERIOD = 300  # 5분


def handler(event, context):
    svc = ecs.describe_services(cluster=CLUSTER, services=[SERVICE])["services"][0]
    desired = svc["desiredCount"]
    running = svc["runningCount"]
    print(f"{SERVICE}: desired={desired} running={running}")

    if desired == 0 and running == 0:
        print("already scaled to 0 — nothing to do")
        return {"action": "none", "reason": "already-zero"}

    now = datetime.datetime.utcnow()
    start = now - datetime.timedelta(minutes=IDLE_MINUTES)
    resp = cw.get_metric_statistics(
        Namespace="AWS/ECS",
        MetricName="CPUUtilization",
        Dimensions=[
            {"Name": "ClusterName", "Value": CLUSTER},
            {"Name": "ServiceName", "Value": SERVICE},
        ],
        StartTime=start,
        EndTime=now,
        Period=PERIOD,
        Statistics=["Average"],
    )
    datapoints = resp.get("Datapoints", [])
    needed = IDLE_MINUTES // (PERIOD // 60)  # 구간 전체를 덮는 최소 데이터포인트 수

    if len(datapoints) < needed:
        print(
            f"insufficient datapoints ({len(datapoints)}<{needed}); "
            "recently started or metric gap — skip shutdown"
        )
        return {"action": "none", "reason": "insufficient-data"}

    max_cpu = max(d["Average"] for d in datapoints)
    if max_cpu < CPU_THRESHOLD:
        print(f"idle: max CPU {max_cpu:.2f}% < {CPU_THRESHOLD}% over {IDLE_MINUTES}m — scaling to 0")
        ecs.update_service(cluster=CLUSTER, service=SERVICE, desiredCount=0)
        return {"action": "scaled-to-zero", "maxCpu": round(max_cpu, 2)}

    print(f"active: max CPU {max_cpu:.2f}% >= {CPU_THRESHOLD}% — keep running")
    return {"action": "none", "reason": "active", "maxCpu": round(max_cpu, 2)}
