#Requires -Version 5.1
<#
.SYNOPSIS
  탐색기로 복사해 온 로컬 스테이징 폴더를 검증한다(누락·0바이트·S3 키 제약).

.DESCRIPTION
  클라우디움 T: 는 디렉터리 열거가 차단돼 robocopy 자동 반출이 불가능하다(README 참고).
  그래서 반출은 **탐색기 수동 복사**로 하고, 그 이후 단계를 이 스크립트부터 자동화한다.
  대상이 로컬 디스크라 클라우디움 제약과 무관하게 동작한다.

  검사 항목:
   1) 파일 수·총 용량 (원본 실측치와 대조)
   2) **0바이트 파일** — 탐색기 복사가 중간에 끊기면 남는 흔적
   3) **S3 키 길이** — 키는 UTF-8 기준 1024바이트 제한. 한글은 글자당 3바이트라
      한글 경로가 깊으면 340자 근처에서 걸린다
   4) S3 에서 다루기 까다로운 문자 포함 파일
   5) 빈 폴더 — `aws s3 sync` 는 빈 폴더를 올리지 않는다(S3 에 폴더 개념이 없음).
      File Gateway 로 보면 사라지므로, 보존이 필요하면 06 의 -KeepEmptyFolders 를 쓸 것

.EXAMPLE
  .\infra\aws\cloudium\05-verify-staging.ps1 -Staging "D:\staging\통합환경1본부"

.EXAMPLE
  # 원본 전체 수치와 대조 (전량 복사를 끝낸 뒤)
  .\infra\aws\cloudium\05-verify-staging.ps1 -Staging "D:\staging" -ExpectedFiles 1193509 -ExpectedBytes 5230692544851
#>
param(
  [Parameter(Mandatory=$true)][string]$Staging,
  [int64] $ExpectedFiles = 0,
  [int64] $ExpectedBytes = 0,
  [string]$OutDir        = "$env:TEMP\cloudium-verify",
  [int]   $MaxKeyBytes   = 1024,
  [switch]$ListProblems
)
$ErrorActionPreference = "Stop"

function Log($m)  { Write-Host "[verify] $m" }
function Warn($m) { Write-Host "[verify] ⚠ $m" -ForegroundColor Yellow }
function Ok($m)   { Write-Host "[verify] ✓ $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "[verify] ✗ $m" -ForegroundColor Red }

function Format-Bytes($b) {
  if ($null -eq $b -or $b -eq 0) { return "0 B" }
  $u = @("B","KB","MB","GB","TB"); $i = 0; $v = [double]$b
  while ($v -ge 1024 -and $i -lt 4) { $v /= 1024; $i++ }
  return ("{0:N2} {1}" -f $v, $u[$i])
}

if (-not (Test-Path -LiteralPath $Staging)) { throw "Staging 경로가 없다: $Staging" }
$root = (Resolve-Path -LiteralPath $Staging).Path
$rootLen = $root.TrimEnd('\').Length + 1
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Log "대상: $root"
Log "수집 중..."

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable ev)
$dirs  = @(Get-ChildItem -LiteralPath $root -Recurse -Directory -Force -ErrorAction SilentlyContinue)
$sw.Stop()

if ($files.Count -eq 0) { throw "파일이 없다. 복사가 실제로 되었는지 확인할 것." }

$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
$zeroByte   = @($files | Where-Object { $_.Length -eq 0 })

# 0바이트라고 다 복사 실패가 아니다. 실측 결과 대부분이 원본에서도 0바이트였다:
#  · 프로그램 부산물(.tmp/.log/.err/.dwl2/.fileTableLock …)
#  · **파일명 자체가 메모인 빈 파일** — 예: "★ 제작도면, 탱크시험성적서 ….txt"
#    (폴더에 안내를 남기려고 만든 것이라 내용이 없는 게 정상)
# 그래서 부산물 확장자는 분리하고, 문서형만 표본 확인 대상으로 올린다.
$benignZeroExt = @('.tmp','.log','.err','.dat','.out','.lock','.dwl','.dwl2',
                   '.filetablelock','.ldb','.bak','.crdownload','.part')
$zeroBenign = @($zeroByte | Where-Object { $benignZeroExt -contains $_.Extension.ToLower() })
$zeroDocs   = @($zeroByte | Where-Object { $benignZeroExt -notcontains $_.Extension.ToLower() })
$emptyDirs  = @($dirs  | Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) })

# S3 키 = 스테이징 루트 기준 상대경로, 구분자는 '/'
$utf8 = [System.Text.Encoding]::UTF8
$longKeys = New-Object System.Collections.ArrayList
$oddChars = New-Object System.Collections.ArrayList
# S3 에 올릴 수는 있으나 URL·도구 호환에서 문제를 일으키기 쉬운 문자들
$oddPattern = '[\{\}\^%`\[\]"<>~#\|]'

