#Requires -Version 5.1
<#
.SYNOPSIS
  MCM 스테이징을 idle 상태로 내려 과금을 최소화한다.
  ECS(next/backend) desired-count=0, bastion EC2 stop, Aurora 클러스터 stop.

.DESCRIPTION
  개발자 1인 스테이징 환경에서 "지금 안 쓴다" 싶을 때 실행한다.
  - Fargate(next/backend): 태스크가 내려가 vCPU/GB-Hours 과금 중단 (월 ~$100 중 대부분)
  - bastion: DB 점프박스 정지 (월 ~$18)
  - Aurora Serverless v2: 별도 stop 명령 불필요. min 0 ACU auto-pause 설정이라
    ECS 가 내려가 DB 커넥션이 끊기면 300초 뒤 자동 일시정지되어 ACU 과금이 0 이 된다.
    (staging-start.ps1 로 next 를 올리면 커넥션 발생 시 수 초 내 자동 재개)

  ※ NAT Gateway / ALB / EBS·S3 스토리지 / Route53 등 고정 리소스는 계속 과금된다(완전 중단 아님).
    이들까지 없애려면 NAT 제거 리팩터가 필요(현재 범위 밖).

.EXAMPLE
  pwsh infra/aws/ops/staging-stop.ps1
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2"
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $AwsProfile

$ecsCluster = "mcm-ieps-staging"
$services   = @("mcm-ieps-staging-next", "mcm-ieps-staging-backend")

function Log($m) { Write-Host "[stop] $m" }

# 1) ECS 서비스 desired-count -> 0
foreach ($svc in $services) {
  Log "ECS $svc desired-count -> 0"
  aws ecs update-service --cluster $ecsCluster --service $svc --desired-count 0 --region $Region --no-cli-pager | Out-Null
}

# 2) bastion EC2 stop (태그로 조회 — 인스턴스 id 변경에 견고)
$bastion = aws ec2 describe-instances --region $Region `
  --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=running,pending,stopping" `
  --query "Reservations[].Instances[].InstanceId" --output text
if ($bastion) {
  Log "bastion stop: $bastion"
  aws ec2 stop-instances --instance-ids $bastion --region $Region --no-cli-pager | Out-Null
} else {
  Log "bastion: 실행 중 인스턴스 없음 (skip)"
}

# 3) Aurora: 별도 stop 불필요. ECS 가 0 이 되어 커넥션이 끊기면 300초 뒤 auto-pause.
Log "Aurora: min 0 ACU auto-pause 설정 -> 커넥션 끊기면 자동 일시정지(수동 stop 불필요)"

Log "완료. (참고: NAT/ALB/스토리지 등 고정 리소스는 계속 과금됨)"
