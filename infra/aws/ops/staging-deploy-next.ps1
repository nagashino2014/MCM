#Requires -Version 5.1
<#
.SYNOPSIS
  MCM 스테이징 next(웹) 재배포 — 이미지 빌드 → ECR 푸시 → 태스크 정의 새 리비전 → 서비스 갱신.

.DESCRIPTION
  태스크 정의가 :latest 가 아니라 고정 태그를 가리키므로 force-new-deployment 만으로는
  새 이미지가 반영되지 않는다(옛 태그로 재시작될 뿐). 그래서 CLAUDE.md 의 배포 절차
  1) 빌드 → 설명 태그 + latest 로 푸시
  2) 현재 태스크 정의를 받아 image 만 새 태그로 바꿔 새 리비전 등록
  3) update-service 로 새 리비전 적용
  을 그대로 자동화한다.

  - 프론트 전용 변경은 next 이미지만 재배포하면 된다(백엔드 OCR 이미지는 ~15GB라 별도).
  - 빌드 컨텍스트는 repo 루트, Dockerfile 은 frontend/Dockerfile, 플랫폼 linux/amd64.
  - desired-count 1 을 함께 지정한다 — 자동 정지 해제 후 상시 가동이 기본이라서.

.EXAMPLE
  .\infra\aws\ops\staging-deploy-next.ps1
  .\infra\aws\ops\staging-deploy-next.ps1 -Tag tickcache-20260815-1030
  .\infra\aws\ops\staging-deploy-next.ps1 -Wait        # 배포 안정화까지 대기
  .\infra\aws\ops\staging-deploy-next.ps1 -SkipBuild -Tag <이미푸시한태그>
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2",
  [string]$Tag        = "",   # 비우면 deploy-yyyyMMdd-HHmmss
  [switch]$SkipBuild,         # 이미 푸시한 태그로 태스크 정의만 갱신
  [switch]$Wait               # services-stable 까지 대기
)
# aws cli 는 정상 흐름에서도 stderr 를 내므로 Stop 을 쓰지 않고 $LASTEXITCODE 로 판정한다
# (PS 5.1 NativeCommandError 함정 — 다른 ops 스크립트와 동일한 방식).
$ErrorActionPreference = "Continue"
$env:AWS_PROFILE = $AwsProfile

$account   = "195748745315"
$cluster   = "mcm-ieps-staging"
$service   = "mcm-ieps-staging-next"
$repo      = "mcm-ieps-staging-next"
$container = "next"
$registry  = "$account.dkr.ecr.$Region.amazonaws.com"
$repoRoot  = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path

function Log($m)  { Write-Host "[deploy] $m" }
function Fail($m) { Write-Host "[deploy] 실패: $m" -ForegroundColor Red; exit 1 }

if (-not $Tag) { $Tag = "deploy-" + (Get-Date -Format "yyyyMMdd-HHmmss") }
$image = "${registry}/${repo}:${Tag}"

Log "repo root : $repoRoot"
Log "image     : $image"

if (-not $SkipBuild) {
  # 1) ECR 로그인 → 빌드 → 푸시(설명 태그 + latest)
  Log "ECR 로그인"
  $pw = (aws ecr get-login-password --region $Region)
  if ($LASTEXITCODE -ne 0 -or -not $pw) { Fail "ECR 토큰 발급 실패 — aws sso login --profile $AwsProfile 먼저" }
  $pw | docker login --username AWS --password-stdin $registry
  if ($LASTEXITCODE -ne 0) { Fail "docker login" }

  Log "이미지 빌드 (linux/amd64) — 수 분 걸린다"
  docker build --platform linux/amd64 -f (Join-Path $repoRoot "frontend\Dockerfile") -t $image -t "${registry}/${repo}:latest" $repoRoot
  if ($LASTEXITCODE -ne 0) { Fail "docker build" }

  Log "ECR 푸시: $Tag"
  docker push $image
  if ($LASTEXITCODE -ne 0) { Fail "docker push($Tag)" }
  docker push "${registry}/${repo}:latest"
  if ($LASTEXITCODE -ne 0) { Fail "docker push(latest)" }
} else {
  Log "빌드 건너뜀 (-SkipBuild) — 태그 $Tag 가 ECR 에 이미 있어야 한다"
}

# 2) 현재 태스크 정의를 받아 image 만 교체해 새 리비전 등록
Log "현재 태스크 정의 조회"
$current = (aws ecs describe-services --cluster $cluster --services $service --region $Region --query "services[0].taskDefinition" --output text)
if ($LASTEXITCODE -ne 0 -or -not $current -or $current -eq "None") { Fail "서비스의 태스크 정의를 찾지 못함" }
Log "현재 리비전: $current"

$tdJson = (aws ecs describe-task-definition --task-definition $current --region $Region --query "taskDefinition" --output json)
if ($LASTEXITCODE -ne 0) { Fail "태스크 정의 조회" }
$td = $tdJson | ConvertFrom-Json

# register-task-definition 이 받지 않는 읽기 전용 필드를 떼어낸다(없으면 무시된다).
foreach ($p in @("taskDefinitionArn", "revision", "status", "requiresAttributes",
                 "compatibilities", "registeredAt", "registeredBy", "deregisteredAt")) {
  $td.PSObject.Properties.Remove($p)
}

$target = $td.containerDefinitions | Where-Object { $_.name -eq $container }
if (-not $target) { Fail "컨테이너 '$container' 를 태스크 정의에서 찾지 못함" }
Log "image 교체: $($target.image)"
Log "        -> $image"
$target.image = $image

# AWS CLI 는 BOM 붙은 JSON 을 파싱하지 못하므로 BOM 없는 UTF-8 로 쓴다.
$tdPath = Join-Path $env:TEMP "mcm_next_taskdef.json"
[IO.File]::WriteAllText($tdPath, ($td | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false)))

$newArn = (aws ecs register-task-definition --cli-input-json "file://$tdPath" --region $Region --query "taskDefinition.taskDefinitionArn" --output text)
if ($LASTEXITCODE -ne 0 -or -not $newArn) { Fail "태스크 정의 등록" }
Log "새 리비전: $newArn"

# 3) 서비스에 새 리비전 적용
Log "서비스 갱신 (desired 1)"
aws ecs update-service --cluster $cluster --service $service --task-definition $newArn --desired-count 1 --region $Region --no-cli-pager | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "update-service" }

if ($Wait) {
  Log "배포 안정화 대기 (수 분)"
  aws ecs wait services-stable --cluster $cluster --services $service --region $Region
  if ($LASTEXITCODE -ne 0) { Fail "안정화 대기 타임아웃 — 콘솔에서 태스크 상태 확인" }
  Log "안정화 완료"
}

Log "완료. 태그 $Tag 배포. 새 태스크 기동 + ALB 헬스체크까지 1~3분."
Log "확인: https://koensain.app/api/health"
