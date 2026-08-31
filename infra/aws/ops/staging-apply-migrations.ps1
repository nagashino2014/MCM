#Requires -Version 5.1
<#
.SYNOPSIS
  MCM 스테이징 Aurora 에 멱등 SQL 마이그레이션(infra/aws/NNN_*.sql)을 적용한다.

.DESCRIPTION
  bastion SSM 포트포워딩 터널(localhost:15432)을 통해 psql 로 적용한다.
  - 터널이 이미 열려 있으면 그대로 쓰고, 없으면 bastion 기동(stopped 면 start)부터
    터널 백그라운드 기동까지 자동으로 수행한 뒤, 끝나면 자동 기동분만 정리한다.
  - 접속 정보는 RDS 매니지드 마스터 시크릿(Secrets Manager)에서 받는다
    (dev-frontend-aws.ps1 과 동일 경로 — 파일에 저장하지 않는다).
  - 마이그레이션은 전부 멱등이라 재실행에 안전하다. 실패 시 해당 파일에서 중단(ON_ERROR_STOP).
  - Aurora 는 min 0 ACU auto-pause — 첫 쿼리가 수십 초 걸릴 수 있다(오류 아님).

.EXAMPLE
  .\infra\aws\ops\staging-apply-migrations.ps1                          # 기본: 200~204(근태 이벤트·식대)
  .\infra\aws\ops\staging-apply-migrations.ps1 -Files 205_foo.sql       # 특정 파일만
  .\infra\aws\ops\staging-apply-migrations.ps1 -KeepTunnel              # 적용 후 터널 유지(이어서 dev 등)
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2",
  [string]$ClusterId  = "mcm-ieps-staging",
  [int]$LocalPort     = 15432,
  # infra/aws/ 기준 파일명. 기본값 = 근태 이벤트 자동수집·식대 검증(2026-08-27) 5종.
  [string[]]$Files = @(
    "200_adt_event_log.sql",
    "201_attendance_offday_break.sql",
    "202_overtime_form_single_day.sql",
    "203_overtime_meal_check.sql",
    "204_meal_warning_action.sql"
  ),
  [switch]$KeepTunnel
)
# aws cli 는 정상 흐름에서도 stderr 를 내므로 Stop 을 쓰지 않고 $LASTEXITCODE 로 판정한다
# (PS 5.1 NativeCommandError 함정 — 다른 ops 스크립트와 동일한 방식).
$ErrorActionPreference = "Continue"
$env:AWS_PROFILE = $AwsProfile

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$sqlDir   = Join-Path $repoRoot "infra\aws"

function Log($m)  { Write-Host "[migrate] $m" }
function Fail($m) { Write-Host "[migrate] 실패: $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Fail "psql 이 없다 — PostgreSQL 클라이언트 설치 후 PATH 등록(예: winget install PostgreSQL.PostgreSQL.16)"
}
foreach ($f in $Files) {
  if (-not (Test-Path (Join-Path $sqlDir $f))) { Fail "파일 없음: infra\aws\$f" }
}

# 1) RDS 엔드포인트 + 마스터 시크릿
Log "RDS 클러스터 조회: $ClusterId"
$clusterJson = (aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region `
  --query "DBClusters[0].{Endpoint:Endpoint,SecretArn:MasterUserSecret.SecretArn,DatabaseName:DatabaseName}" --output json)
if ($LASTEXITCODE -ne 0 -or -not $clusterJson) { Fail "RDS 조회 — aws sso login --profile $AwsProfile 먼저" }
$cluster = $clusterJson | ConvertFrom-Json
if (-not $cluster.SecretArn) { Fail "매니지드 마스터 시크릿이 없다" }
$dbName = if ($cluster.DatabaseName) { [string]$cluster.DatabaseName } else { "mcm" }

$secretString = (aws secretsmanager get-secret-value --secret-id $cluster.SecretArn --version-stage AWSCURRENT `
  --region $Region --query "SecretString" --output text)
if ($LASTEXITCODE -ne 0 -or -not $secretString) { Fail "시크릿 조회" }
$secret = $secretString | ConvertFrom-Json

