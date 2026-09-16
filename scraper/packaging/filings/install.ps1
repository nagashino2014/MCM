# MCM 신고 보조 설치 — 관리자 권한 없이 현재 사용자에게 설치한다.
#  - 프로그램: %LOCALAPPDATA%\Programs\MCM Filings
#  - 데이터(IEPS 로그인·MCM 토큰): %LOCALAPPDATA%\MCM\filings  (재설치·업데이트해도 남는다)
#  - mcm-filings:// 링크 등록 → MCM 앱의 [신고 보조 열기] 버튼이 이 PC 에서 도구를 연다
#  - 시작 메뉴 "MCM 신고 보조" 바로가기
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA "Programs\MCM Filings"

Write-Host ""
Write-Host "MCM 신고 보조 설치" -ForegroundColor Cyan
Write-Host "  설치 위치: $dest"

# 1) Chrome — 도구가 설치된 Chrome 으로 IEPS 에 접속한다(보안 모듈·인증 때문에 번들 브라우저를 쓰지 않는다)
$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) {
  Write-Warning "Google Chrome 이 설치되어 있지 않습니다. 신고 보조는 Chrome 으로 IEPS 에 접속하므로 Chrome 을 먼저 설치하세요."
  Write-Warning "(설치는 계속 진행합니다 — Chrome 설치 후 바로 쓸 수 있습니다.)"
} else {
  Write-Host "  Chrome 확인: $chrome"
}

# 2) 실행 중인 신고 보조가 있으면 파일이 잠겨 교체되지 않는다
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dest, [System.StringComparison]::OrdinalIgnoreCase) }
if ($running) {
  throw "신고 보조가 실행 중입니다. 열린 신고 보조 창(콘솔·Chrome)을 모두 닫고 다시 설치하세요."
}

# 3) 파일 복사 — 프로그램 폴더는 통째로 교체(데이터 폴더는 건드리지 않는다)
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($item in @("runtime", "app")) {
  Copy-Item -Recurse -Force (Join-Path $src $item) $dest
}
foreach ($file in @("uninstall.ps1", "uninstall.cmd", "README.txt", "version.txt")) {
  $p = Join-Path $src $file
  if (Test-Path $p) { Copy-Item -Force $p $dest }
}
$node = Join-Path $dest "runtime\node.exe"
$cli = Join-Path $dest "app\filings.cjs"
if (-not (Test-Path $node) -or -not (Test-Path $cli)) { throw "설치 파일이 온전하지 않습니다(runtime\node.exe 또는 app\filings.cjs 없음)." }

# 4) mcm-filings:// 링크 — node 를 직접 실행한다(cmd 를 거치면 링크 문자열이 명령으로 해석될 수 있다)
$key = "HKCU:\Software\Classes\mcm-filings"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name "(default)" -Value "URL:MCM 신고 보조"
Set-ItemProperty -Path $key -Name "URL Protocol" -Value ""
New-Item -Path "$key\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$key\DefaultIcon" -Name "(default)" -Value "`"$node`",0"
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$key\shell\open\command" -Name "(default)" -Value "`"$node`" `"$cli`" handle-url `"%1`""
Write-Host "  mcm-filings:// 링크 등록"

# 5) 시작 메뉴
$menu = Join-Path ([Environment]::GetFolderPath("Programs")) "MCM 신고 보조"
if (Test-Path $menu) { Remove-Item -Recurse -Force $menu }
New-Item -ItemType Directory -Force $menu | Out-Null
$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$name, [string]$target, [string]$arguments) {
  $lnk = $shell.CreateShortcut((Join-Path $menu "$name.lnk"))
  $lnk.TargetPath = $target
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $dest
  $lnk.IconLocation = "$node,0"
  $lnk.Save()
}
New-Shortcut "대행 실적 보고 열기" $node "`"$cli`" handle-url `"mcm-filings://open?kind=ieps_agency`""
New-Shortcut "기술인력 변경신고 열기" $node "`"$cli`" handle-url `"mcm-filings://open?kind=ieps_staff`""
New-Shortcut "IEPS 로그인" $node "`"$cli`" login --site ieps"
New-Shortcut "MCM 다시 로그인" $node "`"$cli`" mcm-login"
New-Shortcut "신고 보조 제거" (Join-Path $dest "uninstall.cmd") ""
Write-Host "  시작 메뉴 'MCM 신고 보조' 바로가기"

$version = (Get-Content (Join-Path $dest "version.txt") -ErrorAction SilentlyContinue) -join ""
Write-Host ""
Write-Host "설치 완료 $version" -ForegroundColor Green
Write-Host "  MCM 앱 > 계약 > 대외 신고 대기열에서 [신고 보조 열기] 를 누르면 시작합니다."
Write-Host "  처음 한 번은 MCM 계정 로그인과 IEPS 로그인(문자인증)을 묻습니다."
Write-Host ""
