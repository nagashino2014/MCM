#Requires -Version 5.1
<#
.SYNOPSIS
  클라우디움 문서 아카이브를 받을 S3 버킷을 Object Lock 활성 상태로 생성한다.

.DESCRIPTION
  온프렘 클라우디움(가비아/사이버다임) 보안서버 4.87TB / 문서 119만건을 S3 로 이전하기 위한
  1단계 스크립트. 랜섬웨어 대비 불변성(Object Lock)과 발주처 수탁자료 관리책임 입증(KMS CMK·감사)을
  전제로 버킷을 만든다.

  ★ Object Lock 은 "버킷 생성 시에만" 활성화할 수 있고 사후 소급이 불가능하다.
    따라서 이 스크립트로 만든 버킷을 그대로 운영에 쓴다. 연습은 -Bucket 에 다른 이름을 주고 할 것.

  수행 항목(모두 멱등 — 이미 적용돼 있으면 건너뛴다):
   1) KMS 고객관리형 키(CMK) + alias 생성
   2) 버킷 생성 (--object-lock-enabled-for-bucket → 버전관리 자동 Enabled)
   3) 버전관리 상태 확인/보정
   4) 퍼블릭 액세스 4종 전면 차단
   5) 기본 암호화 SSE-KMS + S3 Bucket Key(KMS 요청비 최대 99% 절감 — 119만 객체라 필수)
   6) Object Lock 기본 보존: GOVERNANCE 모드 N일
      · GOVERNANCE 를 쓰는 이유 = 발주처 "자료 파기" 요구에 응할 수 있어야 하기 때문.
        COMPLIANCE 는 루트도 못 지우므로 파기 약정과 충돌한다.
   7) 버킷 정책 (TLS 강제 + 버전 파괴/버전관리 해제를 파기 롤 외 전면 Deny)
   8) Lifecycle (자동 파기 없음 — lifecycle.json 참고)
   9) 태그

.PARAMETER AwsProfile
  ⚠ 앱(staging) 계정과 문서 아카이브를 같은 계정에 두는 것은 권장하지 않는다.
     권한·과금 분리와 랜섬웨어 격리를 위해 전용 계정을 만들고 그 프로필을 지정할 것.

.PARAMETER NoDefaultRetention
  Object Lock 기본 보존을 걸지 않는다(마이그레이션 리허설용 임시 버킷에만 사용).

.EXAMPLE
  pwsh infra/aws/cloudium/01-create-bucket.ps1 -AwsProfile kesi-docs-prod

.EXAMPLE
  # 실제 변경 없이 무엇을 할지만 확인
  pwsh infra/aws/cloudium/01-create-bucket.ps1 -AwsProfile kesi-docs-prod -DryRun
