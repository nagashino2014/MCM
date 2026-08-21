# receipts-app.ps1 — 쇼핑몰 전표 수집용 로컬 앱 실행
# 사용법:
#   바탕화면의 '전표 수집' 바로가기를 더블클릭
#   (바로가기가 없으면 powershell -ExecutionPolicy Bypass -File scripts\install-receipts-shortcut.ps1 을 한 번 실행)
#
# 전표 수집은 쇼핑몰 로그인 상태와 브라우저가 있는 PC 에서만 할 수 있다(서버에는 둘 다 없다).
# 그래서 이 스크립트가 ① DB 터널을 열고 ② MCM 앱을 내 PC 에서 띄우고 ③ 수집 화면을 브라우저로 연다.

param(
  [switch]$NoTunnel,        # 이미 다른 창에서 터널을 열어 뒀을 때
  [int]$DbPort = 15432
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repo "frontend"
$scraper = Join-Path $repo "scraper"
$tunnelScript = Join-Path $PSScriptRoot "db-tunnel.ps1"
$url = "http://localhost:3000/finance?tab=shopreceipt"

Write-Host "MCM 전표 수집" -ForegroundColor Cyan
Write-Host "  저장소: $repo"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 가 설치돼 있지 않습니다. https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행하세요." -ForegroundColor Red
  Read-Host "엔터를 누르면 닫힙니다"
  exit 1
}

# 처음 실행이면 의존성을 받는다(시간이 좀 걸린다).
foreach ($dir in @($frontend, $scraper)) {
  if (-not (Test-Path (Join-Path $dir "node_modules"))) {
    Write-Host "  처음 실행이라 필요한 파일을 받습니다: $(Split-Path -Leaf $dir)" -ForegroundColor Yellow
    Push-Location $dir
    npm install
    Pop-Location
  }
}

# DB 터널: 앱은 localhost:$DbPort 로 staging DB 를 본다. 터널이 없으면 로그인부터 안 된다.
if (-not $NoTunnel) {
  & $tunnelScript -LocalPort $DbPort
  if ($LASTEXITCODE -ne 0) {
    Write-Host "DB 터널을 열지 못해 중단합니다(위 메시지 참고)." -ForegroundColor Red
    Write-Host "터널 없이 앱만 띄우려면: powershell -ExecutionPolicy Bypass -File scripts\receipts-app.ps1 -NoTunnel"
    Read-Host "엔터를 누르면 닫힙니다"
    exit 1
  }
}

# 수집기가 쓰는 브라우저: 설치된 Chrome 이 있으면 그쪽이 안전하다(봇 확인을 덜 받는다).
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $chrome) { $env:RECEIPTS_CHROME_PATH = $chrome }

# 이 플래그가 있어야 앱에서 수집 기능이 열린다(서버 배포판에서는 꺼져 있다).
$env:RECEIPTS_LOCAL_TOOLS = "1"

# .env.local 이 없는 PC(예: 처음 세팅한 동료 PC)에서는 DB 접속 정보를 AWS 시크릿에서 받아 쓴다.
$npmScript = "dev"
if (-not (Test-Path (Join-Path $frontend ".env.local"))) {
  Write-Host "  frontend\.env.local 이 없어 AWS 시크릿에서 DB 접속 정보를 받습니다(dev:aws)." -ForegroundColor Yellow
  Write-Host "  로그인이 계속 안 되면 .env.local 에 AUTH_SECRET 을 넣어야 합니다(frontend\.env.example 참고)." -ForegroundColor Yellow
  $npmScript = "dev:aws"
}

Write-Host "  앱을 띄웁니다. 창을 닫으면 앱도 함께 종료됩니다." -ForegroundColor Green
Push-Location $frontend

# 앱이 뜨면 브라우저를 연다(포트가 열릴 때까지 잠깐 기다린다).
Start-Job -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2 | Out-Null
      Start-Process $u
      break
    } catch { Start-Sleep -Seconds 1 }
  }
} -ArgumentList $url | Out-Null

try {
  npm run $npmScript
} finally {
  Pop-Location
  if (-not $NoTunnel) {
    & $tunnelScript -LocalPort $DbPort -Stop
    Write-Host "bastion 은 계속 켜져 있습니다. 오늘 작업이 끝났으면 .\infra\aws\ops\staging-stop.ps1 로 내려 주세요." -ForegroundColor DarkGray
  }
}
