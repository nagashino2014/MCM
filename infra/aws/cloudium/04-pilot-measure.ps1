#Requires -Version 5.1
<#
.SYNOPSIS
  클라우디움 T: 드라이브의 실제 읽기 성능을 측정해 전체 마이그레이션 소요를 추정한다.

.DESCRIPTION
  T: 는 클라우디움 클라이언트가 만드는 **가상 드라이브**라 일반 파일시스템과 성능 특성이 다르다
  (파일마다 서버 왕복 + 복호화). 회선 대역폭 계산만으로는 일정을 세울 수 없고,
  대부분의 경우 **드라이브 자체가 병목**이다. 그래서 옮기기 전에 실측한다.

  측정 항목:
   1) 인벤토리 — 파일 수·용량·크기 분포·확장자·경로 길이, 그리고 **디렉터리 열거 속도**
      (탐색기에서 폴더 여는 체감과 직결된다)
   2) 속성 복사 가능 여부 — /COPY:DAT(ACL 포함) 가 되는지, 안 되면 /COPY:DT 로 낮춰야 하는지
   3) 스레드별 처리량 — /MT 를 올릴 때 실제로 빨라지는지, 서버가 버티는지
   4) (옵션) S3 업로드 처리량
   5) 전체 외삽 — 4,872GB / 문서 1,193,509건 기준 예상 소요

  ★ 이 스크립트는 T: 에서 **읽기만** 한다. robocopy /MIR 은 절대 쓰지 않는다
    (방향을 잘못 주면 원본이 지워진다). 삭제는 스테이징 폴더 하위로만 제한된다.

.PARAMETER Source
  측정할 T: 하위 폴더. 대표성을 위해 **파일 수가 많은 실무 폴더**를 고를 것(2~10GB 권장).

.PARAMETER Staging
  로컬 임시 폴더. T:/S: 가 아니어야 하고, Source 용량의 1.2배 여유가 필요하다.

.EXAMPLE
  # 인벤토리만 먼저 (복사 없음, 안전)
  .\infra\aws\cloudium\04-pilot-measure.ps1 -Source "T:\한국환경안전연구원\통합환경1본부\2024" -InventoryOnly

.EXAMPLE
  # 전체 측정
  .\infra\aws\cloudium\04-pilot-measure.ps1 -Source "T:\한국환경안전연구원\통합환경1본부\2024" -Staging "D:\cloudium-pilot"

