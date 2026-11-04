# MCM 데스크탑 위젯 — Microsoft Store 제출용 MSIX 패키징 (2026-11-04)
#
#   cd apps/desktop
#   npm run build                                    # 먼저 Tauri 빌드(target/release/mcm-desktop.exe)
#   powershell -ExecutionPolicy Bypass -File scripts/make-msix.ps1 -IdentityName "<Partner Center 패키지 ID>" -Publisher "CN=<Partner Center 게시자 ID>" -PublisherDisplay "<회사명>"
#
# 산출물: src-tauri/target/msix/MCM_<버전>.msix  (서명 없음 — Store 가 심사 뒤 서명한다)
# 로컬 설치 시험(선택): -SignThumbprint <자체 인증서 지문> 을 주면 signtool 로 서명한다. 그 인증서를 "신뢰할 수 있는 사람" 저장소에
#   넣은 PC 에서는 더블클릭(App Installer)으로 설치되고 SmartScreen 경고가 없다(사이드로딩 경로).
#
# 전제: Windows 10/11 SDK(makeappx.exe·signtool.exe). 매니페스트 원본은 ../msix/AppxManifest.xml.
param(
  [string]$IdentityName = 'KESI.MCM',
  [string]$Publisher = 'CN=KESI',
  [string]$PublisherDisplay = 'KESI',
  [string]$Version = '',
  [string]$SignThumbprint = ''
)

$ErrorActionPreference = 'Stop'
$desktop = Resolve-Path (Join-Path $PSScriptRoot '..')
$tauriDir = Join-Path $desktop 'src-tauri'
$exe = Join-Path $tauriDir 'target\release\mcm-desktop.exe'
if (-not (Test-Path $exe)) { throw "[msix] 먼저 npm run build — $exe 가 없다" }

if (-not $Version) {
  $conf = Get-Content (Join-Path $tauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json
  $Version = "$($conf.version).0"   # MSIX 버전은 네 자리(마지막은 Store 예약, 0)
}

function Find-SdkTool([string]$name) {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $found = Get-ChildItem -Path $kits -Filter $name -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $found) { throw "[msix] $name 을 찾지 못했다 — Windows SDK 설치 필요" }
  return $found.FullName
}
$makeappx = Find-SdkTool 'makeappx.exe'

$out = Join-Path $tauriDir 'target\msix'
$pkg = Join-Path $out 'pkg'
if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $pkg 'Assets') | Out-Null

Copy-Item $exe $pkg
foreach ($logo in 'StoreLogo.png', 'Square44x44Logo.png', 'Square150x150Logo.png', 'Square71x71Logo.png', 'Square310x310Logo.png', 'Wide310x150Logo.png') {
  Copy-Item (Join-Path $tauriDir "icons\$logo") (Join-Path $pkg 'Assets')
}

$manifest = Get-Content (Join-Path $desktop 'msix\AppxManifest.xml') -Raw -Encoding UTF8
$manifest = $manifest.Replace('__IDENTITY_NAME__', $IdentityName).Replace('__PUBLISHER__', $Publisher).Replace('__PUBLISHER_DISPLAY__', $PublisherDisplay).Replace('__VERSION__', $Version)
[System.IO.File]::WriteAllText((Join-Path $pkg 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding($false)))

$msix = Join-Path $out "MCM_$Version.msix"
if (Test-Path $msix) { Remove-Item $msix -Force }
& $makeappx pack /o /d $pkg /p $msix
if ($LASTEXITCODE -ne 0) { throw "[msix] makeappx 종료 코드 $LASTEXITCODE" }

if ($SignThumbprint) {
  $signtool = Find-SdkTool 'signtool.exe'
  & $signtool sign /fd SHA256 /sha1 $SignThumbprint $msix
  if ($LASTEXITCODE -ne 0) { throw "[msix] signtool 종료 코드 $LASTEXITCODE" }
}

Write-Host "[msix] 완료: $msix (Identity $IdentityName / $Publisher / $Version)"
Write-Host "[msix] Store 제출: Partner Center > 앱 > 패키지에 업로드. 서명 없이 올린다(Store 가 서명)."