foreach ($f in $files) {
  $key = $f.FullName.Substring($rootLen).Replace('\','/')
  $bytes = $utf8.GetByteCount($key)
  if ($bytes -gt $MaxKeyBytes) { [void]$longKeys.Add([pscustomobject]@{ Bytes=$bytes; Key=$key }) }
  if ($key -match $oddPattern) { [void]$oddChars.Add($key) }
}

Log ""
Log "── 결과 ──────────────────────────────────────────────"
Log ("  파일 수     : {0:N0}" -f $files.Count)
Log ("  총 용량     : {0}  ({1:N0} bytes)" -f (Format-Bytes $totalBytes), $totalBytes)
Log ("  폴더 수     : {0:N0}  (빈 폴더 {1:N0})" -f $dirs.Count, $emptyDirs.Count)
Log ("  수집 소요   : {0:N1}초" -f $sw.Elapsed.TotalSeconds)
if ($ev) { Warn ("열거 실패 {0}건 — 권한·긴 경로 확인 필요" -f $ev.Count) }
Log ""

$problems = 0

if ($zeroByte.Count -eq 0) {
  Ok "0바이트 파일 없음"
} else {
  Log ("0바이트 파일 {0:N0}건" -f $zeroByte.Count)
  if ($zeroBenign.Count -gt 0) {
    Ok ("  · 프로그램 부산물 {0:N0}건 (.tmp/.log/.err 등) — 원본도 0바이트다. 정상" -f $zeroBenign.Count)
  }
  if ($zeroDocs.Count -gt 0) {
    Warn ("  · 문서형 {0:N0}건 — 표본 확인 권장" -f $zeroDocs.Count)
    Log  "     원본이 이미 0바이트인 경우가 많다(파일명이 메모인 빈 파일 등). 확인 방법:"
    Log  "       robocopy `"<T: 원본폴더>`" `"$env:TEMP\chk`" `"<파일명>`" /L /R:0 /W:0 /NJH /NJS /NC /BYTES"
    Log  "     원본도 0이면 정상이고, 원본에 크기가 있으면 그 폴더만 재복사할 것."
    $ext = $zeroDocs | Group-Object Extension | Sort-Object Count -Descending | Select-Object -First 6
    Log  ("     확장자: " + (($ext | ForEach-Object { "{0}({1})" -f $(if($_.Name){$_.Name}else{"없음"}), $_.Count }) -join ", "))
    if ($ListProblems) { $zeroDocs | Select-Object -First 20 | ForEach-Object { Log ("       " + $_.FullName) } }
  }
}

if ($longKeys.Count -gt 0) {
  Bad ("S3 키 {0}바이트 초과 {1:N0}건 — 업로드가 거부된다. 폴더명 단축 필요" -f $MaxKeyBytes, $longKeys.Count)
  $problems++
  if ($ListProblems) { $longKeys | Sort-Object Bytes -Descending | Select-Object -First 10 | ForEach-Object { Log ("    [{0}B] {1}" -f $_.Bytes, $_.Key) } }
} else { Ok ("S3 키 길이 모두 정상 (최대 {0}바이트 제한)" -f $MaxKeyBytes) }

if ($oddChars.Count -gt 0) {
  Warn ("특수문자 포함 {0:N0}건 — 업로드는 되지만 URL·도구에서 다루기 번거롭다" -f $oddChars.Count)
  if ($ListProblems) { $oddChars | Select-Object -First 10 | ForEach-Object { Log ("    " + $_) } }
} else { Ok "문제될 특수문자 없음" }

if ($emptyDirs.Count -gt 0) {
  Warn ("빈 폴더 {0:N0}개 — `aws s3 sync` 는 이를 올리지 않아 File Gateway 에서 사라진다" -f $emptyDirs.Count)
  Log  "         보존하려면 06-upload-s3.ps1 -KeepEmptyFolders 를 쓸 것"
}

# 원본 대조
if ($ExpectedFiles -gt 0 -or $ExpectedBytes -gt 0) {
  Log ""
  Log "── 원본 대조 ─────────────────────────────────────────"
  if ($ExpectedFiles -gt 0) {
    $diff = $files.Count - $ExpectedFiles
    $pct  = [Math]::Round(($files.Count / $ExpectedFiles) * 100, 2)
    if ($diff -eq 0) { Ok ("파일 수 일치 ({0:N0})" -f $files.Count) }
    elseif ($diff -lt 0) { Bad ("파일 {0:N0}건 부족 (원본 {1:N0} / 현재 {2:N0}, {3}%)" -f [Math]::Abs($diff), $ExpectedFiles, $files.Count, $pct); $problems++ }
    else { Warn ("파일 {0:N0}건 초과 (원본 {1:N0} / 현재 {2:N0}) — 개정 이력이나 중복 복사 가능성" -f $diff, $ExpectedFiles, $files.Count) }
  }
  if ($ExpectedBytes -gt 0) {
    $db = $totalBytes - $ExpectedBytes
    if ($db -eq 0) { Ok "용량 일치" }
    elseif ($db -lt 0) { Bad ("용량 {0} 부족 (원본 {1})" -f (Format-Bytes ([Math]::Abs($db))), (Format-Bytes $ExpectedBytes)); $problems++ }
    else { Warn ("용량 {0} 초과" -f (Format-Bytes $db)) }
  }
}

Log ""
if ($problems -eq 0) { Ok "검증 통과 — 06-upload-s3.ps1 로 업로드 진행 가능" }
else { Bad "$problems 개 항목에서 문제 발견 — 해결 후 재검증할 것 (-ListProblems 로 상세 확인)" }

$result = [ordered]@{
  timestamp=$stamp; staging=$root; files=$files.Count; bytes=$totalBytes
  dirs=$dirs.Count; emptyDirs=$emptyDirs.Count
  zeroByte=$zeroByte.Count; zeroBenign=$zeroBenign.Count; zeroDocs=$zeroDocs.Count
  longKeys=$longKeys.Count; oddChars=$oddChars.Count; enumErrors=$(if($ev){$ev.Count}else{0})
  expectedFiles=$ExpectedFiles; expectedBytes=$ExpectedBytes; problems=$problems
}
$json = Join-Path $OutDir "verify-$stamp.json"
($result | ConvertTo-Json -Depth 4) | Out-File -FilePath $json -Encoding utf8
Log "결과 저장: $json"

exit 0