.EXAMPLE
  # S3 업로드 처리량까지
  .\infra\aws\cloudium\04-pilot-measure.ps1 -Source "T:\...\2024" -Staging "D:\cloudium-pilot" `
       -TestS3Upload -Bucket kesi-docs-archive-921784996915 -AwsProfile kesi-docs-prod
#>
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [string]$Staging     = "D:\cloudium-pilot",
  [int[]] $Threads     = @(1,4,8,16),
  [string]$OutDir      = "$env:TEMP\cloudium-pilot-results",
  [switch]$InventoryOnly,
  [switch]$SkipAttrTest,
  [switch]$TestS3Upload,
  [string]$Bucket      = "",
  [string]$AwsProfile  = "kesi-docs-prod"
)
$ErrorActionPreference = "Stop"

# 전체 모집단(2026-07 실측) — 외삽 기준
$TOTAL_BYTES = 5230692544851
$TOTAL_FILES = 1193509

function Log($m)  { Write-Host "[pilot] $m" }
function Warn($m) { Write-Host "[pilot] ⚠ $m" -ForegroundColor Yellow }
function Ok($m)   { Write-Host "[pilot] ✓ $m" -ForegroundColor Green }

function Format-Bytes($b) {
  if ($null -eq $b -or $b -eq 0) { return "0 B" }
  $u = @("B","KB","MB","GB","TB"); $i = 0; $v = [double]$b
  while ($v -ge 1024 -and $i -lt 4) { $v /= 1024; $i++ }
  return ("{0:N2} {1}" -f $v, $u[$i])
}

function Format-Duration($sec) {
  if ($sec -le 0 -or [double]::IsInfinity($sec) -or [double]::IsNaN($sec)) { return "n/a" }
  $ts = [TimeSpan]::FromSeconds($sec)
  if ($ts.TotalDays -ge 1) { return ("{0}일 {1}시간 {2}분" -f [int]$ts.TotalDays, $ts.Hours, $ts.Minutes) }
  if ($ts.TotalHours -ge 1) { return ("{0}시간 {1}분" -f [int]$ts.TotalHours, $ts.Minutes) }
  return ("{0}분 {1}초" -f [int]$ts.TotalMinutes, $ts.Seconds)
}

# ── 0) 안전 검증 ────────────────────────────────────────────────────────────────
# Test-Path 는 "접근 거부" 일 때도 단순히 False 를 돌려줘 "경로 없음" 으로 오해하게 만든다.
# 클라우디움은 프로세스 화이트리스트가 기본이라 실제로는 차단이 원인인 경우가 많으므로 구분해서 안내한다.
$srcDenied = $false
$srcOk     = $false
try   { $null = Get-ChildItem -LiteralPath $Source -Force -ErrorAction Stop | Select-Object -First 1; $srcOk = $true }
catch [System.UnauthorizedAccessException] { $srcDenied = $true }
catch { }

if ($srcDenied) {
  # throw 를 쓰면 PowerShell 스택 트레이스가 붙어 정작 읽어야 할 안내가 묻힌다.
  Write-Host @"

접근 거부(0x80070005): $Source

탐색기에서는 열리는데 이 스크립트만 막힌다면, 클라우디움이 **프로세스 화이트리스트**로
powershell.exe / robocopy.exe / cmd.exe 를 차단하고 있는 것이다.
이는 오류가 아니라 랜섬웨어 방어 기능이며, 실측으로 확인된 동작이다(README 참고).

대응 순서:
  1) 클라우디움 관리 콘솔 → 보안 정책 → 허용(예외) 프로세스에 robocopy.exe 추가
     ※ 마이그레이션 기간 한정 + 전용 PC 로 제한할 것. 상시 개방은 방어를 무력화한다
  2) 안 되면 벤더(사이버다임/가비아)에 **일괄 반출 도구** 요청 — 계약 해지 통보 전에 확보
  3) 그래도 안 되면 탐색기 수동 복사(폴더 단위 분할). 재개·검증·로그가 없으니 최후 수단

"@ -ForegroundColor Yellow
  exit 1
}
if (-not $srcOk) { throw "Source 를 찾을 수 없다: $Source" }
$srcFull = (Resolve-Path -LiteralPath $Source).Path
$stgQual = (Split-Path -Qualifier $Staging).ToUpper()
$srcQual = (Split-Path -Qualifier $srcFull).ToUpper()

if ($stgQual -eq "T:" -or $stgQual -eq "S:") {
  throw "Staging 이 클라우디움 드라이브($stgQual)다. 로컬 디스크를 지정할 것 — 이 스크립트는 스테이징 폴더를 삭제한다."
}
if ($srcFull.ToLower().StartsWith($Staging.ToLower())) { throw "Source 가 Staging 하위다. 경로를 분리할 것." }
if ($Staging.ToLower().StartsWith($srcFull.ToLower()))  { throw "Staging 이 Source 하위다. 경로를 분리할 것." }
if ($srcQual -ne "T:") { Warn "Source 가 T: 가 아니다($srcQual). 클라우디움 드라이브가 맞는지 확인할 것." }
if ($TestS3Upload -and -not $Bucket) { throw "-TestS3Upload 를 쓰려면 -Bucket 이 필요하다." }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Log "Source  : $srcFull"
Log "Staging : $Staging"
Log "OutDir  : $OutDir"
Log ""

# ── 1) 인벤토리 (디렉터리 열거 속도 포함) ───────────────────────────────────────
Log "[1/4] 인벤토리 수집 중 — 이 단계의 소요 시간 자체가 '탐색기 체감 속도' 지표다"
$swEnum = [System.Diagnostics.Stopwatch]::StartNew()
$enumErrors = 0
$files = @()
try {
  $files = Get-ChildItem -LiteralPath $srcFull -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable ev
  if ($ev) { $enumErrors = $ev.Count }
} catch {
  throw "인벤토리 수집 실패: $($_.Exception.Message)"
}
$swEnum.Stop()

if ($files.Count -eq 0) { throw "Source 에 파일이 없다. 다른 폴더를 고를 것." }

$srcBytes  = ($files | Measure-Object -Property Length -Sum).Sum
$srcCount  = $files.Count
$avgSize   = $srcBytes / $srcCount
$sorted    = $files | Sort-Object Length
$medSize   = $sorted[[int]($srcCount/2)].Length
$maxPath   = ($files | ForEach-Object { $_.FullName.Length } | Measure-Object -Maximum).Maximum
$longPaths = ($files | Where-Object { $_.FullName.Length -ge 260 }).Count
$enumRate  = $srcCount / [Math]::Max($swEnum.Elapsed.TotalSeconds, 0.001)

$buckets = [ordered]@{
  "< 64KB"      = ($files | Where-Object { $_.Length -lt 65536 }).Count
  "64KB ~ 1MB"  = ($files | Where-Object { $_.Length -ge 65536 -and $_.Length -lt 1048576 }).Count
  "1 ~ 10MB"    = ($files | Where-Object { $_.Length -ge 1048576 -and $_.Length -lt 10485760 }).Count
  "10 ~ 100MB"  = ($files | Where-Object { $_.Length -ge 10485760 -and $_.Length -lt 104857600 }).Count
  "> 100MB"     = ($files | Where-Object { $_.Length -ge 104857600 }).Count
}
$extTop = $files | Group-Object Extension | Sort-Object Count -Descending | Select-Object -First 10

Log ""
Log "── 인벤토리 ──────────────────────────────────────────"
Log ("  파일 수        : {0:N0}" -f $srcCount)
Log ("  총 용량        : {0}" -f (Format-Bytes $srcBytes))
Log ("  평균 / 중앙값  : {0} / {1}" -f (Format-Bytes $avgSize), (Format-Bytes $medSize))
Log ("  열거 소요      : {0:N1}초  ({1:N0} files/s)" -f $swEnum.Elapsed.TotalSeconds, $enumRate)
Log ("  최대 경로 길이 : {0}자   (260자 이상: {1:N0}건)" -f $maxPath, $longPaths)
if ($enumErrors -gt 0) { Warn ("열거 실패 {0}건 — 긴 경로·권한 문제일 수 있다" -f $enumErrors) }
Log "  크기 분포:"
foreach ($k in $buckets.Keys) { Log ("    {0,-12} {1,8:N0}건" -f $k, $buckets[$k]) }
Log "  확장자 Top:"
foreach ($e in $extTop) { Log ("    {0,-10} {1,8:N0}건" -f $(if($e.Name){$e.Name}else{"(없음)"}), $e.Count) }
Log ""

# 전체 열거 소요 외삽 (마이그레이션 전 스캔에만 이만큼 든다)
$fullEnumSec = $TOTAL_FILES / [Math]::Max($enumRate, 0.001)
Log ("  → 전체 119만건 열거만 해도 약 {0} 예상" -f (Format-Duration $fullEnumSec))
Log ""

$result = [ordered]@{
  timestamp        = $stamp
  source           = $srcFull
  files            = $srcCount
  bytes            = $srcBytes
  avgBytes         = [int64]$avgSize
  medianBytes      = [int64]$medSize
  enumSeconds      = [Math]::Round($swEnum.Elapsed.TotalSeconds, 2)
  enumFilesPerSec  = [Math]::Round($enumRate, 1)
  enumErrors       = $enumErrors
  maxPathLength    = $maxPath
  pathsOver260     = $longPaths
  sizeBuckets      = $buckets
  rounds           = @()
  attrCopy         = $null
  s3Upload         = $null
}

if ($InventoryOnly) {
  $json = Join-Path $OutDir "pilot-$stamp.json"
  ($result | ConvertTo-Json -Depth 6) | Out-File -FilePath $json -Encoding utf8
  Ok "인벤토리만 수행. 결과: $json"
  Log "복사 측정을 하려면 -InventoryOnly 를 빼고 다시 실행할 것."
  exit 0
}

# ── 스테이징 준비 + 디스크 여유 확인 ────────────────────────────────────────────
$diskId = (Split-Path -Qualifier $Staging)
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$diskId'" -ErrorAction SilentlyContinue
if ($disk -and $disk.FreeSpace -lt ($srcBytes * 1.2)) {
  throw ("$diskId 여유 공간 부족: {0} 남음, {1} 필요(1.2배)" -f (Format-Bytes $disk.FreeSpace), (Format-Bytes ($srcBytes*1.2)))
}
New-Item -ItemType Directory -Path $Staging -Force | Out-Null

function Clear-Staging($path) {
  # 안전: 스테이징 경로 하위만 지운다. 클라우디움 드라이브는 위에서 이미 차단됨.
  if ((Split-Path -Qualifier $path).ToUpper() -in @("T:","S:")) { throw "스테이징 삭제 대상이 클라우디움 드라이브다. 중단." }
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Path $path -Force | Out-Null
}

# ── 2) 속성 복사 가능 여부 ──────────────────────────────────────────────────────
if (-not $SkipAttrTest) {
  Log "[2/4] 속성 복사 테스트 (/COPY:DAT vs /COPY:DT)"
  $attrDst = Join-Path $Staging "_attrtest"
  $copyFlagChosen = "/COPY:DAT"
  Clear-Staging $attrDst
  # 인벤토리에서 가장 작은 파일 1개를 지목해 복사한다(크기 필터를 쓰면 해당 파일이 없을 때 테스트가 무의미해진다).
  $probe = $sorted[0]
  Log ("  프로브 파일: {0} ({1})" -f $probe.Name, (Format-Bytes $probe.Length))
  & robocopy $probe.DirectoryName $attrDst $probe.Name /COPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
  $rcDat = $LASTEXITCODE
  if ($rcDat -ge 8) {
    Warn "/COPY:DAT 실패(rc=$rcDat) — 가상 드라이브가 ACL 복사를 지원하지 않는 것으로 보인다. /COPY:DT 로 재시도"
    Clear-Staging $attrDst
    & robocopy $probe.DirectoryName $attrDst $probe.Name /COPY:DT /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
    $rcDt = $LASTEXITCODE
    if ($rcDt -ge 8) { Warn "/COPY:DT 도 실패(rc=$rcDt). 원본 폴더 상태를 확인할 것." ; $copyFlagChosen = "/COPY:DT" }
    else { Ok "/COPY:DT 성공 → 마이그레이션은 /COPY:DT 로 진행할 것(ACL 은 별도 이관 필요)" ; $copyFlagChosen = "/COPY:DT" }
  } else {
    Ok "/COPY:DAT 성공 → ACL·타임스탬프까지 복사 가능"
  }
  $result.attrCopy = $copyFlagChosen
  Clear-Staging $attrDst
  Remove-Item -LiteralPath $attrDst -Recurse -Force -ErrorAction SilentlyContinue
} else {
  $copyFlagChosen = "/COPY:DAT"
  $result.attrCopy = "skipped"
}
Log ""

# ── 3) 스레드별 복사 처리량 ─────────────────────────────────────────────────────
Log "[3/4] 스레드별 복사 측정 — /MT: $($Threads -join ', ')"
Warn "1회차는 cold, 이후는 클라우디움 클라이언트 캐시로 빨라질 수 있다(상대 비교용으로 볼 것)."
Log ""

$rounds = @()
$i = 0
foreach ($mt in $Threads) {
  $i++
  $dst = Join-Path $Staging "mt$mt"
  Clear-Staging $dst
  $log = Join-Path $OutDir "robocopy-mt$mt-$stamp.log"

  Log ("  라운드 $i/$($Threads.Count): /MT:$mt 복사 중...")
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & robocopy $srcFull $dst /E $copyFlagChosen /R:1 /W:1 /MT:$mt /NFL /NDL /NP "/LOG:$log" | Out-Null
  $rc = $LASTEXITCODE
  $sw.Stop()

  $copied = Get-ChildItem -LiteralPath $dst -Recurse -File -Force -ErrorAction SilentlyContinue
  $cBytes = ($copied | Measure-Object -Property Length -Sum).Sum
  $cCount = $copied.Count
  $sec    = [Math]::Max($sw.Elapsed.TotalSeconds, 0.001)
  $mbps   = ($cBytes / 1MB) / $sec
  $fps    = $cCount / $sec

  $status = if ($rc -ge 8) { "FAIL(rc=$rc)" } else { "OK(rc=$rc)" }
  Log ("    {0}  {1} / {2:N0}건  {3:N1}초  →  {4:N1} MB/s · {5:N0} files/s" -f `
       $status, (Format-Bytes $cBytes), $cCount, $sec, $mbps, $fps)

  if ($cCount -lt $srcCount) {
    Warn ("    복사 누락: 원본 {0:N0}건 중 {1:N0}건만 복사됨 — 로그 확인: $log" -f $srcCount, $cCount)
  }

  $rounds += [ordered]@{
    threads=$mt; rc=$rc; seconds=[Math]::Round($sec,2); bytes=$cBytes; files=$cCount
    mbPerSec=[Math]::Round($mbps,2); filesPerSec=[Math]::Round($fps,1); cold=($i -eq 1); log=$log
  }
  Clear-Staging $dst
}
$result.rounds = $rounds
Log ""

