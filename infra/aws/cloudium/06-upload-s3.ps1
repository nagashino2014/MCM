#Requires -Version 5.1
<#
.SYNOPSIS
  로컬 스테이징 폴더를 S3 아카이브 버킷으로 업로드한다(중단 후 재개 가능).

.DESCRIPTION
  05-verify-staging.ps1 로 검증한 뒤 실행한다. 대상이 로컬 디스크라 클라우디움 제약과 무관하다.

  `aws s3 sync` 를 쓰므로 **이미 올라간 파일은 건너뛴다** → 중단되면 그냥 다시 실행하면 된다.
  중단된 멀티파트 업로드는 버킷 Lifecycle 의 `abort-incomplete-multipart-7d` 규칙이 정리한다.

  ⚠ 버킷에 Object Lock GOVERNANCE 90일이 걸려 있다. 잘못 올린 객체는 90일간 지울 수 없고
    kesi-docs-purge 롤로 bypass 해야 한다. **처음에는 반드시 -DryRun 으로 확인할 것.**

.PARAMETER Prefix
  S3 키 앞에 붙일 경로. 원본 폴더 구조를 살리려면 부서/폴더명을 준다(예: "전사폴더/통합환경1본부").
  비우면 버킷 루트에 그대로 올라간다.

.PARAMETER KeepEmptyFolders
  빈 폴더를 0바이트 객체(`키/`)로 만들어 보존한다. s3 sync 는 빈 폴더를 올리지 않아
  File Gateway 에서 사라지기 때문. 필요할 때만 쓴다.

.PARAMETER DeleteLocalAfterVerify
  업로드 검증(객체 수·용량 대조)을 통과한 경우에만 스테이징을 삭제한다.
  D: 여유가 1.8TB 라 4.87TB 를 나눠 옮겨야 하므로, 폴더 단위로 옮길 때 유용하다.

.EXAMPLE
  # 1) 먼저 확인만
  .\infra\aws\cloudium\06-upload-s3.ps1 -Staging "D:\staging\통합환경1본부" -Prefix "전사폴더/통합환경1본부" -DryRun

.EXAMPLE
  # 2) 실제 업로드
  .\infra\aws\cloudium\06-upload-s3.ps1 -Staging "D:\staging\통합환경1본부" -Prefix "전사폴더/통합환경1본부"

.EXAMPLE
  # 3) 업로드 + 검증 통과 시 로컬 정리 (다음 폴더 공간 확보)
  .\infra\aws\cloudium\06-upload-s3.ps1 -Staging "D:\staging\통합환경1본부" -Prefix "전사폴더/통합환경1본부" -DeleteLocalAfterVerify
