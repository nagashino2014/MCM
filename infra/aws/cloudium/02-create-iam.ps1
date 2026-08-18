#Requires -Version 5.1
<#
.SYNOPSIS
  클라우디움 문서 아카이브 버킷용 IAM 롤·정책 3종을 최소권한으로 생성한다.

.DESCRIPTION
  01-create-bucket.ps1 다음에 실행한다. 랜섬웨어 대비의 핵심은
  "게이트웨이가 탈취돼도 과거 버전을 파괴할 수 없게" 만드는 권한 분리다.

  ┌ 롤 ──────────────────┬ 신뢰 주체 ─────────────┬ 핵심 ────────────────────────────────┐
  │ *-filegateway        │ storagegateway         │ 읽기·쓰기·삭제마커 O                  │
  │                      │ .amazonaws.com         │ s3:DeleteObjectVersion **미부여** ★   │
  │ *-purge              │ SSO 관리자 권한 세트   │ 버전 삭제 + GovernanceBypass         │
  │                      │ 로 로그인한 principal  │ = 발주처 파기 요구 대응 / 사고 정리   │
  │ *-audit              │ 동일                   │ 읽기 + 감사로그 조회 전용            │
  └──────────────────────┴────────────────────────┴──────────────────────────────────────┘

  ★ AWS 가 안내하는 File Gateway 표준 정책에는 s3:DeleteObjectVersion 이 들어 있으나,
    여기서는 의도적으로 제외했다. 버전관리 버킷에서 파일 삭제·이름변경은 "삭제마커 생성"으로
    처리되므로 s3:DeleteObject 만으로 동작한다. 게이트웨이 로그에 DeleteObjectVersion
    AccessDenied 가 보이면 설계대로 막힌 것이며 정상이다(README 참고).

