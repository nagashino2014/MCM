#Requires -Version 5.1
<#
.SYNOPSIS
  문서 아카이브 전용 AWS 계정을 Organizations 멤버 계정으로 만들고 SSO 접근까지 붙인다.

.DESCRIPTION
  01-create-bucket.ps1 보다 먼저 실행한다.

  현재 조직 현황(2026-07 확인):
    Organization : o-i3vxiui5f5 (FeatureSet ALL, SCP 사용 가능)
    관리 계정    : 195748745315 "NotoriousBoy" (nagashino2014@gmail.com)
    Identity Ctr : ssoins-7230c5bc5d8984d6 / identity store d-9b6756b5f9
    권한 세트    : AdministratorAccess

  ★ AWS 계정의 루트 이메일은 전 세계에서 유일해야 한다. 이미 쓴 주소는 재사용할 수 없다.
    Gmail 은 '+태그' 를 붙여도 같은 받은편지함으로 배달되므로,
    nagashino2014+kesidocs@gmail.com 같은 주소를 쓰면 새 메일함 없이 계정을 만들 수 있다.
    (루트 이메일은 나중에 변경 가능하므로, 회사 도메인 그룹 주소가 준비되면 그때 바꾸면 된다.)

  Organizations 멤버 계정으로 만들면 좋은 점:
    - 통합 청구 — 청구서가 하나로 유지된다
    - 관리 계정에서 OrganizationAccountAccessRole 로 assume 가능 → **루트 로그인 없이** 작업
    - Identity Center 로 SSO 프로필만 추가하면 기존과 동일한 방식으로 접근
    - SCP 로 계정 단위 가드레일(버킷 삭제 금지 등) 적용 가능

.EXAMPLE
  .\infra\aws\cloudium\00-create-account.ps1 -Email "nagashino2014+kesidocs@gmail.com" -DryRun

.EXAMPLE
  .\infra\aws\cloudium\00-create-account.ps1 -Email "nagashino2014+kesidocs@gmail.com"