# ── 4) (옵션) S3 업로드 처리량 ──────────────────────────────────────────────────
if ($TestS3Upload) {
  Log "[4/4] S3 업로드 처리량 측정"
  $upSrc = Join-Path $Staging "upload"
  Clear-Staging $upSrc
  & robocopy $srcFull $upSrc /E $copyFlagChosen /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP | Out-Null
  $upFiles = Get-ChildItem -LiteralPath $upSrc -Recurse -File -Force -ErrorAction SilentlyContinue
  $upBytes = ($upFiles | Measure-Object -Property Length -Sum).Sum

  $prefix = "_pilot/$stamp/"
  $env:AWS_PROFILE = $AwsProfile
  $sw3 = [System.Diagnostics.Stopwatch]::StartNew()
  & aws s3 sync $upSrc "s3://$Bucket/$prefix" --no-progress --only-show-errors | Out-Null
  $rc3 = $LASTEXITCODE
  $sw3.Stop()
  $upSec  = [Math]::Max($sw3.Elapsed.TotalSeconds, 0.001)
  $upMbps = ($upBytes / 1MB) / $upSec

  if ($rc3 -ne 0) { Warn "s3 sync 실패(exit=$rc3)" }
  Log ("  업로드 {0} / {1:N0}건  {2:N1}초  →  {3:N1} MB/s" -f (Format-Bytes $upBytes), $upFiles.Count, $upSec, $upMbps)
  Warn "업로드한 파일은 Object Lock 기본 보존 90일이 적용된다. 아래 명령으로 정리할 것:"
  Log  "    aws s3api list-object-versions --bucket $Bucket --prefix `"$prefix`" --profile $AwsProfile"
  Log  "    → kesi-docs-purge 롤로 assume 후 --bypass-governance-retention 으로 버전 삭제"

  $result.s3Upload = [ordered]@{ prefix=$prefix; bytes=$upBytes; files=$upFiles.Count
                                 seconds=[Math]::Round($upSec,2); mbPerSec=[Math]::Round($upMbps,2); rc=$rc3 }
  Clear-Staging $upSrc
  Log ""
}

# ── 리포트 · 외삽 ───────────────────────────────────────────────────────────────
$ok = $rounds | Where-Object { $_.rc -lt 8 -and $_.files -gt 0 }
if (-not $ok) { throw "성공한 복사 라운드가 없다. robocopy 로그를 확인할 것: $OutDir" }
$best = $ok | Sort-Object mbPerSec -Descending | Select-Object -First 1

# 전체 소요는 '대역폭 병목'과 '파일 처리율 병목' 중 큰 쪽이 결정한다.
$byBytes = $TOTAL_BYTES / ($best.mbPerSec * 1MB)
$byFiles = $TOTAL_FILES / $best.filesPerSec
$bottleneck = if ($byFiles -gt $byBytes) { "파일 개수(작은 파일 오버헤드)" } else { "대역폭(용량)" }
$estRead = [Math]::Max($byBytes, $byFiles)

Log "══ 결과 요약 ═══════════════════════════════════════════"
Log ""
Log ("  최적 스레드    : /MT:{0}  ({1:N1} MB/s · {2:N0} files/s)" -f $best.threads, $best.mbPerSec, $best.filesPerSec)
Log ("  속성 복사      : {0}" -f $result.attrCopy)
Log ""
Log "  스레드별 비교:"
foreach ($r in $rounds) {
  $tag = if ($r.cold) { " (cold)" } else { "" }
  Log ("    /MT:{0,-3} {1,7:N1} MB/s {2,8:N0} files/s{3}" -f $r.threads, $r.mbPerSec, $r.filesPerSec, $tag)
}
Log ""
Log "  전체 4,872GB / 1,193,509건 외삽:"
Log ("    용량 기준      : {0}" -f (Format-Duration $byBytes))
Log ("    파일 수 기준   : {0}" -f (Format-Duration $byFiles))
Log ("    → T: 읽기 예상 : {0}   (병목 = {1})" -f (Format-Duration $estRead), $bottleneck)
if ($result.s3Upload) {
  $s3Sec = $TOTAL_BYTES / ($result.s3Upload.mbPerSec * 1MB)
  Log ("    → S3 업로드    : {0}" -f (Format-Duration $s3Sec))
  Log ("    → 2단계 합계   : {0} (순차) / {1} (파이프라인 시 대략)" -f `
       (Format-Duration ($estRead + $s3Sec)), (Format-Duration ([Math]::Max($estRead, $s3Sec))))
}
Log ""

