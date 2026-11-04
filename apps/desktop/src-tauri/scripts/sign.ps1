# MCM 데스크탑 위젯 — 빌드 산출물 코드 서명 (tauri.conf.json bundle.windows.signCommand 가 exe·인스톨러마다 호출)
#
# 서명 수단은 환경변수로 고른다. 아무것도 없으면 서명을 건너뛰고 빌드는 계속된다(개발 PC 에서 서명 없이 빌드 가능).
#   1) Azure Trusted Signing(Artifact Signing) — 권장
#        MCM_SIGN_METADATA = metadata.json 경로  {"Endpoint":"https://<region>.codesigning.azure.net/",
#                                                 "CodeSigningAccountName":"<계정>","CertificateProfileName":"<프로필>"}
#        MCM_SIGN_DLIB     = Azure.CodeSigning.Dlib.dll 경로(NuGet Microsoft.Trusted.Signing.Client 의 bin/x64)
#        인증: 빌드 셸에서 `az login`(사용자) 또는 AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET(서비스 주체)
#   2) 로컬 인증서(OV/EV 토큰·스토어)
#        MCM_SIGN_THUMBPRINT = 인증서 SHA1 지문 (현재 사용자/로컬 컴퓨터 개인 저장소)
#   공통: signtool.exe 는 Windows 10/11 SDK 에서 찾는다(MCM_SIGNTOOL 로 경로를 직접 줄 수 있다).
#
# ⚠ SmartScreen 평판은 파일 해시 단위로 쌓인다(2026-11-04 조사) — 서명해도 새 빌드마다 평판이 0 에서 시작할 수 있다.
param([Parameter(Mandatory = $true)][string]$File)

$ErrorActionPreference = 'Stop'

function Find-SignTool {
  if ($env:MCM_SIGNTOOL -and (Test-Path $env:MCM_SIGNTOOL)) { return $env:MCM_SIGNTOOL }
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (Test-Path $kits) {
    $found = Get-ChildItem -Path $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
    if ($found) { return $found.FullName }
  }
  return $null
}

if (-not $env:MCM_SIGN_METADATA -and -not $env:MCM_SIGN_THUMBPRINT) {
  Write-Host "[sign] 서명 생략(MCM_SIGN_METADATA / MCM_SIGN_THUMBPRINT 없음): $File"
  exit 0
}

$signtool = Find-SignTool
if (-not $signtool) { throw "[sign] signtool.exe 를 찾지 못했다 — Windows SDK 를 설치하거나 MCM_SIGNTOOL 을 지정" }

$ts = 'http://timestamp.acs.microsoft.com'
if ($env:MCM_SIGN_METADATA) {
  if (-not $env:MCM_SIGN_DLIB -or -not (Test-Path $env:MCM_SIGN_DLIB)) { throw "[sign] MCM_SIGN_DLIB(Azure.CodeSigning.Dlib.dll) 경로가 없다" }
  if (-not (Test-Path $env:MCM_SIGN_METADATA)) { throw "[sign] MCM_SIGN_METADATA 파일이 없다: $env:MCM_SIGN_METADATA" }
  Write-Host "[sign] Trusted Signing: $File"
  & $signtool sign /v /fd SHA256 /tr $ts /td SHA256 /dlib $env:MCM_SIGN_DLIB /dmdf $env:MCM_SIGN_METADATA $File
} else {
  Write-Host "[sign] 인증서 지문 $($env:MCM_SIGN_THUMBPRINT): $File"
  & $signtool sign /v /fd SHA256 /tr $ts /td SHA256 /sha1 $env:MCM_SIGN_THUMBPRINT $File
}
if ($LASTEXITCODE -ne 0) { throw "[sign] signtool 종료 코드 $LASTEXITCODE" }
