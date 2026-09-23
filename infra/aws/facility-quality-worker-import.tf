# 2026-08-19 local state 이후 AWS에 생성된 인라인 정책을 R0B 변경 전에 편입한다.
# 새 정책으로 덮어쓰는 계획을 만들지 않고, 기존 본문과 의도한 PassRole 확장을 비교한다.
import {
  to = aws_iam_role_policy.facility_quality_worker_start
  id = "mcm-ieps-staging-ecs-task:mcm-ieps-staging-facility-quality-worker-start"
}
