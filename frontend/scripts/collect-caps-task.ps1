# 캡스 근태 이벤트 로그 수집 에이전트 — Windows 작업 스케줄러용 래퍼(collect-eum-task.ps1 관례).
# 캡스 근태 매니저가 매시 28분에 export 폴더로 txt 를 내리므로 기본 실행 시각은 매시 35분.
# 상용화 대비 실행 분(minute)은 등록 시 옵션이다 — 고객사 컨트롤러 저장 시각에 맞춰 지정한다.
#
# 등록(관리자 불필요, 사용자 세션):
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\CodingProject\MCM\frontend\scripts\collect-caps-task.ps1 -Register            # 매시 35분(기본)
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\CodingProject\MCM\frontend\scripts\collect-caps-task.ps1 -Register -Minute 50 # 매시 50분
# 해제: schtasks /Delete /TN "MCM 캡스 근태 수집" /F
# PC가 꺼져 있던 시간대는 다음 실행이 따라잡는다(최근 CAPS_DAYS일 파일 재스캔 + 서버 멱등 적재).

param(
  [switch]$Register,
  [ValidateRange(0, 59)][int]$Minute = 35
)

$ErrorActionPreference = "Stop"
$taskName = "MCM 캡스 근태 수집"

if ($Register) {
  # 매시 $Minute 분 실행 — 시작 시각을 다음 정시+$Minute 으로 잡고 1시간 간격 반복.
  $start = (Get-Date).Date.AddHours((Get-Date).Hour + 1).AddMinutes($Minute)
  schtasks /Create /F /TN $taskName `
    /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" `
    /SC HOURLY /MO 1 /ST $start.ToString("HH:mm")
  Write-Host "등록 완료: '$taskName' — 매시 $Minute 분 실행 (시작 $($start.ToString('yyyy-MM-dd HH:mm')))"
  exit $LASTEXITCODE
}

# node 의 UTF-8 출력을 PS 5.1 이 cp949 로 오해해 로그가 깨지는 것 방지
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$frontend = Split-Path -Parent $PSScriptRoot
Set-Location $frontend

# Avast SSL 인터셉션 환경 — node 외부 HTTPS 검증용 CA (파일이 있을 때만 지정)
$avastPem = "C:\ProgramData\Avast Software\Avast\wscert.pem"
if (Test-Path $avastPem) { $env:NODE_EXTRA_CA_CERTS = $avastPem }

$logDir = Join-Path $frontend "..\.local-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "collect-caps.log"

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$stamp] run" | Out-File -FilePath $log -Append -Encoding utf8
node scripts\collect-caps-local.mjs 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"[$stamp] exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
