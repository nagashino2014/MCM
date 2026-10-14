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

# 포트가 이미 쓰이고 있는지 (Test-NetConnection 은 느리다)
function Test-PortInUse([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

$repo = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repo "frontend"
$scraper = Join-Path $repo "scraper"
$tunnelScript = Join-Path $PSScriptRoot "db-tunnel.ps1"

Write-Host "MCM 전표 수집" -ForegroundColor Cyan
Write-Host "  저장소: $repo"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 가 설치돼 있지 않습니다. https://nodejs.org 에서 LTS 를 설치한 뒤 다시 실행하세요." -ForegroundColor Red
  Read-Host "엔터를 누르면 닫힙니다"
  exit 1
}

# 3000 이 이미 쓰이고 있으면(Docker 등) 비어 있는 다음 포트로 앱을 띄우고 브라우저도 그 포트로 연다.
# 포트를 PORT 로 못박아 두지 않으면 next 가 알아서 밀려나 브라우저가 수집 기능이 꺼진 3000 쪽에 붙는다.
$appPort = 3000
while ((Test-PortInUse $appPort) -and $appPort -lt 3020) {
  $owner = $null
  try {
    $conn = Get-NetTCPConnection -LocalPort $appPort -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn) { $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue }
  } catch {
    # Get-NetTCPConnection 이 없는 환경 — 누가 쓰는지는 못 알아낸다.
  }
  $who = if ($owner) { " ({0}, PID {1})" -f $owner.ProcessName, $owner.Id } else { "" }
  Write-Host ("  {0} 포트는 다른 프로그램이 쓰고 있어 건너뜁니다{1}." -f $appPort, $who) -ForegroundColor Yellow
  $appPort++
}
if (Test-PortInUse $appPort) {
  Write-Host "3000~3020 포트가 모두 쓰이고 있습니다. 쓰지 않는 창(다른 npm run dev 등)을 닫은 뒤 다시 실행해 주세요." -ForegroundColor Red
  Read-Host "엔터를 누르면 닫힙니다"
  exit 1
}
$env:PORT = "$appPort"
$url = "http://localhost:$appPort/finance?tab=shopreceipt"

# 처음 실행이거나 의존성 목록이 바뀌었으면 받는다(시간이 좀 걸린다).
foreach ($dir in @($frontend, $scraper)) {
  $modules = Join-Path $dir "node_modules"
  $manifest = Join-Path $dir "package.json"
  $needInstall = -not (Test-Path $modules)
  if (-not $needInstall) {
    # git pull 로 package.json 이 새로워졌으면 새 의존성이 빠져 있다.
    $needInstall = (Get-Item $manifest).LastWriteTime -gt (Get-Item $modules).LastWriteTime
  }

  if ($needInstall) {
    Write-Host "  필요한 파일을 받습니다: $(Split-Path -Leaf $dir)" -ForegroundColor Yellow
    Push-Location $dir
    # package-lock.json 이 있으면 npm ci 를 쓴다. npm install 은 잠금 파일을 고쳐 쓰는 일이 있어
    # 다음 git pull 이 "local changes would be overwritten" 으로 막힌다.
    if (Test-Path (Join-Path $dir "package-lock.json")) {
      npm ci
      if ($LASTEXITCODE -ne 0) {
        Write-Host "  npm ci 가 실패해 npm install 로 받습니다." -ForegroundColor Yellow
        npm install
      }
    } else {
      npm install
    }
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

# '스테이징으로 올리기'는 전표 PDF 를 S3 에 넣는다. 앱(Node)의 AWS SDK 는 AWS_PROFILE 이 없으면 [default] 를
# 찾는데 거기엔 자격증명이 없어 "Could not load credentials" 로 올리기 전체가 실패한다. 터널 스크립트가 같은
# 프로필을 넣어 주지만 -NoTunnel 로 띄우면 비어 있으므로 여기서도 채운다.
if (-not $env:AWS_PROFILE) { $env:AWS_PROFILE = "mcm-kesi-staging" }

# 빌드 산출 폴더를 따로 쓴다. 같은 frontend 폴더에서 다른 dev 서버(다른 작업 창·세션)가 돌면 둘이 .next 를
# 서로 덮어써 라우트 목록이 사라지고 /finance 가 404 가 됐다(2026-10-14 실측 — 3001 의 dev 서버와 충돌).
$env:NEXT_DIST_DIR = ".next-receipts"

# DB 접속 정보는 늘 AWS 시크릿(AWSCURRENT)에서 받는다. RDS 마스터 비밀번호는 7일마다 자동 교체돼
# .env.local 의 PGPASSWORD 는 곧 낡고, 그러면 로그인이 "password authentication failed" 로 막힌다.
# dev:aws 가 넣는 DATABASE_URL 이 PG* 보다 우선하므로 .env.local 은 그대로 둬도 된다.
$npmScript = "dev:aws"
if (-not (Test-Path (Join-Path $frontend ".env.local"))) {
  Write-Host "  frontend\.env.local 이 없습니다. 로그인이 계속 안 되면 AUTH_SECRET 을 넣어야 합니다(frontend\.env.example 참고)." -ForegroundColor Yellow
}

Write-Host "  앱을 띄웁니다. 창을 닫으면 앱도 함께 종료됩니다." -ForegroundColor Green
Write-Host "  주소: $url"
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
