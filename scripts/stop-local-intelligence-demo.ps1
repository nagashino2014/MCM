$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path $PSScriptRoot -Parent
$processFile = Join-Path $demoRoot 'frontend/.next/local-intelligence-demo/process.json'
if (!(Test-Path -LiteralPath $processFile)) { Write-Output '저장된 로컬 실증 프로세스가 없습니다.'; exit 0 }
$state = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
$demoProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$state.pid)"
if ($demoProcess) {
  if ($demoProcess.CommandLine -notlike '*scripts/local-intelligence-demo.mjs*') { throw '프로세스가 바뀌어 종료하지 않았습니다.' }
  Stop-Process -Id ([int]$state.pid)
}
Write-Output '로컬 실증 화면을 종료했습니다. 입력한 시험 데이터는 보존됩니다.'
