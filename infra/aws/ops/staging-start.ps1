#Requires -Version 5.1
<#
.SYNOPSIS
  staging-stop.ps1 로 내려둔 MCM 스테이징을 다시 기동한다.
  Aurora start(+available 대기) -> ECS next=1 -> (옵션) backend/bastion.

.DESCRIPTION
  기본값은 "UI 개발 최소 구성": Aurora + next(웹) 만 올린다.
  - OCR/파싱 작업이 필요하면 -Backend 로 backend 서비스도 기동.
  - DB 에 직접 붙어야 하면(SSM 포트포워딩) -Bastion 으로 점프박스도 기동.

.EXAMPLE
  .\infra\aws\ops\staging-start.ps1                 # Aurora + next 만
  .\infra\aws\ops\staging-start.ps1 -Backend        # + OCR 백엔드
  .\infra\aws\ops\staging-start.ps1 -Backend -Bastion
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2",
  [switch]$Backend,   # OCR 백엔드(2vCPU/8GB, 비쌈)도 기동
  [switch]$Bastion    # DB 접속용 bastion 도 기동
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $AwsProfile

$ecsCluster = "mcm-ieps-staging"

function Log($m) { Write-Host "[start] $m" }

# Aurora 는 min 0 ACU auto-pause 라 별도 start 불필요.
# next 태스크가 떠서 첫 커넥션을 열면 수 초 내 자동 재개된다.
Log "Aurora: auto-pause 상태면 첫 DB 커넥션에서 자동 재개(수 초)"

# 1) next 웹 서비스 기동
Log "ECS next desired-count -> 1"
aws ecs update-service --cluster $ecsCluster --service mcm-ieps-staging-next --desired-count 1 --region $Region --no-cli-pager | Out-Null

# 2) backend (옵션)
if ($Backend) {
  Log "ECS backend desired-count -> 1 (OCR)"
  aws ecs update-service --cluster $ecsCluster --service mcm-ieps-staging-backend --desired-count 1 --region $Region --no-cli-pager | Out-Null
} else {
  Log "backend skip (OCR 필요 시 -Backend)"
}

# 3) bastion (옵션)
if ($Bastion) {
  $b = aws ec2 describe-instances --region $Region `
    --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=stopped,stopping" `
    --query "Reservations[].Instances[].InstanceId" --output text
  if ($b) {
    Log "bastion start: $b"
    aws ec2 start-instances --instance-ids $b --region $Region --no-cli-pager | Out-Null
  } else {
    Log "bastion: stopped 인스턴스 없음 (skip)"
  }
} else {
  Log "bastion skip (DB 직접접속 필요 시 -Bastion)"
}

Log "완료. next 태스크가 뜨는 데 1~2분, ALB 헬스체크 통과까지 추가로 걸릴 수 있음."
