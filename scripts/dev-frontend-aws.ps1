param(
  [string]$Profile = "mcm-kesi-staging",
  [string]$Region = "ap-northeast-2",
  [string]$ClusterIdentifier = "mcm-ieps-staging",
  [string]$Database = "mcm",
  [string]$LocalHost = "localhost",
  [int]$LocalPort = 15432,
  [string]$NpmScript = "dev",
  [switch]$PrintOnly
)

$ErrorActionPreference = "Stop"

function Invoke-AwsText {
  param([string[]]$AwsArgs)

  $output = & aws @AwsArgs --profile $Profile --region $Region --output text
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed: aws $($AwsArgs -join ' ')"
  }
  return $output
}

function Invoke-AwsJson {
  param([string[]]$AwsArgs)

  $output = & aws @AwsArgs --profile $Profile --region $Region --output json
  if ($LASTEXITCODE -ne 0) {
    throw "AWS CLI command failed: aws $($AwsArgs -join ' ')"
  }
  return $output | ConvertFrom-Json
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$frontendDir = Join-Path $repoRoot "frontend"

$cluster = Invoke-AwsJson @(
  "rds", "describe-db-clusters",
  "--db-cluster-identifier", $ClusterIdentifier,
  "--query", "DBClusters[0].{Endpoint:Endpoint,SecretArn:MasterUserSecret.SecretArn,DatabaseName:DatabaseName}"
)

if (-not $cluster.SecretArn) {
  throw "RDS cluster '$ClusterIdentifier' does not expose a managed master user secret."
}

$secretString = Invoke-AwsText @(
  "secretsmanager", "get-secret-value",
  "--secret-id", $cluster.SecretArn,
  "--version-stage", "AWSCURRENT",
  "--query", "SecretString"
)
$secret = $secretString | ConvertFrom-Json

if (-not $secret.username -or -not $secret.password) {
  throw "The RDS secret does not contain username/password fields."
}

$tcp = Test-NetConnection -ComputerName $LocalHost -Port $LocalPort -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $tcp) {
  Write-Warning "No local tunnel is listening on ${LocalHost}:${LocalPort}."
  Write-Host "Start an SSM port-forward to the RDS endpoint first, then rerun this script."
  Write-Host "RDS endpoint: $($cluster.Endpoint):5432"
}

$encodedUser = [Uri]::EscapeDataString([string]$secret.username)
$encodedPassword = [Uri]::EscapeDataString([string]$secret.password)
$env:DATABASE_URL = "postgresql://${encodedUser}:${encodedPassword}@${LocalHost}:${LocalPort}/${Database}"
$env:PGSSLMODE = "require"

# 바로빌 연동 (staging 태스크 정의와 동일 구성 — CERTKEY 는 앱 시크릿에서 조회, 파일에 저장하지 않음)
try {
  $appSecretString = Invoke-AwsText @(
    "secretsmanager", "get-secret-value",
    "--secret-id", "mcm-ieps-staging/app",
    "--query", "SecretString"
  )
  $appSecret = $appSecretString | ConvertFrom-Json
  if ($appSecret.BAROBILL_CERTKEY) {
    $env:BAROBILL_CERTKEY = [string]$appSecret.BAROBILL_CERTKEY
    $env:BAROBILL_CORPNUM = "5578600306"
    $env:BAROBILL_ID = "koensain18"
    $env:BAROBILL_ENV = "prod"
    $env:BAROBILL_INVOICER_EMAIL = "kaikan00@koensain.com"
    Write-Host "Barobill env configured (prod certkey from app secret)."
  }
} catch {
  Write-Warning "Barobill secret lookup failed - finance sync will be unavailable: $_"
}

Write-Host "Starting frontend with the current RDS secret ($ClusterIdentifier / AWSCURRENT)."
Write-Host "Database target: ${LocalHost}:${LocalPort}/${Database} as $($secret.username)"

if ($PrintOnly) {
  Write-Host "PrintOnly mode: npm was not started."
  exit 0
}

Push-Location $frontendDir
try {
  npm run $NpmScript
} finally {
  Pop-Location
}
