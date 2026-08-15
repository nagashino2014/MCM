#Requires -Version 5.1
<#
.SYNOPSIS
  MCM 스테이징 next 서비스 자동 켜고/끄기 스케줄 설치/해제 (EventBridge Scheduler).
  매일 08:00 기동 / 평일 22:00 정지 / 주말 20:00 정지 (Asia/Seoul).

.DESCRIPTION
  - Lambda 없이 Scheduler universal target 으로 ecs:UpdateService 를 직접 호출한다.
  - Aurora 는 커넥션 기반 auto-pause 라 건드리지 않는다(README 참고).
  - backend(OCR)·bastion 은 스케줄 대상이 아님 — 필요 시 staging-start.ps1 -Backend 수동.
  - 멱등: 재실행 시 기존 스케줄을 update 한다.
  - 정지 시각 이후 작업이 이어지면 staging-start.ps1 로 다시 올리면 된다(다음 정지 시각까지 유지).

  ⚠ 2026-08-14 현재 이 스케줄은 **해제**되어 있다(-Remove 적용). next 는 24/7 상시 가동한다.
    22시 정지가 야간 작업을 끊어 불편했고, 틱의 설정 캐시(frontend/lib/tick-cache.ts)로
    유휴 시간 Aurora auto-pause 가 살아나 상시 가동 추가 비용이 월 $10 대로 내려갔기 때문.
    다시 자동 정지를 쓰려면 인자 없이 실행하면 된다.

.EXAMPLE
  pwsh infra/aws/ops/staging-schedule-setup.ps1            # 스케줄 설치/갱신
  pwsh infra/aws/ops/staging-schedule-setup.ps1 -Remove    # 스케줄 삭제(=24/7 상시 가동)
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2",
  [switch]$Remove     # 스케줄 3종을 삭제해 자동 정지를 끈다(그룹·IAM 롤은 남겨 재설치가 쉽도록)
)
# aws cli 는 "존재 확인" 호출이 정상적으로도 stderr 를 내므로 Stop 을 쓰지 않고
# $LASTEXITCODE 로 성패를 직접 판정한다(PS 5.1 NativeCommandError 함정).
$ErrorActionPreference = "Continue"
$env:AWS_PROFILE = $AwsProfile

$account   = "195748745315"
$cluster   = "mcm-ieps-staging"
$service   = "mcm-ieps-staging-next"
$roleName  = "mcm-ieps-staging-scheduler"
$groupName = "mcm-ieps-staging-ops"
$tz        = "Asia/Seoul"

function Log($m) { Write-Host "[schedule] $m" }

$scheduleNames = @("next-start-daily", "next-stop-weekday", "next-stop-weekend")

# 0) -Remove: 스케줄 3종만 삭제하고 끝낸다(그룹·IAM 롤은 남겨 재설치가 인자 없는 재실행으로 끝나게).
if ($Remove) {
  foreach ($n in $scheduleNames) {
    $exists = (aws scheduler get-schedule --name $n --group-name $groupName --query "Name" --output text 2>$null)
    if ($LASTEXITCODE -eq 0 -and $exists) {
      Log "delete-schedule $n"
      aws scheduler delete-schedule --name $n --group-name $groupName | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "$n 스케줄 삭제 실패" }
    } else {
      Log "$n 없음 (skip)"
    }
  }
  Log "완료. 자동 정지 해제 — next 는 상시 가동된다(내리려면 staging-stop.ps1 수동 실행)."
  Log "⚠ 지금 next 가 desired 0 이면 staging-start.ps1 로 한 번 올려야 한다."
  return
}

# 1) Scheduler 가 assume 할 IAM 롤 (+ next UpdateService 만 허용하는 인라인 정책)
$trust = @'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"scheduler.amazonaws.com"},"Action":"sts:AssumeRole"}]}
'@
$policy = @"
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"ecs:UpdateService","Resource":"arn:aws:ecs:${Region}:${account}:service/${cluster}/${service}"}]}
"@
$trustPath  = Join-Path $env:TEMP "sched_trust.json"
$policyPath = Join-Path $env:TEMP "sched_policy.json"
[IO.File]::WriteAllText($trustPath, $trust)
[IO.File]::WriteAllText($policyPath, $policy)

$roleArn = (aws iam get-role --role-name $roleName --query "Role.Arn" --output text 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $roleArn) {
  Log "IAM 롤 생성: $roleName"
  $roleArn = (aws iam create-role --role-name $roleName --assume-role-policy-document "file://$trustPath" --query "Role.Arn" --output text)
  if ($LASTEXITCODE -ne 0) { throw "IAM 롤 생성 실패" }
} else {
  Log "IAM 롤 존재: $roleName"
}
aws iam put-role-policy --role-name $roleName --policy-name "ecs-update-next" --policy-document "file://$policyPath" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "IAM 인라인 정책 부여 실패" }

# 2) 스케줄 그룹
$grp = (aws scheduler get-schedule-group --name $groupName --query "Name" --output text 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $grp) {
  Log "스케줄 그룹 생성: $groupName"
  aws scheduler create-schedule-group --name $groupName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "스케줄 그룹 생성 실패" }
}

# 3) 스케줄 3종 — universal target 파라미터는 PascalCase
function Set-EcsSchedule([string]$name, [string]$cron, [int]$desired) {
  $input = "{`"Cluster`":`"$cluster`",`"Service`":`"$service`",`"DesiredCount`":$desired}"
  $target = "{`"Arn`":`"arn:aws:scheduler:::aws-sdk:ecs:updateService`",`"RoleArn`":`"$roleArn`",`"Input`":$($input | ConvertTo-Json)}"
  $targetPath = Join-Path $env:TEMP "sched_target_$name.json"
  [IO.File]::WriteAllText($targetPath, $target)
  $exists = (aws scheduler get-schedule --name $name --group-name $groupName --query "Name" --output text 2>$null)
  $verb = if ($LASTEXITCODE -eq 0 -and $exists) { "update-schedule" } else { "create-schedule" }
  Log "$verb $name — $cron ($tz) -> desired $desired"
  aws scheduler $verb --name $name --group-name $groupName `
    --schedule-expression $cron --schedule-expression-timezone $tz `
    --flexible-time-window Mode=OFF `
    --target "file://$targetPath" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "$name 스케줄 $verb 실패" }
}

Set-EcsSchedule "next-start-daily"   "cron(0 8 * * ? *)"        1
Set-EcsSchedule "next-stop-weekday"  "cron(0 22 ? * MON-FRI *)" 0
Set-EcsSchedule "next-stop-weekend"  "cron(0 20 ? * SAT,SUN *)" 0

Log "완료. 매일 08:00 기동 / 평일 22:00·주말 20:00 정지 (Asia/Seoul)"
