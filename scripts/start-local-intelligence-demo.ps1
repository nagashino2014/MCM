param([switch]$Real, [switch]$UseStoredData, [string]$SourceEnvFile)
$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path $PSScriptRoot -Parent
$frontendRoot = Join-Path $demoRoot 'frontend'
$outputRoot = Join-Path $frontendRoot '.next/local-intelligence-demo'
$baseUrl = 'http://127.0.0.1:4174'
$expectedMode = if ($Real) { 'real' } else { 'demo' }
if ($SourceEnvFile) { $env:MCM_INTEL_SOURCE_ENV_FILE = $SourceEnvFile }
$env:MCM_LOCAL_INTELLIGENCE_MODE = $expectedMode
$env:MCM_INTEL_USE_STORED_DATA = if ($UseStoredData -and $Real) { '1' } else { '0' }
try { $existing = Invoke-RestMethod "$baseUrl/api/local-demo/health" -TimeoutSec 2 } catch { $existing = $null }
if ($existing.localIntelligenceDemo -and ($existing.mode -eq $expectedMode -or (!$existing.mode -and !$Real))) { Write-Output "$baseUrl/sales/rag?tab=scheduled"; exit 0 }
if ($existing.localIntelligenceDemo) { throw '다른 실증 모드가 실행 중입니다. stop-local-intelligence-demo.ps1로 먼저 종료하세요.' }
if (Get-NetTCPConnection -State Listen -LocalPort 4174 -ErrorAction SilentlyContinue) { throw '4174 포트를 다른 프로그램이 사용 중입니다.' }
if ($Real -and !$UseStoredData) { & (Join-Path $PSScriptRoot 'start-intelligence-source-tunnel.ps1') }

$pgBin = 'C:/Program Files/PostgreSQL/17/bin'
if (!(Test-Path -LiteralPath (Join-Path $pgBin 'pg_ctl.exe'))) { throw 'PostgreSQL 17 설치가 필요합니다.' }
$demoData = Join-Path $env:TEMP 'mcm-intel-phase1-pg'
if (!(Test-Path -LiteralPath (Join-Path $demoData 'PG_VERSION'))) {
  & (Join-Path $pgBin 'initdb.exe') -D $demoData -U mcm_intel_test -A trust --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw '로컬 시험 DB 초기화 실패' }
}
$pidFile = Join-Path $demoData 'postmaster.pid'
if (Test-Path -LiteralPath $pidFile) {
  $dbState = Get-Content -LiteralPath $pidFile
  if ($dbState[3].Trim() -ne '55439') { throw '기존 시험 DB의 포트를 확인하세요.' }
} else {
  if (Get-NetTCPConnection -State Listen -LocalPort 55439 -ErrorAction SilentlyContinue) { throw '55439 포트를 다른 프로그램이 사용 중입니다.' }
  $pgArgs = '-D "' + $demoData + '" -l "' + (Join-Path $env:TEMP 'mcm-intel-demo-postgres.log') + '" -o "-h 127.0.0.1 -p 55439" -w start'
  $pgStart = Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList $pgArgs -WindowStyle Hidden -PassThru
  if (!$pgStart.WaitForExit(45000)) { throw '로컬 시험 DB 기동 확인 시간이 지났습니다.' }
  if ($pgStart.ExitCode -ne 0) { throw '로컬 시험 DB 기동 실패' }
}
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$nodePath = (Get-Command node -ErrorAction Stop).Source
$demoProcess = Start-Process -FilePath $nodePath -ArgumentList '--use-system-ca scripts/local-intelligence-demo.mjs' -WorkingDirectory $frontendRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $outputRoot 'server.log') -RedirectStandardError (Join-Path $outputRoot 'server-error.log') -PassThru
@{ pid = $demoProcess.Id; url = $baseUrl; mode = $expectedMode; startedAt = [DateTimeOffset]::Now.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'process.json') -Encoding utf8
for ($attempt = 0; $attempt -lt 180; $attempt++) {
  Start-Sleep -Milliseconds 500
  try { $health = Invoke-RestMethod "$baseUrl/api/local-demo/health" -TimeoutSec 2 } catch { $health = $null }
  if ($health.localIntelligenceDemo -and $health.mode -eq $expectedMode) { Write-Output "$baseUrl/sales/rag?tab=scheduled"; exit 0 }
  if ($demoProcess.HasExited) { Get-Content -LiteralPath (Join-Path $outputRoot 'server-error.log') -Tail 12; throw '로컬 실증 서버가 종료되었습니다.' }
}
throw '기동 확인 시간이 지났습니다. frontend/.next/local-intelligence-demo/server-error.log를 확인하세요.'