#>
param(
  [Parameter(Mandatory=$true)][string]$Staging,
  [string]$Bucket      = "kesi-docs-archive-921784996915",
  [string]$Prefix      = "",
  [string]$AwsProfile  = "kesi-docs-prod",
  [string]$Region      = "ap-northeast-2",
  [int]   $Concurrency = 20,
  [switch]$KeepEmptyFolders,
  [switch]$DeleteLocalAfterVerify,
  [switch]$Quiet,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $AwsProfile

function Log($m)  { Write-Host "[upload] $m" }
function Warn($m) { Write-Host "[upload] ⚠ $m" -ForegroundColor Yellow }
function Ok($m)   { Write-Host "[upload] ✓ $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "[upload] ✗ $m" -ForegroundColor Red }

function Format-Bytes($b) {
  if ($null -eq $b -or $b -eq 0) { return "0 B" }
  $u = @("B","KB","MB","GB","TB"); $i = 0; $v = [double]$b
  while ($v -ge 1024 -and $i -lt 4) { $v /= 1024; $i++ }
  return ("{0:N2} {1}" -f $v, $u[$i])
}

# ── 0) 사전 확인 ────────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $Staging)) { throw "Staging 경로가 없다: $Staging" }
$root = (Resolve-Path -LiteralPath $Staging).Path
$qual = (Split-Path -Qualifier $root).ToUpper()
if ($qual -eq "T:" -or $qual -eq "S:") {
  throw "Staging 이 클라우디움 드라이브($qual)다. 탐색기로 로컬에 복사한 폴더를 지정할 것."
}

$acct = aws sts get-caller-identity --query "Account" --output text
if ($LASTEXITCODE -ne 0) { throw "AWS 자격증명 확인 실패. 'aws sso login --profile $AwsProfile' 후 재실행할 것." }

$pfx = $Prefix.Trim('/')
$dest = if ($pfx) { "s3://$Bucket/$pfx" } else { "s3://$Bucket" }

$localFiles = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue)
$localBytes = ($localFiles | Measure-Object -Property Length -Sum).Sum

Log "account=$acct  bucket=$Bucket"
Log "로컬  : $root"
Log ("        {0:N0} 파일 / {1}" -f $localFiles.Count, (Format-Bytes $localBytes))
Log "대상  : $dest"
if ($DryRun) { Warn "DryRun — 실제 업로드 없음" }
Log ""

# ── 1) 동시성 설정 ──────────────────────────────────────────────────────────────
if (-not $DryRun) {
  aws configure set default.s3.max_concurrent_requests $Concurrency --profile $AwsProfile | Out-Null
  Log "동시 요청 수 = $Concurrency (프로필 $AwsProfile 에 설정됨)"
}

# ── 2) 업로드 (재개 가능) ───────────────────────────────────────────────────────
Log "업로드 시작 — 중단되면 같은 명령을 다시 실행하면 이어서 진행된다"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$syncArgs = @("s3","sync",$root,$dest)
if ($DryRun) { $syncArgs += "--dryrun" }
if ($Quiet)  { $syncArgs += "--only-show-errors" } else { $syncArgs += "--no-progress" }

& aws @syncArgs
$rc = $LASTEXITCODE
$sw.Stop()

if ($rc -ne 0) {
  Bad "s3 sync 실패 (exit=$rc). 같은 명령을 재실행하면 이어서 진행된다."
  exit 1
}
$mbps = if ($sw.Elapsed.TotalSeconds -gt 0) { ($localBytes / 1MB) / $sw.Elapsed.TotalSeconds } else { 0 }
Ok ("업로드 완료 — {0:N1}분, 평균 {1:N1} MB/s" -f $sw.Elapsed.TotalMinutes, $mbps)

if ($DryRun) { Log ""; Log "DryRun 종료. 실제 업로드하려면 -DryRun 을 빼고 재실행할 것."; exit 0 }

# ── 3) 빈 폴더 보존 (옵션) ──────────────────────────────────────────────────────
if ($KeepEmptyFolders) {
  $rootLen = $root.TrimEnd('\').Length + 1
  $empty = @(Get-ChildItem -LiteralPath $root -Recurse -Directory -Force -ErrorAction SilentlyContinue |
             Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) })
  if ($empty.Count -gt 0) {
    Log ("빈 폴더 {0:N0}개를 0바이트 객체로 생성 중..." -f $empty.Count)
    $n = 0
    foreach ($d in $empty) {
      $rel = $d.FullName.Substring($rootLen).Replace('\','/')
      $key = if ($pfx) { "$pfx/$rel/" } else { "$rel/" }
      aws s3api put-object --bucket $Bucket --key $key --region $Region | Out-Null
      if ($LASTEXITCODE -eq 0) { $n++ }
    }
    Ok ("빈 폴더 {0:N0}개 생성" -f $n)
  } else { Log "빈 폴더 없음" }
}

# ── 4) 업로드 검증 ──────────────────────────────────────────────────────────────
Log ""
Log "검증 중 — S3 객체 수·용량 집계"
$lsPath = if ($pfx) { "s3://$Bucket/$pfx/" } else { "s3://$Bucket/" }
$summary = & aws s3 ls $lsPath --recursive --summarize
if ($LASTEXITCODE -ne 0) { Warn "집계 실패 — 수동으로 확인할 것"; exit 1 }

# "Total Objects: N" / "Total Size: N" 은 영어 고정 출력이라 로케일 영향이 없다.
$objLine  = $summary | Where-Object { $_ -match 'Total Objects:\s*(\d+)' }
$sizeLine = $summary | Where-Object { $_ -match 'Total Size:\s*(\d+)' }
$s3Objects = if ($objLine  -match 'Total Objects:\s*(\d+)') { [int64]$Matches[1] } else { -1 }
$s3Bytes   = if ($sizeLine -match 'Total Size:\s*(\d+)')    { [int64]$Matches[1] } else { -1 }

Log ("  로컬 : {0,10:N0} 파일 / {1}" -f $localFiles.Count, (Format-Bytes $localBytes))
Log ("  S3   : {0,10:N0} 객체 / {1}" -f $s3Objects, (Format-Bytes $s3Bytes))

# 빈 폴더 객체를 만들었다면 S3 객체 수가 그만큼 많은 것이 정상이다.
$verified = ($s3Objects -ge $localFiles.Count) -and ($s3Bytes -ge $localBytes)
if ($verified) {
  Ok "검증 통과 — 모든 파일이 업로드됨"
} else {
  Bad ("검증 실패 — 부족: {0:N0} 객체 / {1}" -f ($localFiles.Count - $s3Objects), (Format-Bytes ($localBytes - $s3Bytes)))
  Log "같은 명령을 재실행하면 누락분만 다시 올라간다."
  exit 1
}

# ── 5) 로컬 정리 (옵션, 검증 통과 시에만) ───────────────────────────────────────
if ($DeleteLocalAfterVerify) {
  if (-not $verified) { Warn "검증 미통과 — 로컬을 삭제하지 않는다"; exit 1 }
  Warn "검증을 통과했으므로 스테이징을 삭제한다: $root"
  Remove-Item -LiteralPath $root -Recurse -Force
  Ok "로컬 정리 완료 — 다음 폴더를 복사할 공간이 확보됐다"
}

Log ""
Log "다음: 남은 폴더를 탐색기로 D:\staging 에 복사 → 05 검증 → 06 업로드 를 반복"

exit 0