#>
param(
  [string]$AwsProfile           = "kesi-docs-prod",
  [string]$Region               = "ap-northeast-2",
  [string]$BucketPrefix         = "kesi-docs-archive",
  [string]$Bucket               = "",
  [string]$KmsAlias             = "alias/kesi-docs-archive",
  [int]   $DefaultRetentionDays = 90,
  [string]$PurgeRoleName        = "kesi-docs-purge",
  [switch]$NoDefaultRetention,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $AwsProfile

function Log($m) { Write-Host "[bucket] $m" }
function Warn($m) { Write-Host "[bucket] ⚠ $m" -ForegroundColor Yellow }

# aws cli 는 native exe 라 $ErrorActionPreference 가 안 먹는다 → exit code 를 직접 본다.
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

# 조회용 헬퍼 — 실패해도 스크립트를 멈추지 않는다.
# ⚠ PS 5.1 은 native exe 의 stderr 리디렉션(2>$null)을 NativeCommandError 로 감싸므로,
#   $ErrorActionPreference='Stop' 상태에서 그대로 쓰면 정상 조회 실패에도 스크립트가 죽는다.
#   반드시 아래처럼 호출 구간에서만 임시 완화할 것.
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

# PS 5.1 의 Set-Content/Out-File -Encoding utf8 은 BOM 을 붙이고, aws cli 가 BOM 있는 JSON 을
# 파싱하지 못한다. 반드시 BOM 없는 UTF8 로 써야 한다.
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

# ── 0) 사전 확인 ────────────────────────────────────────────────────────────────
$accountId = (aws sts get-caller-identity --query "Account" --output text)
if ($LASTEXITCODE -ne 0 -or -not $accountId) {
  throw "AWS 자격증명 확인 실패. 'aws sso login --profile $AwsProfile' 후 다시 실행할 것."
}
if (-not $Bucket) { $Bucket = "$BucketPrefix-$accountId" }
Log "profile=$AwsProfile account=$accountId region=$Region"
Log "bucket=$Bucket"
if ($DryRun) { Warn "DryRun 모드 — 실제 변경 없음" }

# ── 1) KMS CMK + alias ─────────────────────────────────────────────────────────
$keyArn = Get-AwsOrNull @("kms","describe-key","--key-id",$KmsAlias,"--region",$Region,
  "--query","KeyMetadata.Arn","--output","text")
if (-not $keyArn -or $keyArn -eq "None") {
  Log "KMS 키 생성 ($KmsAlias)"
  if ($DryRun) {
    $keyArn = "arn:aws:kms:${Region}:${accountId}:key/DRYRUN"
  } else {
    $keyId = aws kms create-key `
      --description "KESI document archive (cloudium migration) - envelope key for S3 SSE-KMS" `
      --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT `
      --tags "TagKey=Project,TagValue=cloudium-migration" "TagKey=Owner,TagValue=KESI" `
      --region $Region --query "KeyMetadata.KeyId" --output text --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw "KMS 키 생성 실패" }
    Invoke-Aws @("kms","enable-key-rotation","--key-id",$keyId,"--region",$Region) | Out-Null
    Invoke-Aws @("kms","create-alias","--alias-name",$KmsAlias,"--target-key-id",$keyId,"--region",$Region) | Out-Null
    $keyArn = Get-AwsOrNull @("kms","describe-key","--key-id",$KmsAlias,"--region",$Region,
      "--query","KeyMetadata.Arn","--output","text")
  }
} else {
  Log "KMS 키 이미 존재 (skip)"
}
Log "kms=$keyArn"

# ── 2) 버킷 생성 (Object Lock 활성) ─────────────────────────────────────────────
$bucketExists = Test-AwsOk @("s3api","head-bucket","--bucket",$Bucket,"--region",$Region)
if ($bucketExists) {
  $lockCfg = Get-AwsOrNull @("s3api","get-object-lock-configuration","--bucket",$Bucket,"--region",$Region,
    "--query","ObjectLockConfiguration.ObjectLockEnabled","--output","text")
  if ($lockCfg -ne "Enabled") {
    throw "버킷 $Bucket 는 이미 있지만 Object Lock 이 비활성이다. Object Lock 은 사후 활성화가 불가하므로 다른 버킷명을 쓸 것."
  }
  Log "버킷 이미 존재 + Object Lock Enabled (skip 생성)"
} else {
  Log "버킷 생성 (Object Lock enabled)"
  Invoke-Aws @("s3api","create-bucket","--bucket",$Bucket,"--region",$Region,
    "--create-bucket-configuration","LocationConstraint=$Region",
    "--object-lock-enabled-for-bucket") | Out-Null
}

# ── 3) 버전관리 (Object Lock 이면 자동 Enabled — 보정용 확인) ────────────────────
$ver = Get-AwsOrNull @("s3api","get-bucket-versioning","--bucket",$Bucket,"--region",$Region,
  "--query","Status","--output","text")
if ($ver -ne "Enabled") {
  Log "버전관리 Enabled 설정"
  Invoke-Aws @("s3api","put-bucket-versioning","--bucket",$Bucket,"--region",$Region,
    "--versioning-configuration","Status=Enabled") | Out-Null
} else {
  Log "버전관리 Enabled (skip)"
}