#>
param(
  [Parameter(Mandatory=$true)][string]$Email,
  [string]$AccountName   = "KESI Docs Archive",
  [string]$AwsProfile    = "mcm-kesi-staging",   # 관리 계정 프로필
  [string]$Region        = "ap-northeast-2",
  [string]$InstanceArn   = "arn:aws:sso:::instance/ssoins-7230c5bc5d8984d6",
  [string]$IdentityStore = "d-9b6756b5f9",
  [string]$PermissionSet = "AdministratorAccess",
  [string]$SsoUserName   = "jaeyoung",
  [string]$NewProfile    = "kesi-docs-prod",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $AwsProfile

function Log($m)  { Write-Host "[account] $m" }
function Warn($m) { Write-Host "[account] ⚠ $m" -ForegroundColor Yellow }

# ── 0) 관리 계정 확인 ───────────────────────────────────────────────────────────
$mgmt = aws organizations describe-organization --query "Organization.MasterAccountId" --output text
if ($LASTEXITCODE -ne 0) { throw "Organizations 조회 실패. 관리 계정 프로필로 SSO 로그인했는지 확인할 것." }
$me = aws sts get-caller-identity --query "Account" --output text
if ($me -ne $mgmt) { throw "현재 계정($me)은 관리 계정($mgmt)이 아니다. 계정 생성은 관리 계정에서만 가능하다." }
Log "관리 계정 $mgmt 확인"

# 같은 이메일로 이미 만든 계정이 있는지 (재실행 안전)
$dupe = aws organizations list-accounts --query "Accounts[?Email=='$Email'].Id" --output text
if ($dupe) {
  Log "이미 같은 이메일의 계정이 있다: $dupe (생성 건너뜀)"
  $newAccountId = $dupe
} else {
  # ── 1) 계정 생성 (비동기) ────────────────────────────────────────────────────
  Log "계정 생성 요청: $AccountName <$Email>"
  if ($DryRun) {
    Log "[dry-run] aws organizations create-account --email $Email --account-name `"$AccountName`""
    Log "[dry-run] 이후 단계는 계정 ID 가 있어야 진행되므로 여기서 종료한다."
    return
  }
  $reqId = aws organizations create-account `
    --email $Email --account-name $AccountName `
    --role-name OrganizationAccountAccessRole `
    --iam-user-access-to-billing DENY `
    --query "CreateAccountStatus.Id" --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw "create-account 실패" }

  # ── 2) 완료까지 폴링 ─────────────────────────────────────────────────────────
  Log "생성 진행 중 (보통 1~2분)"
  $state = "IN_PROGRESS"
  $tries = 0
  while ($state -eq "IN_PROGRESS" -and $tries -lt 60) {
    Start-Sleep -Seconds 5
    $tries++
    $state = aws organizations describe-create-account-status --create-account-request-id $reqId `
      --query "CreateAccountStatus.State" --output text
    Write-Host "." -NoNewline
  }
  Write-Host ""
  if ($state -ne "SUCCEEDED") {
    $reason = aws organizations describe-create-account-status --create-account-request-id $reqId `
      --query "CreateAccountStatus.FailureReason" --output text
    throw "계정 생성 실패: state=$state reason=$reason  (EMAIL_ALREADY_EXISTS 면 다른 +태그를 쓸 것)"
  }
  $newAccountId = aws organizations describe-create-account-status --create-account-request-id $reqId `
    --query "CreateAccountStatus.AccountId" --output text
  Log "계정 생성 완료: $newAccountId"
}

# ── 3) Identity Center 권한 세트 할당 ───────────────────────────────────────────
$psArn = aws sso-admin list-permission-sets --instance-arn $InstanceArn --query "PermissionSets" --output text
$psArnMatch = $null
foreach ($p in ($psArn -split "\s+" | Where-Object { $_ })) {
  $n = aws sso-admin describe-permission-set --instance-arn $InstanceArn --permission-set-arn $p `
    --query "PermissionSet.Name" --output text
  if ($n -eq $PermissionSet) { $psArnMatch = $p; break }
}
if (-not $psArnMatch) { throw "권한 세트 '$PermissionSet' 를 찾지 못했다." }

$userId = aws identitystore list-users --identity-store-id $IdentityStore `
  --query "Users[?UserName=='$SsoUserName'].UserId" --output text
if (-not $userId) { throw "Identity Center 사용자 '$SsoUserName' 를 찾지 못했다." }

Log "SSO 할당: $SsoUserName → $newAccountId ($PermissionSet)"
if (-not $DryRun) {
  aws sso-admin create-account-assignment `
    --instance-arn $InstanceArn --permission-set-arn $psArnMatch `
    --target-id $newAccountId --target-type AWS_ACCOUNT `
    --principal-type USER --principal-id $userId --no-cli-pager | Out-Null
  if ($LASTEXITCODE -ne 0) { Warn "할당 실패(이미 할당돼 있으면 무시해도 된다)" }
}

# ── 4) 프로필 스니펫 안내 ───────────────────────────────────────────────────────
$ssoStartUrl = ""
$cfgPath = Join-Path $env:USERPROFILE ".aws\config"
if (Test-Path $cfgPath) {
  $m = Select-String -Path $cfgPath -Pattern "sso_start_url\s*=\s*(\S+)" | Select-Object -First 1
  if ($m) { $ssoStartUrl = $m.Matches[0].Groups[1].Value }
}
if (-not $ssoStartUrl) { $ssoStartUrl = "<기존 프로필의 sso_start_url 을 복사>" }

Log ""
Log "완료. ~/.aws/config 에 아래를 추가한 뒤 로그인하면 된다:"
Write-Host ""
Write-Host "[profile $NewProfile]"
Write-Host "sso_start_url = $ssoStartUrl"
Write-Host "sso_region = $Region"
Write-Host "sso_account_id = $newAccountId"
Write-Host "sso_role_name = $PermissionSet"
Write-Host "region = $Region"
Write-Host "output = json"
Write-Host ""
Log "그다음:"
Log "  aws sso login --profile $NewProfile"
Log "  .\infra\aws\cloudium\01-create-bucket.ps1 -AwsProfile $NewProfile"
Warn "SSO 할당이 실제로 반영되기까지 1~2분 걸릴 수 있다. 로그인이 안 되면 잠시 후 재시도할 것."