# 2) 터널 — 이미 열려 있으면 그대로, 없으면 bastion 기동 + SSM 포트포워딩 백그라운드
$tunnelProc = $null
$portOpen = Test-NetConnection -ComputerName localhost -Port $LocalPort -InformationLevel Quiet -WarningAction SilentlyContinue
if ($portOpen) {
  Log "기존 터널 사용: localhost:$LocalPort"
} else {
  $bastionId = (aws ec2 describe-instances --region $Region `
    --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=running" `
    --query "Reservations[0].Instances[0].InstanceId" --output text)
  if ($LASTEXITCODE -ne 0) { Fail "bastion 조회" }
  if (-not $bastionId -or $bastionId -eq "None") {
    $stopped = (aws ec2 describe-instances --region $Region `
      --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=stopped,stopping" `
      --query "Reservations[0].Instances[0].InstanceId" --output text)
    if (-not $stopped -or $stopped -eq "None") { Fail "bastion 인스턴스를 찾지 못함" }
    Log "bastion 기동: $stopped (running 대기)"
    aws ec2 start-instances --instance-ids $stopped --region $Region --no-cli-pager | Out-Null
    aws ec2 wait instance-running --instance-ids $stopped --region $Region
    $bastionId = $stopped
    # 부팅 직후 SSM 에이전트 등록까지 잠시 걸린다
    Log "SSM 에이전트 등록 대기"
    $ready = $false
    for ($i = 0; $i -lt 18; $i++) {
      Start-Sleep -Seconds 5
      $ping = (aws ssm describe-instance-information --region $Region `
        --filters "Key=InstanceIds,Values=$bastionId" --query "InstanceInformationList[0].PingStatus" --output text)
      if ($ping -eq "Online") { $ready = $true; break }
    }
    if (-not $ready) { Fail "bastion SSM 미등록(90초 초과) — 잠시 후 재시도" }
  }

  Log "SSM 포트포워딩 기동: $bastionId -> $($cluster.Endpoint):5432 (localhost:$LocalPort)"
  $ssmArgs = @("ssm", "start-session", "--target", $bastionId, "--region", $Region,
    "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters", "host=$($cluster.Endpoint),portNumber=5432,localPortNumber=$LocalPort")
  $tunnelProc = Start-Process aws -ArgumentList $ssmArgs -PassThru -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Test-NetConnection -ComputerName localhost -Port $LocalPort -InformationLevel Quiet -WarningAction SilentlyContinue) { $up = $true; break }
  }
  if (-not $up) {
    if ($tunnelProc) { Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue }
    Fail "터널이 열리지 않음(60초) — Session Manager plugin 설치 여부 확인"
  }
}

# 3) psql 적용 (멱등, 파일 단위 ON_ERROR_STOP)
$env:PGPASSWORD = [string]$secret.password
$env:PGSSLMODE  = "require"
# Windows psql 은 클라이언트 인코딩을 UHC(CP949)로 잡아 UTF-8 SQL 의 한글 주석에서
# "byte sequence ... in encoding UHC" 오류가 난다(2026-08-28 실측) — UTF8 로 고정.
$env:PGCLIENTENCODING = "UTF8"
$failed = $false
try {
  foreach ($f in $Files) {
    $path = Join-Path $sqlDir $f
    Log "적용: $f"
    psql -h localhost -p $LocalPort -U ([string]$secret.username) -d $dbName -v ON_ERROR_STOP=1 -q -f $path
    if ($LASTEXITCODE -ne 0) { Write-Host "[migrate] 실패: $f" -ForegroundColor Red; $failed = $true; break }
  }
} finally {
  $env:PGPASSWORD = $null
  $env:PGCLIENTENCODING = $null
  if ($tunnelProc -and -not $KeepTunnel) {
    Log "자동 기동한 터널 종료"
    Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
  } elseif ($tunnelProc) {
    Log "터널 유지(-KeepTunnel): localhost:$LocalPort (PID $($tunnelProc.Id))"
  }
}
if ($failed) { exit 1 }
Log "완료. 적용 $($Files.Count)건 — 전부 멱등이라 재실행에 안전하다."
