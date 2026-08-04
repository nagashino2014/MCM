# 토지이음 로컬 수집 에이전트 — Windows 작업 스케줄러용 래퍼.
# 등록(관리자 불필요, 사용자 세션):
#   schtasks /Create /TN "MCM 토지이음 수집" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\CodingProject\MCM\frontend\scripts\collect-eum-task.ps1" /SC DAILY /ST 08:30
# PC가 꺼져 있던 날은 다음 실행이 따라잡는다(목록 앞 페이지 재조회 + 서버 멱등 적재).

$ErrorActionPreference = "Stop"
$frontend = Split-Path -Parent $PSScriptRoot
Set-Location $frontend

# Avast SSL 인터셉션 환경 — node 외부 HTTPS 검증용 CA (파일이 있을 때만 지정)
$avastPem = "C:\ProgramData\Avast Software\Avast\wscert.pem"
if (Test-Path $avastPem) { $env:NODE_EXTRA_CA_CERTS = $avastPem }

$logDir = Join-Path $frontend "..\.local-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "collect-eum.log"

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$stamp] run" | Out-File -FilePath $log -Append -Encoding utf8
node scripts\collect-eum-local.mjs 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
"[$stamp] exit=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
