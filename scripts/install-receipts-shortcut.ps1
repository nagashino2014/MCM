# install-receipts-shortcut.ps1 — '전표 수집' 바탕화면 바로가기 만들기
# 사용법 (repo 루트에서):
#   pwsh scripts/install-receipts-shortcut.ps1
#
# 한 번만 실행하면 바탕화면에 바로가기가 생긴다. 이후에는 그것만 더블클릭하면
# 앱이 뜨고 수집 화면이 열린다.
#
# 다른 사람 PC 에 배치할 때:
#   1) Node.js LTS 설치 (또는 pwsh scripts/laptop-setup.ps1 -Scraper)
#   2) 이 저장소를 내려받기
#   3) 이 스크립트 실행 → 바탕화면 바로가기 생성
#   4) '전표 수집' 실행 → 각 쇼핑몰에 한 번씩 로그인

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "receipts-app.ps1"
$desktop = [Environment]::GetFolderPath("Desktop")
$linkPath = Join-Path $desktop "전표 수집.lnk"

if (-not (Test-Path $runner)) {
  Write-Host "실행 스크립트를 찾지 못했습니다: $runner" -ForegroundColor Red
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($linkPath)
$link.TargetPath = "powershell.exe"
$link.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$runner`""
$link.WorkingDirectory = $repo
$link.IconLocation = "shell32.dll,167"   # 문서·영수증 느낌의 기본 아이콘
$link.Description = "MCM 쇼핑몰 전표 수집 (로컬 앱 실행)"
$link.Save()

Write-Host "바탕화면에 바로가기를 만들었습니다: $linkPath" -ForegroundColor Green
Write-Host "이제 '전표 수집' 을 더블클릭하면 앱이 뜨고 수집 화면이 열립니다."
