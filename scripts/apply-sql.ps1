# apply-sql.ps1 — 멱등 SQL 마이그레이션을 staging DB 에 적용한다.
# 사용법 (repo 루트에서):
#   powershell -ExecutionPolicy Bypass -File scripts\apply-sql.ps1 -Sql infra\aws\196_shop_receipts.sql
#
# DB 터널(scripts\db-tunnel.ps1)을 먼저 열고, RDS 마스터 시크릿으로 DATABASE_URL 을 만들어
# node scripts\apply-sql.mjs 에 넘긴다. `infra/aws/NNN_*.sql` 은 전부 멱등이라 여러 번 돌려도 된다.

param(
  [Parameter(Mandatory = $true)][string[]]$Sql,   # 여러 개면 순서대로 적용
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region = "ap-northeast-2",
  [string]$ClusterIdentifier = "mcm-ieps-staging",
  [string]$Database = "mcm",
  [int]$LocalPort = 15432
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "db-tunnel.ps1") -LocalPort $LocalPort
if ($LASTEXITCODE -ne 0) {
  Write-Host "DB 터널을 열지 못해 중단합니다." -ForegroundColor Red
  exit 1
}

$env:AWS_PROFILE = $AwsProfile

# 터널이 이미 열려 있으면 db-tunnel.ps1 이 SSO 확인을 건너뛴다 — 여기서 한 번 더 확인한다.
& aws sts get-caller-identity --profile $AwsProfile --region $Region --output text 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "SSO 세션이 만료됐습니다. 브라우저에서 로그인하세요." -ForegroundColor Yellow
  & aws sso login --profile $AwsProfile
  if ($LASTEXITCODE -ne 0) { Write-Host "aws sso login 실패." -ForegroundColor Red; exit 1 }
}

# RDS 관리형 마스터 시크릿에서 접속 정보를 받는다(dev-frontend-aws.ps1 과 같은 경로).
$secretArn = & aws rds describe-db-clusters --profile $AwsProfile --region $Region `
  --db-cluster-identifier $ClusterIdentifier --query "DBClusters[0].MasterUserSecret.SecretArn" --output text
if (-not $secretArn -or $secretArn -eq "None") {
  Write-Host "RDS 마스터 시크릿을 찾지 못했습니다: $ClusterIdentifier" -ForegroundColor Red
  exit 1
}

$secretJson = & aws secretsmanager get-secret-value --profile $AwsProfile --region $Region `
  --secret-id $secretArn --version-stage AWSCURRENT --query "SecretString" --output text
$secret = $secretJson | ConvertFrom-Json

$user = [Uri]::EscapeDataString([string]$secret.username)
$pass = [Uri]::EscapeDataString([string]$secret.password)
$env:DATABASE_URL = "postgresql://${user}:${pass}@localhost:${LocalPort}/${Database}"

Push-Location $repo
try {
  foreach ($file in $Sql) {
    node scripts/apply-sql.mjs $file
    if ($LASTEXITCODE -ne 0) { exit 1 }
  }
} finally {
  Pop-Location
  $env:DATABASE_URL = $null
}
