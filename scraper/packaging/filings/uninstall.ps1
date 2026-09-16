# MCM 신고 보조 제거 — 프로그램·링크 등록·시작 메뉴를 지운다.
# 데이터(IEPS 로그인·MCM 토큰, %LOCALAPPDATA%\MCM\filings)는 -RemoveData 를 줄 때만 지운다.
param([switch]$RemoveData)
$ErrorActionPreference = "Continue"
$dest = Join-Path $env:LOCALAPPDATA "Programs\MCM Filings"
$data = Join-Path $env:LOCALAPPDATA "MCM\filings"

Write-Host ""
Write-Host "MCM 신고 보조 제거" -ForegroundColor Cyan

$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dest, [System.StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  Write-Warning "신고 보조가 실행 중입니다. 열린 신고 보조 창을 모두 닫고 다시 실행하세요."
  exit 1
}

Remove-Item -Path "HKCU:\Software\Classes\mcm-filings" -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  mcm-filings:// 링크 해제"

$menu = Join-Path ([Environment]::GetFolderPath("Programs")) "MCM 신고 보조"
Remove-Item -Path $menu -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "  시작 메뉴 삭제"

if (Test-Path $dest) {
  Remove-Item -Path $dest -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $dest) { Write-Warning "프로그램 폴더 일부를 지우지 못했습니다: $dest (창을 닫은 뒤 직접 지워도 됩니다)" }
  else { Write-Host "  프로그램 삭제: $dest" }
}

if ($RemoveData) {
  Remove-Item -Path $data -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "  데이터 삭제: $data"
} else {
  Write-Host "  데이터는 남겨 둡니다: $data  (다시 설치하면 로그인이 유지됩니다)"
}
Write-Host ""
Write-Host "제거 완료" -ForegroundColor Green