# 판단 근거를 문장으로
if ($longPaths -gt 0) { Warn ("260자 이상 경로 {0:N0}건 — 마이그레이션 스크립트에 긴 경로 처리 필요" -f $longPaths) }
if ($bottleneck -like "파일*") {
  Warn "병목이 파일 개수다 → 회선을 늘려도 빨라지지 않는다. /MT 상향과 야간 배치 분할이 유효하다."
} else {
  Ok "병목이 용량이다 → 회선 대역폭이 일정을 좌우한다. /MT 는 최적값 이상 올릴 필요 없다."
}
$mt1 = $rounds | Where-Object { $_.threads -eq 1 } | Select-Object -First 1
if ($mt1 -and $best.threads -gt 1) {
  $gain = $best.mbPerSec / [Math]::Max($mt1.mbPerSec, 0.01)
  Log ("  /MT:1 대비 {0:N1}배 향상 — 병렬화 효과 {1}" -f $gain, $(if ($gain -lt 1.5) { "낮음(서버측 제한 의심)" } else { "있음" }))
}
Log ""

$json = Join-Path $OutDir "pilot-$stamp.json"
($result | ConvertTo-Json -Depth 6) | Out-File -FilePath $json -Encoding utf8
$csv = Join-Path $OutDir "pilot-rounds-$stamp.csv"
$rounds | ForEach-Object { [pscustomobject]$_ } | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
Ok "결과 저장: $json"
Ok "라운드 CSV: $csv"
Log ""
Log "다음 단계: 이 수치로 05 마이그레이션 스크립트의 /MT·배치 분할·야간 창을 정한다."

# 조회 헬퍼/robocopy 가 남긴 exit code 가 스크립트 반환값으로 새지 않게 한다.
exit 0
