#Requires -Version 5.1
<#
.SYNOPSIS
  MCM 스테이징 메일 게이트웨이(외부 메일 프로그램 IMAP/SMTP) 재배포 — next 이미지를 그대로 쓴다.

.DESCRIPTION
  게이트웨이는 next 이미지 안의 번들(.next/mail-gateway.cjs)을 명령만 바꿔 실행하는 상시 서비스다
  (infra/aws/mail-gateway.tf). 그래서 빌드하지 않고, staging-deploy-next.ps1 로 next 를 배포한 뒤 이 스크립트로
  게이트웨이를 같은 이미지 태그로 맞춘다.
  1) next 서비스의 현재 태스크 정의에서 image·DB/버킷 env·DB 시크릿을 가져온다(next 와 같은 DB 역할을 쓰게)
  2) 게이트웨이 서비스의 현재 태스크 정의를 받아 image·env·secrets 만 바꿔 새 리비전 등록
  3) update-service 로 적용(desired 는 유지 — 앱의 연결 허용 스위치가 1/0 을 정한다)

  - next 의 AUTH_SECRET·알림 자격증명 등은 옮기지 않는다(게이트웨이가 쓰지 않음 — 필요한 키만 화이트리스트).
  - 게이트웨이 서비스는 var.enable_mail_gateway=true 로 -target apply 한 뒤에만 있다.
  - 이미지에 .next/mail-gateway.cjs 가 없으면(이 기능 이전 이미지) 태스크가 바로 죽는다 — 로그 그룹
    /ecs/mcm-ieps-staging/mail-gateway 에서 "gateway.started" 를 확인한다.
  - 새 태스크로 바뀌면 붙어 있던 아웃룩 연결이 한 번 끊기고 클라이언트가 다시 붙는다.

.EXAMPLE
  .\infra\aws\ops\staging-deploy-mail-gateway.ps1 -Wait
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2",
  [switch]$Wait
)
# aws cli 는 정상 흐름에서도 stderr 를 내므로 Stop 을 쓰지 않고 $LASTEXITCODE 로 판정한다.
$ErrorActionPreference = "Continue"
$env:AWS_PROFILE = $AwsProfile

$cluster     = "mcm-ieps-staging"
$nextService = "mcm-ieps-staging-next"
$service     = "mcm-ieps-staging-mail-gateway"
$container   = "mail-gateway"

# next 에서 옮겨 올 env·시크릿(게이트웨이가 실제로 읽는 것만).
$envKeep    = @("NODE_ENV", "AWS_REGION", "MCM_STORAGE_BUCKET", "APP_PUBLIC_URL", "MAIL_DOMAIN",
                "PGHOST", "PGPORT", "PGDATABASE", "PGSSL", "PGSSL_REJECT_UNAUTHORIZED",
                "MCM_DB_ROLE_REQUIRED", "MCM_DB_EXPECTED_ROLE")
$secretKeep = @("PGUSER", "PGPASSWORD")

function Log($m)  { Write-Host "[deploy-mailgw] $m" }
function Fail($m) { Write-Host "[deploy-mailgw] 실패: $m" -ForegroundColor Red; exit 1 }

function Get-ServiceTaskDef($svc) {
  $arn = (aws ecs describe-services --cluster $cluster --services $svc --region $Region --query "services[0].taskDefinition" --output text)
  if ($LASTEXITCODE -ne 0 -or -not $arn -or $arn -eq "None") { Fail "서비스 $svc 의 태스크 정의를 찾지 못함" }
  $json = (aws ecs describe-task-definition --task-definition $arn --region $Region --query "taskDefinition" --output json)
  if ($LASTEXITCODE -ne 0) { Fail "태스크 정의 조회: $arn" }
  return @{ Arn = $arn; Td = ($json | ConvertFrom-Json) }
}

Log "next 태스크 정의 조회"
$next = Get-ServiceTaskDef $nextService
$nextC = $next.Td.containerDefinitions | Where-Object { $_.name -eq "next" }
if (-not $nextC) { Fail "next 컨테이너를 찾지 못함" }
Log "next 리비전: $($next.Arn)"
Log "image     : $($nextC.image)"

Log "게이트웨이 태스크 정의 조회"
$gw = Get-ServiceTaskDef $service
$td = $gw.Td
Log "현재 리비전: $($gw.Arn)"

foreach ($p in @("taskDefinitionArn", "revision", "status", "requiresAttributes",
                 "compatibilities", "registeredAt", "registeredBy", "deregisteredAt")) {
  $td.PSObject.Properties.Remove($p)
}
$target = $td.containerDefinitions | Where-Object { $_.name -eq $container }
if (-not $target) { Fail "컨테이너 '$container' 를 찾지 못함" }

# env: 게이트웨이 고유 값(MAIL_GW_*·MAIL_INBOUND_BUCKET)은 유지하고, next 공통 값은 next 쪽으로 맞춘다.
$own = @($target.environment | Where-Object { $envKeep -notcontains $_.name })
$fromNext = @($nextC.environment | Where-Object { $envKeep -contains $_.name })
$target.environment = @($own + $fromNext)
$target.secrets = @($nextC.secrets | Where-Object { $secretKeep -contains $_.name })
if (@($target.secrets).Count -ne 2) { Fail "next 태스크 정의에서 PGUSER·PGPASSWORD 시크릿을 찾지 못함" }
if (-not ($target.environment | Where-Object { $_.name -eq "MAIL_INBOUND_BUCKET" })) {
  Log "⚠ MAIL_INBOUND_BUCKET 이 없다 — 수신 원문 대신 DB 재구성본을 내려준다(동작은 한다)"
}
$target.image = $nextC.image
$td.executionRoleArn = $next.Td.executionRoleArn
$td.taskRoleArn = $next.Td.taskRoleArn

$tdPath = Join-Path $env:TEMP "mcm_mail_gateway_taskdef.json"
[IO.File]::WriteAllText($tdPath, ($td | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))
$newArn = (aws ecs register-task-definition --cli-input-json "file://$tdPath" --region $Region --query "taskDefinition.taskDefinitionArn" --output text)
if ($LASTEXITCODE -ne 0 -or -not $newArn) { Fail "태스크 정의 등록" }
Log "새 리비전: $newArn"

# desired 는 건드리지 않는다 — 앱의 [외부 메일 프로그램 연결 허용] 스위치가 1/0 으로 관리한다(꺼 둔 게이트웨이를 배포가 다시 켜지 않게).
$desiredNow = (aws ecs describe-services --cluster $cluster --services $service --region $Region --query "services[0].desiredCount" --output text)
Log "서비스 갱신 (desired 유지: $desiredNow)"
aws ecs update-service --cluster $cluster --service $service --task-definition $newArn --region $Region --no-cli-pager | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "update-service" }
if ("$desiredNow" -eq "0") { Log "연결 허용이 꺼져 있어 desired 0 — 새 리비전은 다음에 켤 때 적용된다" }

if ($Wait) {
  Log "배포 안정화 대기 (수 분)"
  aws ecs wait services-stable --cluster $cluster --services $service --region $Region
  if ($LASTEXITCODE -ne 0) { Fail "안정화 대기 타임아웃 — 콘솔에서 태스크 상태·로그 확인" }
  Log "안정화 완료"
}

Log "완료. 확인: openssl s_client -connect imap.koensain.app:993 -quiet  → '* OK [CAPABILITY ...] Koensain Mail IMAP ready'"
