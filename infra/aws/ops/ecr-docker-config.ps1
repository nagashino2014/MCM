#Requires -Version 5.1
# ECR 전용 docker 설정 폴더 — 배포 스크립트가 dot-source 해서 쓴다.
#
# 2026-11-01·11-12 next 배포가 `docker login` 에서 `error storing credentials ... The stub received bad data.` 로 멈췄다.
# ECR 로그인 토큰(약 2,900자)이 Docker Desktop 의 credsStore(=Windows 자격증명 관리자, 비밀 약 2,560바이트 한도)에
# 들어가지 않기 때문이다. config 에서 credsStore 를 빼도 docker CLI 가 wincred 를 자동 감지해 같은 오류가 난다.
# auths 에 항목이 하나라도 있으면 자동 감지가 꺼지므로, 자리표시 항목 하나만 둔 별도 폴더를 만들어
# login·push 에만 `docker --config <폴더>` 로 넘긴다(빌드는 데몬 쪽이라 원래 설정·캐시를 그대로 쓴다).
# 토큰은 그 폴더 config.json 에 base64 로 남고 12시간 뒤 만료된다. 셸 환경변수(DOCKER_CONFIG)는 바꾸지 않는다.

function Initialize-EcrDockerConfig {
  param([string]$Path = (Join-Path $env:USERPROFILE ".docker-ecr"))
  if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
  $file = Join-Path $Path "config.json"
  $needsReset = $true
  if (Test-Path -LiteralPath $file) {
    try {
      $cfg = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
      $hasStore = ($cfg.PSObject.Properties.Name -contains "credsStore") -or ($cfg.PSObject.Properties.Name -contains "credHelpers")
      $hasAuths = ($cfg.auths -ne $null) -and (@($cfg.auths.PSObject.Properties).Count -gt 0)
      $needsReset = $hasStore -or (-not $hasAuths)
    } catch { $needsReset = $true }
  }
  if ($needsReset) {
    # BOM 없는 UTF-8 로 쓴다(PS 5.1 의 Set-Content/Out-File 기본값은 docker 가 읽지 못하는 인코딩이 섞인다).
    [System.IO.File]::WriteAllText($file, '{"auths":{"placeholder.invalid":{}}}', (New-Object System.Text.UTF8Encoding($false)))
  }
  return $Path
}