.EXAMPLE
  .\infra\aws\cloudium\02-create-iam.ps1 -Bucket kesi-docs-archive-123456789012 `
       -KmsKeyArn arn:aws:kms:ap-northeast-2:123456789012:key/xxxx
#>
param(
  [Parameter(Mandatory=$true)][string]$Bucket,
  [Parameter(Mandatory=$true)][string]$KmsKeyArn,
  [string]$AwsProfile   = "kesi-docs-prod",
  [string]$Region       = "ap-northeast-2",
  [string]$RolePrefix   = "kesi-docs",
  [string]$SsoPermissionSet = "AdministratorAccess",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $AwsProfile

function Log($m)  { Write-Host "[iam] $m" }
function Warn($m) { Write-Host "[iam] ⚠ $m" -ForegroundColor Yellow }

function Invoke-Aws {
  # ⚠ 파라미터명을 $Args 로 두면 PowerShell 자동 변수와 충돌해 빈 배열이 넘어온다. 반드시 다른 이름.
  param([string[]]$CliArgs, [switch]$AllowFail)
  if ($DryRun) { Log "[dry-run] aws $($CliArgs -join ' ')"; return "" }
  $out = & aws @CliArgs --no-cli-pager
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFail) { return $null }
    throw "aws $($CliArgs -join ' ') 실패 (exit $LASTEXITCODE)"
  }
  return $out
}

# 조회용 헬퍼 — ⚠ PS 5.1 은 native exe 의 stderr 리디렉션(2>$null)을 NativeCommandError 로 감싸므로
# $ErrorActionPreference='Stop' 상태에서 그대로 쓰면 "없음" 조회에도 스크립트가 죽는다.
function Get-AwsOrNull {
  param([string[]]$CliArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    $out = & aws @CliArgs --no-cli-pager 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $out
  } finally { $ErrorActionPreference = $prev }
}

function Test-AwsOk {
  param([string[]]$CliArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    & aws @CliArgs --no-cli-pager 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
  } finally { $ErrorActionPreference = $prev }
}

function Write-Utf8NoBom($Path, $Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding $false))
}

function Render-Json($TemplateName, $Replacements) {
  $src = Join-Path $PSScriptRoot $TemplateName
  if (-not (Test-Path $src)) { throw "템플릿 없음: $src" }
  $text = Get-Content $src -Raw
  foreach ($k in $Replacements.Keys) { $text = $text -replace ("\{\{" + $k + "\}\}"), $Replacements[$k] }
  $dst = Join-Path $env:TEMP ("cloudium-" + $TemplateName)
  Write-Utf8NoBom $dst $text
  return $dst
}

$accountId = (aws sts get-caller-identity --query "Account" --output text)
if ($LASTEXITCODE -ne 0 -or -not $accountId) { throw "AWS 자격증명 확인 실패." }
Log "account=$accountId bucket=$Bucket"

# 정책 본문의 placeholder 치환값
$repl = @{ "BUCKET" = $Bucket; "KMS_KEY_ARN" = $KmsKeyArn }

# ── 신뢰 정책 2종 ───────────────────────────────────────────────────────────────
$trustGateway = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "storagegateway.amazonaws.com" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": { "aws:SourceAccount": "$accountId" }
      }
    }
  ]
}
"@

# 사람이 assume 하는 롤.
# ⚠ 처음에는 Condition 을 aws:MultiFactorAuthPresent=true 로 걸었으나 **작동하지 않는다**.
#   IAM Identity Center(SSO) 로 받은 세션에는 이 컨텍스트 키가 실리지 않아서,
#   SSO 관리자조차 AssumeRole 이 AccessDenied 로 막힌다(= 파기 기능이 무용지물).
#   따라서 MFA 강제는 **Identity Center 레벨**에 맡기고, 여기서는
#   "SSO 관리자 권한 세트로 로그인한 principal 만" 으로 제한한다.
#   권한 세트를 재프로비저닝하면 롤 이름 뒤 해시가 바뀌므로 ArnLike 와일드카드를 쓴다.
$trustHuman = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::${accountId}:root" },
      "Action": "sts:AssumeRole",
      "Condition": {
        "ArnLike": {
          "aws:PrincipalArn": "arn:aws:iam::${accountId}:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_${SsoPermissionSet}_*"
        }
      }
    }
  ]
}
"@

# ── 헬퍼: 관리형 정책 생성 또는 새 기본 버전 등록 ────────────────────────────────
function Upsert-Policy($PolicyName, $DocPath) {
  $arn = "arn:aws:iam::${accountId}:policy/$PolicyName"
  if (Test-AwsOk @("iam","get-policy","--policy-arn",$arn)) {
    Log "정책 $PolicyName 갱신(새 기본 버전)"
    # 정책 버전은 최대 5개 — 가장 오래된 비기본 버전을 먼저 비운다.
    $vers = Get-AwsOrNull @("iam","list-policy-versions","--policy-arn",$arn,
      "--query","Versions[?IsDefaultVersion==``false``].VersionId","--output","text")
    if ($vers) {
      $verList = $vers -split "\s+" | Where-Object { $_ }
      if ($verList.Count -ge 4) {
        $oldest = $verList[-1]
        Invoke-Aws @("iam","delete-policy-version","--policy-arn",$arn,"--version-id",$oldest) -AllowFail | Out-Null
      }
    }
    Invoke-Aws @("iam","create-policy-version","--policy-arn",$arn,
      "--policy-document","file://$DocPath","--set-as-default") | Out-Null
  } else {
    Log "정책 $PolicyName 생성"
    Invoke-Aws @("iam","create-policy","--policy-name",$PolicyName,
      "--policy-document","file://$DocPath",
      "--description","cloudium document archive - least privilege") | Out-Null
  }
  return $arn
}

# ── 헬퍼: 롤 생성(있으면 신뢰정책만 갱신) + 정책 연결 ────────────────────────────
function Upsert-Role($RoleName, $TrustJson, $PolicyArn) {
  $trustFile = Join-Path $env:TEMP "cloudium-trust-$RoleName.json"
  Write-Utf8NoBom $trustFile $TrustJson
  if (Test-AwsOk @("iam","get-role","--role-name",$RoleName)) {
    Log "롤 $RoleName 이미 존재 — 신뢰정책 갱신"
    Invoke-Aws @("iam","update-assume-role-policy","--role-name",$RoleName,
      "--policy-document","file://$trustFile") | Out-Null
  } else {
    Log "롤 $RoleName 생성"
    Invoke-Aws @("iam","create-role","--role-name",$RoleName,
      "--assume-role-policy-document","file://$trustFile",
      "--max-session-duration","3600",
      "--description","cloudium document archive") | Out-Null
  }
  Invoke-Aws @("iam","attach-role-policy","--role-name",$RoleName,"--policy-arn",$PolicyArn) | Out-Null
}

# ── 1) File Gateway 롤 ──────────────────────────────────────────────────────────
$gwDoc  = Render-Json "iam-filegateway-policy.json" $repl
$gwPol  = Upsert-Policy "$RolePrefix-filegateway-policy" $gwDoc
Upsert-Role "$RolePrefix-filegateway" $trustGateway $gwPol

# ── 2) 파기 담당 롤 ─────────────────────────────────────────────────────────────
$pgDoc  = Render-Json "iam-purge-policy.json" $repl
$pgPol  = Upsert-Policy "$RolePrefix-purge-policy" $pgDoc
Upsert-Role "$RolePrefix-purge" $trustHuman $pgPol

# ── 3) 감사·조회 롤 (읽기 전용) ─────────────────────────────────────────────────
$adDoc  = Render-Json "iam-audit-readonly-policy.json" $repl
$adPol  = Upsert-Policy "$RolePrefix-audit-policy" $adDoc
Upsert-Role "$RolePrefix-audit" $trustHuman $adPol

Log ""
Log "완료. 생성된 롤:"
Log "  arn:aws:iam::${accountId}:role/$RolePrefix-filegateway   ← File Gateway 활성화 시 지정"
Log "  arn:aws:iam::${accountId}:role/$RolePrefix-purge          ← 버킷 정책의 파기 예외 롤"
Log "  arn:aws:iam::${accountId}:role/$RolePrefix-audit          ← 감사·조회"
Log ""
Warn "01 실행 시 -PurgeRoleName 을 기본값(kesi-docs-purge)에서 바꿨다면,"
Warn "버킷 정책의 예외 롤 이름과 여기서 만든 롤 이름이 일치하는지 확인할 것."

# 조회 헬퍼가 남긴 aws cli 의 exit code(예: 리소스 없음 254)가 스크립트 반환값으로 새지 않게 한다.
exit 0