# ── 4) 퍼블릭 액세스 전면 차단 ───────────────────────────────────────────────────
Log "퍼블릭 액세스 4종 차단"
Invoke-Aws @("s3api","put-public-access-block","--bucket",$Bucket,"--region",$Region,
  "--public-access-block-configuration",
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true") | Out-Null

# ── 5) 기본 암호화 SSE-KMS + Bucket Key ─────────────────────────────────────────
Log "기본 암호화 SSE-KMS + BucketKeyEnabled"
$encJson = @"
{
  "Rules": [
    {
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "$keyArn"
      },
      "BucketKeyEnabled": true
    }
  ]
}
"@
$encFile = Join-Path $env:TEMP "cloudium-encryption.json"
Write-Utf8NoBom $encFile $encJson
Invoke-Aws @("s3api","put-bucket-encryption","--bucket",$Bucket,"--region",$Region,
  "--server-side-encryption-configuration","file://$encFile") | Out-Null

# ── 6) Object Lock 기본 보존 (GOVERNANCE) ───────────────────────────────────────
if ($NoDefaultRetention) {
  Warn "기본 보존 미설정(-NoDefaultRetention). 신규 객체에 락이 걸리지 않는다 — 리허설용에만 쓸 것."
} else {
  Log "Object Lock 기본 보존: GOVERNANCE $DefaultRetentionDays 일"
  $lockJson = @"
{
  "ObjectLockEnabled": "Enabled",
  "Rule": {
    "DefaultRetention": {
      "Mode": "GOVERNANCE",
      "Days": $DefaultRetentionDays
    }
  }
}
"@
  $lockFile = Join-Path $env:TEMP "cloudium-objectlock.json"
  Write-Utf8NoBom $lockFile $lockJson
  Invoke-Aws @("s3api","put-object-lock-configuration","--bucket",$Bucket,"--region",$Region,
    "--object-lock-configuration","file://$lockFile") | Out-Null
}

# ── 7) 버킷 정책 ────────────────────────────────────────────────────────────────
Log "버킷 정책 적용 (TLS 강제 + 버전 파괴 Deny, 예외=$PurgeRoleName)"
$polFile = Render-Json "bucket-policy.json" @{
  "BUCKET"          = $Bucket
  "ACCOUNT_ID"      = $accountId
  "PURGE_ROLE_NAME" = $PurgeRoleName
}
Invoke-Aws @("s3api","put-bucket-policy","--bucket",$Bucket,"--region",$Region,
  "--policy","file://$polFile") | Out-Null

# ── 8) Lifecycle (자동 파기 없음) ───────────────────────────────────────────────
Log "Lifecycle 적용 (미완료 MPU 정리·삭제마커 정리·이전버전 IA/만료. 현행 객체 자동 삭제 없음)"
$lcFile = Join-Path $PSScriptRoot "lifecycle.json"
if (-not (Test-Path $lcFile)) { throw "lifecycle.json 없음: $lcFile" }
Invoke-Aws @("s3api","put-bucket-lifecycle-configuration","--bucket",$Bucket,"--region",$Region,
  "--lifecycle-configuration","file://$lcFile") | Out-Null

# ── 9) 태그 ─────────────────────────────────────────────────────────────────────
Log "버킷 태그"
Invoke-Aws @("s3api","put-bucket-tagging","--bucket",$Bucket,"--region",$Region,
  "--tagging","TagSet=[{Key=Project,Value=cloudium-migration},{Key=Owner,Value=KESI},{Key=DataClass,Value=internal-and-client-provided}]") | Out-Null

# ── 요약 ───────────────────────────────────────────────────────────────────────
Log ""
Log "완료."
Log "  버킷      : $Bucket"
Log "  KMS       : $keyArn"
Log "  Object Lock: GOVERNANCE $(if ($NoDefaultRetention) { '미설정' } else { "$DefaultRetentionDays 일" })"
Log ""
Log "다음: pwsh infra/aws/cloudium/02-create-iam.ps1 -Bucket $Bucket -KmsKeyArn $keyArn"
Warn "MFA Delete 는 루트 액세스 키가 필요해 권장하지 않는다. Object Lock + 버킷 정책 Deny 로 이미 방어된다(README '수동 작업' 참고)."

# 조회 헬퍼가 남긴 aws cli 의 exit code(예: 리소스 없음 254)가 스크립트 반환값으로 새지 않게 한다.
exit 0
