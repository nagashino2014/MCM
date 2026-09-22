#Requires -Version 5.1
<#
.SYNOPSIS
  MCM 스테이징 Aurora 에 멱등 SQL 마이그레이션(infra/aws/NNN_*.sql)을 적용한다.

.DESCRIPTION
  bastion SSM 포트포워딩 터널(localhost:15432)을 통해 psql 로 적용한다.
  - 터널이 이미 열려 있으면 그대로 쓰고, 없으면 bastion 기동(stopped 면 start)부터
    터널 백그라운드 기동까지 자동으로 수행한 뒤, 끝나면 자동 기동분만 정리한다.
  - 접속 정보는 RDS 매니지드 마스터 시크릿(Secrets Manager)에서 받는다
    (dev-frontend-aws.ps1 과 동일 경로 — 파일에 저장하지 않는다).
  - 마이그레이션은 전부 멱등이라 재실행에 안전하다. 실패 시 해당 파일에서 중단(ON_ERROR_STOP).
  - Aurora 는 min 0 ACU auto-pause — 첫 쿼리가 수십 초 걸릴 수 있다(오류 아님).

.EXAMPLE
  .\infra\aws\ops\staging-apply-migrations.ps1                          # 기본: 200~204(근태 이벤트·식대)
  .\infra\aws\ops\staging-apply-migrations.ps1 -Files 205_foo.sql       # 특정 파일만
  .\infra\aws\ops\staging-apply-migrations.ps1 -KeepTunnel              # 적용 후 터널 유지(이어서 dev 등)
#>
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region     = "ap-northeast-2",
  [string]$ClusterId  = "mcm-ieps-staging",
  [int]$LocalPort     = 15432,
  # infra/aws/ 기준 파일명. 기본값 = 근태 이벤트 자동수집·식대 검증(2026-08-27) 5종.
  [string[]]$Files = @(
    "200_adt_event_log.sql",
    "201_attendance_offday_break.sql",
    "202_overtime_form_single_day.sql",
    "203_overtime_meal_check.sql",
    "204_meal_warning_action.sql"
  ),
  [switch]$KeepTunnel,
  # 회계 정의 SQL은 기존 앱 트랜잭션이 모두 끝난 상태에서만 적용한다.
  [switch]$AccountingMaintenance,
  # 이전 유지보수가 강제 종료되어 SSM 상태 표식이 남았을 때 SQL을 실행하지 않고 원상복구만 한다.
  [switch]$RecoverAccountingMaintenance,
  [string]$EcsCluster = "mcm-ieps-staging",
  [string]$EcsService = "mcm-ieps-staging-next",
  [string]$ScheduleGroup = "mcm-ieps-staging-ops",
  [string[]]$AccountingScheduleNames = @("next-start-daily", "next-stop-weekday", "next-stop-weekend"),
  [string]$MaintenanceStateParameter = "/mcm-ieps-staging/ops/accounting-migration-state"
)
# aws cli 는 정상 흐름에서도 stderr 를 내므로 Stop 을 쓰지 않고 $LASTEXITCODE 로 판정한다
# (PS 5.1 NativeCommandError 함정 — 다른 ops 스크립트와 동일한 방식).
$ErrorActionPreference = "Continue"
$env:AWS_PROFILE = $AwsProfile

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$sqlDir   = Join-Path $repoRoot "infra\aws"

function Log($m)  { Write-Host "[migrate] $m" }
function Fail($m) { Write-Host "[migrate] 실패: $m" -ForegroundColor Red; exit 1 }

function Test-LoneCarriageReturn([byte[]]$bytes) {
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 13 -and ($i + 1 -ge $bytes.Length -or $bytes[$i + 1] -ne 10)) { return $true }
  }
  return $false
}

function New-ScheduleUpdate($schedule, [string]$state) {
  $update = [ordered]@{
    Name = $schedule.Name; GroupName = $ScheduleGroup; State = $state
    ScheduleExpression = $schedule.ScheduleExpression
    FlexibleTimeWindow = $schedule.FlexibleTimeWindow; Target = $schedule.Target
  }
  if ($schedule.ScheduleExpressionTimezone) { $update.ScheduleExpressionTimezone = $schedule.ScheduleExpressionTimezone }
  if ($schedule.Description) { $update.Description = $schedule.Description }
  if ($schedule.StartDate) { $update.StartDate = $schedule.StartDate }
  if ($schedule.EndDate) { $update.EndDate = $schedule.EndDate }
  if ($schedule.KmsKeyArn) { $update.KmsKeyArn = $schedule.KmsKeyArn }
  if ($schedule.ActionAfterCompletion) { $update.ActionAfterCompletion = $schedule.ActionAfterCompletion }
  return $update
}

function Set-ScheduleState($schedule, [string]$state, [string]$label) {
  $updatePath = Join-Path $env:TEMP "mcm-migration-schedule-$PID-$label-$($schedule.Name).json"
  $script:temporaryFiles.Add($updatePath)
  [System.IO.File]::WriteAllText($updatePath, ((New-ScheduleUpdate $schedule $state) | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
  aws scheduler update-schedule --cli-input-json "file://$updatePath" --region $Region --no-cli-pager | Out-Null
  return $LASTEXITCODE -eq 0
}

function Get-SqlIdentifierBase([string]$identifier) {
  $parts = $identifier -split '\s*\.\s*'
  return ([string]$parts[-1]).Trim('"').ToLowerInvariant()
}

function Get-CanonicalSqlSha256([string]$text) {
  $canonical = $text.Replace("`r`n", "`n").Replace("`r", "`n")
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($canonical)
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { return (([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()) }
  finally { $hash.Dispose() }
}

function Get-SqlDefinitionScanText([string]$text) {
  # 주석·문자열을 공백으로 바꾸되 따옴표 식별자, 문장 구조와 procedural body의 정적 SQL은 보존한다.
  # dollar quote 구분자만 지우고 본문은 다시 토큰화하므로 DO/함수 안의 직접 DDL도 검사한다.
  $builder = New-Object System.Text.StringBuilder
  $dollarTag = [regex]::new('\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$')
  $i = 0
  while ($i -lt $text.Length) {
    # 큰따옴표 식별자는 PostgreSQL 토큰 그대로 보존한다. 내부의 작은따옴표·주석 기호·$는
    # 문자열/주석/dollar quote 시작이 아니며, ""만 식별자 내부 이스케이프다.
    if ($text[$i] -eq '"') {
      [void]$builder.Append($text[$i]); $i++
      while ($i -lt $text.Length) {
        [void]$builder.Append($text[$i])
        if ($text[$i] -eq '"' -and $i + 1 -lt $text.Length -and $text[$i + 1] -eq '"') {
          [void]$builder.Append($text[$i + 1]); $i += 2; continue
        }
        if ($text[$i] -eq '"') { $i++; break }
        $i++
      }
      continue
    }
    if ($i + 1 -lt $text.Length -and $text[$i] -eq '-' -and $text[$i + 1] -eq '-') {
      while ($i -lt $text.Length -and $text[$i] -ne "`n") { [void]$builder.Append(' '); $i++ }
      continue
    }
    if ($i + 1 -lt $text.Length -and $text[$i] -eq '/' -and $text[$i + 1] -eq '*') {
      $depth = 1; [void]$builder.Append(' '); [void]$builder.Append(' '); $i += 2
      while ($i -lt $text.Length -and $depth -gt 0) {
        if ($i + 1 -lt $text.Length -and $text[$i] -eq '/' -and $text[$i + 1] -eq '*') { $depth++; [void]$builder.Append(' '); [void]$builder.Append(' '); $i += 2; continue }
        if ($i + 1 -lt $text.Length -and $text[$i] -eq '*' -and $text[$i + 1] -eq '/') { $depth--; [void]$builder.Append(' '); [void]$builder.Append(' '); $i += 2; continue }
        [void]$builder.Append($(if ($text[$i] -eq "`n") { "`n" } else { ' ' })); $i++
      }
      continue
    }
    if ($text[$i] -eq "'") {
      $escapeString = $i -gt 0 -and ($text[$i - 1] -eq 'E' -or $text[$i - 1] -eq 'e') -and
        ($i -lt 2 -or -not [char]::IsLetterOrDigit($text[$i - 2]) -and $text[$i - 2] -ne '_' -and $text[$i - 2] -ne '$')
      $literal = New-Object System.Text.StringBuilder
      $literalSimple = $true
      # 문자열 내용은 지우되 구분자는 남긴다. DO/CREATE FUNCTION의 작은따옴표
      # 본문 형식을 별도로 판정할 때만 쓴다. 설정명 네 가지는 set_config의
      # 첫 인수를 정확히 판별할 수 있도록 값만 보존한다.
      $quoteStart = $builder.Length
      [void]$builder.Append("'"); $i++
      while ($i -lt $text.Length) {
        if ($escapeString -and $text[$i] -eq '\' -and $i + 1 -lt $text.Length) {
          $literalSimple = $false
          [void]$builder.Append(' ')
          [void]$builder.Append($(if ($text[$i + 1] -eq "`n") { "`n" } else { ' ' }))
          $i += 2; continue
        }
        if ($text[$i] -eq "'" -and $i + 1 -lt $text.Length -and $text[$i + 1] -eq "'") { [void]$literal.Append("'"); [void]$builder.Append(' '); [void]$builder.Append(' '); $i += 2; continue }
        if ($text[$i] -eq "'") {
          $sensitiveSettings = @('session_replication_role','client_encoding','standard_conforming_strings','backslash_quote')
          $literalValue = $literal.ToString().ToLowerInvariant()
          if ($literalSimple -and $sensitiveSettings -contains $literalValue) {
            [void]$builder.Remove($quoteStart, $builder.Length - $quoteStart)
            [void]$builder.Append("'$literalValue'")
          } else { [void]$builder.Append("'") }
          $i++; break
        }
        [void]$literal.Append($text[$i])
        [void]$builder.Append($(if ($text[$i] -eq "`n") { "`n" } else { ' ' })); $i++
      }
      continue
    }
    if ($text[$i] -eq '$') {
      $tagMatch = $dollarTag.Match($text, $i)
      $previousIsIdentifier = $i -gt 0 -and ([char]::IsLetterOrDigit($text[$i - 1]) -or $text[$i - 1] -eq '_' -or $text[$i - 1] -eq '$')
      if (-not $previousIsIdentifier -and $tagMatch.Success -and $tagMatch.Index -eq $i) {
        $tag = $tagMatch.Value
        for ($j = 0; $j -lt $tag.Length; $j++) { [void]$builder.Append(' ') }
        $i += $tag.Length
        continue
      }
    }
    [void]$builder.Append($text[$i]); $i++
  }
  return $builder.ToString()
}

function Test-PsqlMetaSyntax([string]$text) {
  # psql meta command는 줄 시작뿐 아니라 SQL 토큰 바로 뒤의 역슬래시에서도 실행된다.
  # 반면 SQL 문자열·따옴표 식별자·주석·dollar body 안의 역슬래시와 변수 표기는
  # 클라이언트 명령이 아니므로 전용 lexer에서 건너뛴다.
  $dollarTag = [regex]::new('\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$')
  $i = 0
  $bracketDepth = 0
  while ($i -lt $text.Length) {
    if ($i + 1 -lt $text.Length -and $text[$i] -eq '-' -and $text[$i + 1] -eq '-') {
      $i += 2; while ($i -lt $text.Length -and $text[$i] -ne "`n") { $i++ }; continue
    }
    if ($i + 1 -lt $text.Length -and $text[$i] -eq '/' -and $text[$i + 1] -eq '*') {
      $depth = 1; $i += 2
      while ($i -lt $text.Length -and $depth -gt 0) {
        if ($i + 1 -lt $text.Length -and $text[$i] -eq '/' -and $text[$i + 1] -eq '*') { $depth++; $i += 2; continue }
        if ($i + 1 -lt $text.Length -and $text[$i] -eq '*' -and $text[$i + 1] -eq '/') { $depth--; $i += 2; continue }
        $i++
      }
      continue
    }
    if ($text[$i] -eq '$') {
      $tagMatch = $dollarTag.Match($text, $i)
      $previousIsIdentifier = $i -gt 0 -and ([char]::IsLetterOrDigit($text[$i - 1]) -or $text[$i - 1] -eq '_' -or $text[$i - 1] -eq '$')
      if (-not $previousIsIdentifier -and $tagMatch.Success -and $tagMatch.Index -eq $i) {
        $tag = $tagMatch.Value
        $end = $text.IndexOf($tag, $i + $tag.Length, [System.StringComparison]::Ordinal)
        if ($end -lt 0) { return $true }
        $i = $end + $tag.Length; continue
      }
    }
    if ($text[$i] -eq "'" -or $text[$i] -eq '"') {
      $quote = $text[$i]
      $escapeString = $quote -eq "'" -and $i -gt 0 -and ($text[$i - 1] -eq 'E' -or $text[$i - 1] -eq 'e') -and
        ($i -lt 2 -or -not [char]::IsLetterOrDigit($text[$i - 2]) -and $text[$i - 2] -ne '_' -and $text[$i - 2] -ne '$')
      $i++
      while ($i -lt $text.Length) {
        if ($escapeString -and $text[$i] -eq '\' -and $i + 1 -lt $text.Length) { $i += 2; continue }
        if ($text[$i] -eq $quote -and $i + 1 -lt $text.Length -and $text[$i + 1] -eq $quote) { $i += 2; continue }
        if ($text[$i] -eq $quote) { $i++; break }
        $i++
      }
      continue
    }
    if ($text[$i] -eq '\' -and $i + 1 -lt $text.Length -and ($text[$i + 1] -eq '!' -or [char]::IsLetter($text[$i + 1]))) { return $true }
    if ($text[$i] -eq '[') { $bracketDepth++; $i++; continue }
    if ($text[$i] -eq ']') { if ($bracketDepth -gt 0) { $bracketDepth-- }; $i++; continue }
    if ($text[$i] -eq ':' -and $bracketDepth -eq 0) {
      if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq ':') { $i += 2; continue }
      if ($i + 1 -lt $text.Length -and ($text[$i + 1] -eq "'" -or $text[$i + 1] -eq '"' -or $text[$i + 1] -eq '_' -or [char]::IsLetter($text[$i + 1]))) { return $true }
    }
    $i++
  }
  return $false
}

function Test-QuotedProcedureBodySyntax([string]$scanText) {
  # PostgreSQL은 DO와 CREATE FUNCTION/PROCEDURE 본문에 dollar quote 외에도
  # 일반·E·U& 문자열 상수를 허용한다. 경량 판정기가 내용을 안전하게 복원하지 않으므로
  # 선택한 미등록 SQL에서는 이 드문 형식을 등록·리뷰 대상으로 보낸다.
  if ($scanText -match "(?is)\bDO\s+(?:LANGUAGE\s+[A-Za-z_][A-Za-z0-9_$]*\s+)?(?:(?:E|U&)\s*)?'") { return $true }
  if ($scanText -match "(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b[^;]*\bAS\s+(?:(?:E|U&)\s*)?'") { return $true }
  return $false
}

function Test-DangerousSetConfigSyntax([string]$text) {
  # 일반 문자열·주석 안의 문구는 Get-SqlDefinitionScanText에서 사라지고, 실제
  # dollar body의 호출 구조와 작은따옴표 구분자는 남는다.
  $scanText = Get-SqlDefinitionScanText $text
  $calls = @([regex]::Matches($scanText, '(?is)\bset_config\s*\('))
  if ($calls.Count -eq 0) { return $false }
  if ($scanText -match "(?is)\bset_config\s*\(\s*(?:E\s*)?'(?:session_replication_role|client_encoding|standard_conforming_strings|backslash_quote)'\s*,") { return $true }
  # 첫 인수가 단순 문자열 리터럴인 일반 설정만 허용한다. 스캔 결과의 문자열
  # 내용은 비어 있으므로 '' 뒤에 바로 쉼표가 오는 구조를 확인한다.
  $literalCalls = @([regex]::Matches($scanText, "(?is)\bset_config\s*\(\s*(?:E)?'\s*'\s*,"))
  if ($literalCalls.Count -ne $calls.Count) { return $true }
  return $false
}

function Test-DangerousSessionSettingSyntax([string]$text) {
  $scanText = Get-SqlDefinitionScanText $text
  $setting = '(?:session_replication_role|client_encoding|standard_conforming_strings|backslash_quote)'
  if ($scanText -match ('(?is)\bSET\s+(?:(?:LOCAL|SESSION)\s+)?NAMES\b|\bSET\s+(?:(?:LOCAL|SESSION)\s+)?' + $setting + '\b')) { return $true }
  if ($scanText -match ('(?is)\bRESET\s+' + $setting + '\b|\bALTER\s+(?:ROLE|DATABASE)\b[^;]*\b(?:SET|RESET)\s+' + $setting + '\b')) { return $true }
  return Test-DangerousSetConfigSyntax $text
}

function Test-ProtectedIdentifierMention([string]$text, [string[]]$exactNames, [string[]]$prefixes) {
  $identifierMention = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?'
  foreach ($match in [regex]::Matches($text, $identifierMention)) {
    foreach ($part in ($match.Value -split '\s*\.\s*')) {
      $name = ([string]$part).Trim('"').ToLowerInvariant()
      if ($exactNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
    }
  }
  return $false
}

function Test-ProtectedDefinitionMutation([string]$text, [string[]]$functionNames, [string[]]$prefixes, [string[]]$relationNames, [string[]]$indexNames, [bool]$strictSelectedFile = $false) {
  $allProtectedNames = @($functionNames) + @($relationNames) + @($indexNames)
  $rawMentionsExact = Test-ProtectedIdentifierMention $text $allProtectedNames @()
  $rawMentionsProtected = Test-ProtectedIdentifierMention $text $allProtectedNames $prefixes
  $scanText = Get-SqlDefinitionScanText $text
  if ($strictSelectedFile -and ($scanText -match '(?is)\bU&"' -or (Test-DangerousSessionSettingSyntax $text))) { return $true }
  $destructiveCascadePattern = '(?is)\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|ROUTINE|INDEX|TYPE|SEQUENCE|SCHEMA)\b[^;]*\bCASCADE\b|\bALTER\s+TABLE\b[^;]*\bDROP\s+(?:(?:COLUMN|CONSTRAINT)\s+)?(?:IF\s+EXISTS\s+)?(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)[^,;]*\bCASCADE\b|\bTRUNCATE\b[^;]*\bCASCADE\b'
  if ($strictSelectedFile -and $text -match '(?is)\bEXECUTE\b' -and $text -match $destructiveCascadePattern) { return $true }
  # 동적 SQL의 문자열/본문은 정적 파서로 완전 복원할 수 없다. 보호 이름을 함께 포함한
  # EXECUTE 또는 정확한 보호 이름을 포함한 format 기반 미등록 SQL은 등록 검토로 보낸다.
  # 접두사와 format()이 서로 다른 무관 문장에 있다는 이유만으로 막지는 않는다.
  if (($rawMentionsExact -and $text -match '(?is)\bEXECUTE\b|\bformat\s*\(') -or
      ($rawMentionsProtected -and $text -match '(?is)\bEXECUTE\b')) { return $true }
  if ($strictSelectedFile -and ((Test-PsqlMetaSyntax $text) -or (Test-QuotedProcedureBodySyntax $scanText))) { return $true }
  # 정적으로 의존성을 계산할 수 없는 CASCADE/스키마·소유권 삭제와 파서 우회 토큰은
  # 보호 이름 언급 여부와 무관하게 등록·리뷰가 필요하다.
  if ($strictSelectedFile -and ($scanText -match $destructiveCascadePattern -or $scanText -match '(?is)\bDROP\s+SCHEMA\b|\bDROP\s+OWNED\b|\bU&"')) { return $true }
  $hasGlobalBypass = (Test-DangerousSessionSettingSyntax $text) -or $scanText -match '(?is)\bEVENT\s+TRIGGER\b|\bON\s+ALL\s+(?:TABLES|FUNCTIONS|PROCEDURES|ROUTINES|SEQUENCES)\s+IN\s+SCHEMA\b'
  if (-not $hasGlobalBypass -and -not $rawMentionsProtected) { return $false }
  $text = $scanText
  $identifier = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?'
  $functionPattern = '(?is)\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|ALTER\s+|DROP\s+)(?:FUNCTION|PROCEDURE|ROUTINE)\s+(?:IF\s+EXISTS\s+)?(' + $identifier + ')'
  foreach ($match in [regex]::Matches($text, $functionPattern)) {
    $name = Get-SqlIdentifierBase $match.Groups[1].Value
    if ($functionNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
  }
  # 각 식을 괄호로 먼저 완성한다. PowerShell의 쉼표 연산자가 문자열 + 보다 먼저
  # 결합되면 배열 전체가 문자열 하나가 되어 관계 검사가 조용히 무력화될 수 있다.
  $relationPatterns = @(
    ('(?is)\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?(' + $identifier + ')'),
    ('(?is)\b(?:CREATE\s+(?:(?:OR\s+REPLACE|CONSTRAINT)\s+)?|ALTER\s+|DROP\s+)TRIGGER\b.{0,1024}?\bON\s+(?:ONLY\s+)?(' + $identifier + ')'),
    ('(?is)\b(?:CREATE|ALTER|DROP)\s+POLICY\b.{0,1024}?\bON\s+(?:ONLY\s+)?(' + $identifier + ')'),
    ('(?is)\bCREATE\s+(?:UNIQUE\s+)?INDEX\b.{0,1024}?\bON\s+(?:ONLY\s+)?(' + $identifier + ')'),
    ('(?is)\b(?:GRANT|REVOKE)\b.{0,1024}?\bON\s+(?:TABLE\s+)?(' + $identifier + ')'),
    ('(?is)\bCOMMENT\s+ON\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|COLUMN|TRIGGER)\s+(' + $identifier + ')')
  )
  if ($relationPatterns.Count -ne 6) { throw "회계 보호 관계 정규식 구성이 손상되었습니다." }
  foreach ($pattern in $relationPatterns) {
    foreach ($match in [regex]::Matches($text, $pattern)) {
      $name = Get-SqlIdentifierBase $match.Groups[1].Value
      if ($relationNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
    }
  }
  $routineMetadataPattern = '(?is)\b(?:GRANT|REVOKE)\b.{0,1024}?\bON\s+(?:FUNCTION|PROCEDURE)\s+(' + $identifier + ')|\bCOMMENT\s+ON\s+(?:FUNCTION|PROCEDURE)\s+(' + $identifier + ')'
  foreach ($match in [regex]::Matches($text, $routineMetadataPattern)) {
    $rawName = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    $name = Get-SqlIdentifierBase $rawName
    if ($functionNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
  }
  $indexMutationPattern = '(?is)\b(?:ALTER|DROP|REINDEX)\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(' + $identifier + ')'
  foreach ($match in [regex]::Matches($text, $indexMutationPattern)) {
    $name = Get-SqlIdentifierBase $match.Groups[1].Value
    if ($indexNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
  }
  $rulePatterns = @(
    ('(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?RULE\b.{0,1024}?\bTO\s+(?:ONLY\s+)?(' + $identifier + ')'),
    ('(?is)\b(?:ALTER|DROP)\s+RULE\b.{0,1024}?\bON\s+(?:ONLY\s+)?(' + $identifier + ')')
  )
  foreach ($pattern in $rulePatterns) {
    foreach ($match in [regex]::Matches($text, $pattern)) {
      $name = Get-SqlIdentifierBase $match.Groups[1].Value
      if ($relationNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
    }
  }
  $identifierPart = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
  $commentColumnPattern = '(?is)\bCOMMENT\s+ON\s+COLUMN\s+((?:' + $identifierPart + '\s*\.\s*)?' + $identifierPart + ')\s*\.\s*' + $identifierPart
  foreach ($match in [regex]::Matches($text, $commentColumnPattern)) {
    $name = Get-SqlIdentifierBase $match.Groups[1].Value
    if ($relationNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
  }
  $commentOwnedPattern = '(?is)\bCOMMENT\s+ON\s+(?:TRIGGER|CONSTRAINT)\s+' + $identifierPart + '\s+ON\s+(?:ONLY\s+)?(' + $identifier + ')'
  foreach ($match in [regex]::Matches($text, $commentOwnedPattern)) {
    $name = Get-SqlIdentifierBase $match.Groups[1].Value
    if ($relationNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
  }
  $commentIndexPattern = '(?is)\bCOMMENT\s+ON\s+INDEX\s+(' + $identifier + ')'
  foreach ($match in [regex]::Matches($text, $commentIndexPattern)) {
    $name = Get-SqlIdentifierBase $match.Groups[1].Value
    if ($indexNames -contains $name -or @($prefixes | Where-Object { $name.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { return $true }
  }
  foreach ($match in [regex]::Matches($text, '(?is)\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\b([^;]+)')) {
    if (Test-ProtectedIdentifierMention $match.Groups[1].Value $relationNames $prefixes) { return $true }
  }
  foreach ($match in [regex]::Matches($text, '(?is)\b(?:DROP|ALTER)\s+(?:FUNCTION|PROCEDURE|ROUTINE)\b([^;]+)')) {
    if (Test-ProtectedIdentifierMention $match.Groups[1].Value $functionNames $prefixes) { return $true }
  }
  foreach ($match in [regex]::Matches($text, '(?is)\b(?:DROP|ALTER|REINDEX)\s+INDEX\b([^;]+)')) {
    if (Test-ProtectedIdentifierMention $match.Groups[1].Value $indexNames $prefixes) { return $true }
  }
  foreach ($match in [regex]::Matches($text, '(?is)\bTRUNCATE\s+(?:TABLE\s+)?([^;]+)')) {
    if (Test-ProtectedIdentifierMention $match.Groups[1].Value $relationNames $prefixes) { return $true }
  }
  if (Test-DangerousSessionSettingSyntax $text) { return $true }
  if ($text -match '(?is)\b(?:CREATE|ALTER|DROP)\s+EVENT\s+TRIGGER\b') { return $true }
  if ($text -match '(?is)\b(?:GRANT|REVOKE)\b.{0,1024}?\bON\s+ALL\s+(?:TABLES|FUNCTIONS|PROCEDURES|ROUTINES|SEQUENCES)\s+IN\s+SCHEMA\b') { return $true }
  return $false
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Fail "psql 이 없다 — PostgreSQL 클라이언트 설치 후 PATH 등록(예: winget install PostgreSQL.PostgreSQL.16)"
}
if ($RecoverAccountingMaintenance -and $AccountingMaintenance) { Fail "복구와 신규 회계 유지보수를 동시에 실행할 수 없습니다." }
$sqlRoot = [System.IO.Path]::GetFullPath($sqlDir).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$resolvedSqlFiles = @()
foreach ($f in $(if ($RecoverAccountingMaintenance) { @() } else { $Files })) {
  $candidate = if ([System.IO.Path]::IsPathRooted($f)) { $f } else { Join-Path $sqlDir $f }
  $sqlPath = [System.IO.Path]::GetFullPath($candidate)
  if (-not $sqlPath.StartsWith($sqlRoot, [System.StringComparison]::OrdinalIgnoreCase)) { Fail "[migration_path_outside] infra\aws 밖의 SQL은 적용할 수 없음: $f" }
  if ([System.IO.Path]::GetDirectoryName($sqlPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar) -ne [System.IO.Path]::GetFullPath($sqlDir).TrimEnd([System.IO.Path]::DirectorySeparatorChar) -or [System.IO.Path]::GetExtension($sqlPath) -ine '.sql') { Fail "[migration_path_invalid] infra\aws 최상위의 .sql 파일만 적용할 수 있음: $f" }
  if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) { Fail "파일 없음: infra\aws\$f" }
  # 전체 선택 파일을 첫 외부 조회/SQL 실행 전에 확인하며 원문은 변환하지 않는다.
  # 회계 정의 SQL의 LF 조건은 아래에서 계약 목록을 읽은 뒤에만 적용한다.
  try { $sqlBytes = [System.IO.File]::ReadAllBytes($sqlPath) }
  catch { Fail "SQL 파일 읽기 실패: $f" }
  if ($sqlBytes.Length -ge 3 -and $sqlBytes[0] -eq 239 -and $sqlBytes[1] -eq 187 -and $sqlBytes[2] -eq 191) {
    Fail "UTF-8 BOM이 있는 SQL: $f — BOM 없는 검토 원문을 사용하세요."
  }
  if ($sqlBytes -contains 0) { Fail "NUL byte가 있는 SQL: $f" }
  try { [void]([System.Text.UTF8Encoding]::new($false, $true).GetString($sqlBytes)) }
  catch { Fail "UTF-8 형식이 아닌 SQL: $f" }
  # psql/PostgreSQL은 단독 CR도 줄 끝으로 해석한다. lexer가 LF만 줄 끝으로 보는
  # 동안 단독 CR을 허용하면 주석 뒤의 DDL·psql meta command가 가려진다.
  if (Test-LoneCarriageReturn $sqlBytes) { Fail "단독 CR 줄바꿈이 있는 SQL: $f — CRLF 또는 LF를 사용하세요." }
  $resolvedSqlFiles += [pscustomobject]@{ Name = [System.IO.Path]::GetFileName($sqlPath); Path = $sqlPath; HasCr = ($sqlBytes -contains 13) }
}
$accountingDefinitionFiles = @()
$requiresAccountingMaintenance = $false
if (-not $RecoverAccountingMaintenance) {
  $definitionManifestPath = Join-Path $PSScriptRoot "accounting-definition-migrations.json"
  if (-not (Test-Path -LiteralPath $definitionManifestPath -PathType Leaf)) { Fail "회계 정의 SQL 계약 파일이 없습니다." }
  try {
    $definitionManifest = Get-Content -LiteralPath $definitionManifestPath -Raw | ConvertFrom-Json
    $accountingDefinitionFiles = @($definitionManifest.files | ForEach-Object { [string]$_ })
    $definitionContractFiles = @($definitionManifest.contracts | ForEach-Object { [string]$_ })
    $protectedIndexNames = @($definitionManifest.protectedIndexes | ForEach-Object { ([string]$_).ToLowerInvariant() })
    $baselineDefinitionRows = @($definitionManifest.baselineDefinitions)
  } catch { Fail "회계 정의 SQL 계약 파일을 읽을 수 없습니다." }
  $invalidBaseline = @($baselineDefinitionRows | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.file) -or ([string]$_.canonicalSha256) -notmatch '^[0-9a-f]{64}$' }).Count -gt 0
  if ($definitionManifest.version -ne "accounting-definition-maintenance-v9" -or $accountingDefinitionFiles.Count -eq 0 -or $definitionContractFiles.Count -eq 0 -or $protectedIndexNames.Count -eq 0 -or $baselineDefinitionRows.Count -eq 0 -or $invalidBaseline -or @($accountingDefinitionFiles | Group-Object | Where-Object Count -ne 1).Count -ne 0 -or @($definitionContractFiles | Group-Object | Where-Object Count -ne 1).Count -ne 0 -or @($protectedIndexNames | Group-Object | Where-Object Count -ne 1).Count -ne 0 -or @($baselineDefinitionRows | Group-Object file | Where-Object Count -ne 1).Count -ne 0) { Fail "회계 정의 SQL 계약이 올바르지 않습니다." }
  foreach ($item in $resolvedSqlFiles) {
    if ($item.HasCr -and $accountingDefinitionFiles -contains $item.Name) {
      Fail "LF 형식이 아닌 회계 정의 SQL: $($item.Name) — 검토된 LF 체크아웃의 파일을 사용하세요."
    }
  }
  $protectedFunctionNames = @()
  $protectedRelationNames = @()
  foreach ($contractFile in $definitionContractFiles) {
    $contractPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $contractFile))
    $repoPrefix = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $contractPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $contractPath -PathType Leaf)) { Fail "정의 계약 파일이 없습니다: $contractFile" }
    try { $contract = (Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json).contract } catch { Fail "정의 계약 파일을 읽을 수 없습니다: $contractFile" }
    $protectedFunctionNames += @($contract.functions | ForEach-Object { ([string]$_.name).ToLowerInvariant() })
    $protectedRelationNames += @($contract.tables | ForEach-Object { ([string]$_).ToLowerInvariant() })
    $protectedRelationNames += @($contract.strictRelations | ForEach-Object { if ($_ -is [string]) { ([string]$_).ToLowerInvariant() } else { ([string]$_.name).ToLowerInvariant() } })
  }
  $protectedFunctionNames = @($protectedFunctionNames | Where-Object { $_ } | Sort-Object -Unique)
  $protectedRelationNames = @($protectedRelationNames | Where-Object { $_ } | Sort-Object -Unique)
  $protectedPrefixes = @($protectedFunctionNames | ForEach-Object { if ($_ -match '^([a-z][a-z0-9]*_)') { $Matches[1] } } | Sort-Object -Unique)
  if ($protectedFunctionNames.Count -eq 0 -or $protectedRelationNames.Count -eq 0 -or $protectedPrefixes.Count -eq 0 -or $protectedIndexNames.Count -eq 0) { Fail "정의 계약 보호 대상이 비어 있습니다." }
  $baselineDefinitionHashes = @{}
  foreach ($row in $baselineDefinitionRows) { $baselineDefinitionHashes[[string]$row.file] = ([string]$row.canonicalSha256).ToLowerInvariant() }
  foreach ($name in $baselineDefinitionHashes.Keys) {
    $baselinePath = Join-Path $sqlDir $name
    if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) { Fail "과거 회계 정의 SQL이 없습니다: $name" }
    try { $baselineText = [System.IO.File]::ReadAllText($baselinePath, [System.Text.UTF8Encoding]::new($false, $true)) } catch { Fail "과거 회계 정의 SQL 검사 실패: $name" }
    if ((Get-CanonicalSqlSha256 $baselineText) -ne $baselineDefinitionHashes[$name]) { Fail "과거 회계 정의 SQL 내용이 계약과 다릅니다: $name" }
  }

  $unregisteredDefinitionFiles = @()
  foreach ($candidateSql in Get-ChildItem -LiteralPath $sqlDir -Filter "*.sql" -File) {
    # 번호·이름과 무관하게 모든 미등록 SQL을 검사한다. 과거 번호 hotfix가 보호 정의를
    # 바꾸더라도 유지보수 절차를 우회할 수 없어야 한다.
    $isSelectedFile = @($resolvedSqlFiles | Where-Object { $_.Name -ieq $candidateSql.Name }).Count -gt 0
    if ($accountingDefinitionFiles -contains $candidateSql.Name) {
      if ($isSelectedFile) {
        try { $registeredText = [System.IO.File]::ReadAllText($candidateSql.FullName, [System.Text.UTF8Encoding]::new($false, $true)) } catch { Fail "정의 SQL 검사 실패: $($candidateSql.Name)" }
        if (Test-PsqlMetaSyntax $registeredText) { Fail "[migration_psql_meta_forbidden] psql meta command·변수 치환은 마이그레이션에서 사용할 수 없음: $($candidateSql.Name)" }
      }
      continue
    }
    try { $candidateBytes = [System.IO.File]::ReadAllBytes($candidateSql.FullName) } catch { Fail "정의 SQL 검사 실패: $($candidateSql.Name)" }
    if (Test-LoneCarriageReturn $candidateBytes) { Fail "단독 CR 줄바꿈이 있는 SQL: $($candidateSql.Name) — CRLF 또는 LF를 사용하세요." }
    try { $candidateText = [System.IO.File]::ReadAllText($candidateSql.FullName, [System.Text.UTF8Encoding]::new($false, $true)) } catch { Fail "정의 SQL 검사 실패: $($candidateSql.Name)" }
    if (Test-ProtectedDefinitionMutation $candidateText $protectedFunctionNames $protectedPrefixes $protectedRelationNames $protectedIndexNames $isSelectedFile) {
      $baselineHash = $baselineDefinitionHashes[$candidateSql.Name]
      if (-not $baselineHash -or (Get-CanonicalSqlSha256 $candidateText) -ne $baselineHash) { $unregisteredDefinitionFiles += $candidateSql.Name }
    }
  }
  if ($unregisteredDefinitionFiles.Count -gt 0) { Fail "[accounting_definition_unregistered] 유지보수 계약에 등록되지 않은 회계 정의 SQL: $($unregisteredDefinitionFiles -join ', ')" }
  $requiresAccountingMaintenance = @($resolvedSqlFiles | Where-Object { $accountingDefinitionFiles -contains $_.Name }).Count -gt 0
  if ($requiresAccountingMaintenance -and -not $AccountingMaintenance) {
    Fail "회계 정의 SQL 적용에는 -AccountingMaintenance가 필요합니다. 스케줄 정지·앱 중지·연결 배출·단일 세션 적용을 한 절차로 수행합니다."
  }
  if ($AccountingMaintenance -and -not $requiresAccountingMaintenance) {
    Fail "-AccountingMaintenance는 검토된 회계 정의 SQL을 포함할 때만 사용하세요."
  }
}

# 유지보수 표식은 현재의 축소 상태를 새 정상값으로 채택하는 재실행을 막는다.
$markerResult = (& aws ssm get-parameter --name $MaintenanceStateParameter --with-decryption --region $Region --query "Parameter.Value" --output text 2>&1)
$markerExit = $LASTEXITCODE
$markerText = $markerResult -join [Environment]::NewLine
$maintenanceMarker = $null
if ($markerExit -eq 0) {
  try { $maintenanceMarker = $markerText | ConvertFrom-Json } catch { Fail "회계 유지보수 복구 표식이 손상되었습니다. 수동 확인이 필요합니다." }
} elseif ($markerText -notmatch 'ParameterNotFound') { Fail "회계 유지보수 복구 표식 조회 실패" }
if ($maintenanceMarker -and -not $RecoverAccountingMaintenance) {
  Fail "미완료 회계 유지보수가 있습니다. 일반 적용을 중단하고 -RecoverAccountingMaintenance로 원상복구하세요."
}
if ($RecoverAccountingMaintenance -and -not $maintenanceMarker) { Fail "복구할 회계 유지보수 표식이 없습니다." }
if ($RecoverAccountingMaintenance) {
  $invalidSchedule = @($maintenanceMarker.schedules | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.name) -or @('ACTIVE','DISABLED') -notcontains [string]$_.state }).Count -gt 0
  $duplicateSchedule = @($maintenanceMarker.schedules | ForEach-Object { [string]$_.name } | Group-Object | Where-Object Count -ne 1).Count -gt 0
  if ($maintenanceMarker.version -ne "accounting-maintenance-state-v1" -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.operationId) -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.clusterId) -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.ecsCluster) -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.ecsService) -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.scheduleGroup) -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.databaseName) -or [string]::IsNullOrWhiteSpace([string]$maintenanceMarker.databaseRole) -or "$($maintenanceMarker.roleConnectionLimit)" -notmatch '^-?[0-9]+$' -or "$($maintenanceMarker.desiredCount)" -notmatch '^[0-9]+$' -or $invalidSchedule -or $duplicateSchedule) {
    Fail "회계 유지보수 복구 표식이 손상되었습니다. 표식을 보존하고 수동 확인하세요."
  }
  if ($maintenanceMarker.awsProfile -ne $AwsProfile -or $maintenanceMarker.region -ne $Region) { Fail "복구 표식의 AWS 프로필·리전이 요청과 다릅니다. 표식을 보존합니다." }
  # 복구 대상은 호출 인수가 아니라 중단 전에 저장한 표식만 신뢰한다.
  $ClusterId = [string]$maintenanceMarker.clusterId
  $EcsCluster = [string]$maintenanceMarker.ecsCluster
  $EcsService = [string]$maintenanceMarker.ecsService
  $ScheduleGroup = [string]$maintenanceMarker.scheduleGroup
  $AccountingScheduleNames = @($maintenanceMarker.schedules | ForEach-Object { [string]$_.name })
}

# 1) RDS 엔드포인트 + 마스터 시크릿
Log "RDS 클러스터 조회: $ClusterId"
$clusterJson = (aws rds describe-db-clusters --db-cluster-identifier $ClusterId --region $Region `
  --query "DBClusters[0].{Endpoint:Endpoint,SecretArn:MasterUserSecret.SecretArn,DatabaseName:DatabaseName}" --output json)
if ($LASTEXITCODE -ne 0 -or -not $clusterJson) { Fail "RDS 조회 — aws sso login --profile $AwsProfile 먼저" }
$cluster = $clusterJson | ConvertFrom-Json
if (-not $cluster.SecretArn) { Fail "매니지드 마스터 시크릿이 없다" }
$dbName = if ($cluster.DatabaseName) { [string]$cluster.DatabaseName } else { "mcm" }

$secretString = (aws secretsmanager get-secret-value --secret-id $cluster.SecretArn --version-stage AWSCURRENT `
  --region $Region --query "SecretString" --output text)
if ($LASTEXITCODE -ne 0 -or -not $secretString) { Fail "시크릿 조회" }
$secret = $secretString | ConvertFrom-Json

# 2) 터널 — 이미 열려 있으면 그대로, 없으면 bastion 기동 + SSM 포트포워딩 백그라운드
$tunnelProc = $null
$portOpen = Test-NetConnection -ComputerName localhost -Port $LocalPort -InformationLevel Quiet -WarningAction SilentlyContinue
if ($portOpen) {
  Log "기존 터널 사용: localhost:$LocalPort"
} else {
  $bastionId = (aws ec2 describe-instances --region $Region `
    --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=running" `
    --query "Reservations[0].Instances[0].InstanceId" --output text)
  if ($LASTEXITCODE -ne 0) { Fail "bastion 조회" }
  if (-not $bastionId -or $bastionId -eq "None") {
    $stopped = (aws ec2 describe-instances --region $Region `
      --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=stopped,stopping" `
      --query "Reservations[0].Instances[0].InstanceId" --output text)
    if (-not $stopped -or $stopped -eq "None") { Fail "bastion 인스턴스를 찾지 못함" }
    Log "bastion 기동: $stopped (running 대기)"
    aws ec2 start-instances --instance-ids $stopped --region $Region --no-cli-pager | Out-Null
    aws ec2 wait instance-running --instance-ids $stopped --region $Region
    $bastionId = $stopped
    # 부팅 직후 SSM 에이전트 등록까지 잠시 걸린다
    Log "SSM 에이전트 등록 대기"
    $ready = $false
    for ($i = 0; $i -lt 18; $i++) {
      Start-Sleep -Seconds 5
      $ping = (aws ssm describe-instance-information --region $Region `
        --filters "Key=InstanceIds,Values=$bastionId" --query "InstanceInformationList[0].PingStatus" --output text)
      if ($ping -eq "Online") { $ready = $true; break }
    }
    if (-not $ready) { Fail "bastion SSM 미등록(90초 초과) — 잠시 후 재시도" }
  }

  Log "SSM 포트포워딩 기동: $bastionId -> $($cluster.Endpoint):5432 (localhost:$LocalPort)"
  $ssmArgs = @("ssm", "start-session", "--target", $bastionId, "--region", $Region,
    "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters", "host=$($cluster.Endpoint),portNumber=5432,localPortNumber=$LocalPort")
  $tunnelProc = Start-Process aws -ArgumentList $ssmArgs -PassThru -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    if (Test-NetConnection -ComputerName localhost -Port $LocalPort -InformationLevel Quiet -WarningAction SilentlyContinue) { $up = $true; break }
  }
  if (-not $up) {
    if ($tunnelProc) { Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue }
    Fail "터널이 열리지 않음(60초) — Session Manager plugin 설치 여부 확인"
  }
}

# 3) psql 적용 (멱등, 파일 단위 ON_ERROR_STOP)
$env:PGPASSWORD = [string]$secret.password
$env:PGSSLMODE  = "require"
# Windows psql 은 클라이언트 인코딩을 UHC(CP949)로 잡아 UTF-8 SQL 의 한글 주석에서
# "byte sequence ... in encoding UHC" 오류가 난다(2026-08-28 실측) — UTF8 로 고정.
$env:PGCLIENTENCODING = "UTF8"
$failed = $false
$temporaryFiles = New-Object System.Collections.Generic.List[string]
$restoreState = $maintenanceMarker
$markerPresent = $null -ne $maintenanceMarker
$roleMayNeedRestore = $false
$serviceMayNeedRestore = $false
$schedulesMayNeedRestore = $false
$restorationAuthorized = $false
$maintenanceBatch = $null
try {
  if ($AccountingMaintenance) {
    # 원상복구 기준을 전부 먼저 읽고 SSM에 원자적으로 남긴 뒤에만 상태를 바꾼다.
    $scheduleStates = @()
    foreach ($scheduleName in $AccountingScheduleNames) {
      $scheduleResult = (& aws scheduler get-schedule --name $scheduleName --group-name $ScheduleGroup --region $Region --output json 2>&1)
      $scheduleExit = $LASTEXITCODE
      $scheduleJson = $scheduleResult -join [Environment]::NewLine
      if ($scheduleExit -ne 0) {
        if ($scheduleJson -match 'ResourceNotFoundException') { Log "스케줄 없음(skip): $scheduleName"; continue }
        Fail "스케줄 조회 실패: $scheduleName"
      }
      if (-not $scheduleJson) { Fail "스케줄 응답 없음: $scheduleName" }
      $schedule = $scheduleJson | ConvertFrom-Json
      $scheduleStates += [pscustomobject]@{ Name = $scheduleName; State = [string]$schedule.State; Value = $schedule }
    }
    $serviceJson = (aws ecs describe-services --cluster $EcsCluster --services $EcsService --region $Region `
      --query "services[0].{Desired:desiredCount,Status:status}" --output json)
    if ($LASTEXITCODE -ne 0 -or -not $serviceJson) { Fail "ECS 서비스 조회" }
    $service = $serviceJson | ConvertFrom-Json
    if ($service.Status -ne "ACTIVE") { Fail "ECS 서비스가 ACTIVE 상태가 아님: $($service.Status)" }
    $originalRoleLimit = (psql -h localhost -p $LocalPort -U ([string]$secret.username) -d $dbName -v ON_ERROR_STOP=1 -Atq `
      -c "SELECT rolconnlimit FROM pg_roles WHERE rolname=current_user")
    if ($LASTEXITCODE -ne 0 -or $originalRoleLimit -notmatch '^-?[0-9]+$') { Fail "DB 역할 연결 한도 조회" }

    $restoreState = [ordered]@{
      version = "accounting-maintenance-state-v1"; operationId = [guid]::NewGuid().ToString()
      awsProfile = $AwsProfile; region = $Region; clusterId = $ClusterId
      ecsCluster = $EcsCluster; ecsService = $EcsService; desiredCount = [int]$service.Desired
      scheduleGroup = $ScheduleGroup
      schedules = @($scheduleStates | ForEach-Object { [ordered]@{ name = $_.Name; state = $_.State } })
      databaseName = $dbName; databaseRole = [string]$secret.username; roleConnectionLimit = [int]$originalRoleLimit
      createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    }
    $markerPutPath = Join-Path $env:TEMP "mcm-accounting-marker-$PID.json"
    $temporaryFiles.Add($markerPutPath)
    $markerPayload = $restoreState | ConvertTo-Json -Compress -Depth 10
    $markerPut = [ordered]@{ Name = $MaintenanceStateParameter; Type = "String"; Value = $markerPayload; Description = "MCM accounting migration recovery state" }
    [System.IO.File]::WriteAllText($markerPutPath, ($markerPut | ConvertTo-Json -Compress -Depth 12), [System.Text.UTF8Encoding]::new($false))
    aws ssm put-parameter --cli-input-json "file://$markerPutPath" --region $Region --no-cli-pager | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "회계 유지보수 복구 표식 생성 실패(다른 유지보수 실행 여부 확인)" }
    $markerPresent = $true
    $restorationAuthorized = $true

    Log "회계 유지보수 스케줄 일시 정지"
    $schedulesMayNeedRestore = $true
    foreach ($saved in $scheduleStates) {
      if ($saved.State -eq "ACTIVE" -and -not (Set-ScheduleState $saved.Value "DISABLED" "disable")) { Fail "스케줄 정지 실패: $($saved.Name)" }
    }
    Log "회계 유지보수 시작: ECS 서비스 중지 $EcsCluster/$EcsService"
    aws ecs update-service --cluster $EcsCluster --service $EcsService --desired-count 0 --region $Region --no-cli-pager | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "ECS 서비스 중지 요청" }
    $serviceMayNeedRestore = $true
    aws ecs wait services-stable --cluster $EcsCluster --services $EcsService --region $Region
    if ($LASTEXITCODE -ne 0) { Fail "ECS 서비스 중지 대기" }
    $env:PGAPPNAME = "mcm-accounting-migration-drain"
    $otherClients = (psql -h localhost -p $LocalPort -U ([string]$secret.username) -d $dbName -v ON_ERROR_STOP=1 -Atq `
      -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()")
    if ($LASTEXITCODE -ne 0) { Fail "회계 연결 배출 확인" }
    if ([int]$otherClients -ne 0) { Fail "회계 연결 배출 실패: 남은 클라이언트 $otherClients 건" }
    Log "회계 연결 배출 확인 완료"
    $roleMayNeedRestore = $true
  }
  if ($RecoverAccountingMaintenance) {
    if ($restoreState.databaseName -ne $dbName -or $restoreState.databaseRole -ne [string]$secret.username) {
      Fail "복구 표식의 DB 이름·역할이 실제 클러스터와 다릅니다. 표식을 보존합니다."
    }
    $restorationAuthorized = $true
    $roleMayNeedRestore = $true
    $serviceMayNeedRestore = $true
    $schedulesMayNeedRestore = $true
    Log "미완료 회계 유지보수 원상복구 시작: $($restoreState.operationId)"
  } elseif ($AccountingMaintenance) {
    $maintenanceBatch = Join-Path $env:TEMP "mcm-accounting-migration-$PID.sql"
    $temporaryFiles.Add($maintenanceBatch)
    $batch = New-Object System.Collections.Generic.List[string]
    $batch.Add("\set ON_ERROR_STOP on")
    $batch.Add("DO `$m`$ BEGIN EXECUTE format('ALTER ROLE %I CONNECTION LIMIT 1',current_user); END `$m`$;")
    $batch.Add(@"
DO `$drain`$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid())
  THEN RAISE EXCEPTION 'Accounting connection drain changed before migration'; END IF;
END `$drain`$;
"@)
    $batch.Add("SELECT pg_advisory_lock(1296256326,0);")
    foreach ($item in $resolvedSqlFiles) {
      $escaped = $item.Path.Replace("'", "''").Replace("\", "/")
      $batch.Add("\echo applying $($item.Name)")
      $batch.Add("\i '$escaped'")
    }
    $batch.Add(@"
DO `$proof`$
BEGIN
  IF to_regprocedure('finance_assert_vat_use_definitions(text)') IS NOT NULL THEN PERFORM finance_assert_vat_use_definitions(current_schema()); END IF;
  IF to_regprocedure('finance_assert_r1_definitions(text)') IS NOT NULL THEN PERFORM finance_assert_r1_definitions(current_schema()); END IF;
  IF to_regprocedure('finance_assert_journal_use_definitions(text)') IS NOT NULL THEN PERFORM finance_assert_journal_use_definitions(current_schema()); END IF;
END `$proof`$;
"@)
    $batch.Add("DO `$m`$ BEGIN EXECUTE format('ALTER ROLE %I CONNECTION LIMIT $($restoreState.roleConnectionLimit)',current_user); END `$m`$;")
    $batch.Add("SELECT pg_advisory_unlock(1296256326,0);")
    [System.IO.File]::WriteAllLines($maintenanceBatch, $batch, [System.Text.UTF8Encoding]::new($false))
    Log "회계 정의 SQL 단일 세션 적용: $($resolvedSqlFiles.Count)건"
    $env:PGAPPNAME = "mcm-accounting-migration-proof"
    psql -h localhost -p $LocalPort -U ([string]$secret.username) -d $dbName -v ON_ERROR_STOP=1 -q -f $maintenanceBatch
    if ($LASTEXITCODE -ne 0) { Write-Host "[migrate] 실패: 회계 정의 적용 또는 새 연결 정의 검증" -ForegroundColor Red; $failed = $true }
    else { $roleMayNeedRestore = $false }
  } else {
    foreach ($item in $resolvedSqlFiles) {
      Log "적용: $($item.Name)"
      psql -h localhost -p $LocalPort -U ([string]$secret.username) -d $dbName -v ON_ERROR_STOP=1 -q -f $item.Path
      if ($LASTEXITCODE -ne 0) { Write-Host "[migrate] 실패: $($item.Name)" -ForegroundColor Red; $failed = $true; break }
    }
  }
} finally {
  $restorationSucceeded = $true
  if ($markerPresent -and $restorationAuthorized -and $roleMayNeedRestore) {
    $restoreSql = "DO `$m`$ BEGIN EXECUTE format('ALTER ROLE %I CONNECTION LIMIT $($restoreState.roleConnectionLimit)',current_user); END `$m`$;"
    $roleRestored = $false
    for ($attempt = 1; $attempt -le 3 -and -not $roleRestored; $attempt++) {
      $restoreSql | psql -h localhost -p $LocalPort -U ([string]$secret.username) -d $dbName -v ON_ERROR_STOP=1 -q
      $roleRestored = $LASTEXITCODE -eq 0
      if (-not $roleRestored -and $attempt -lt 3) { Start-Sleep -Seconds 2 }
    }
    if (-not $roleRestored) { $failed = $true; $restorationSucceeded = $false; Write-Host "[migrate] 실패: DB 역할 연결 한도 복구(원래 값 $($restoreState.roleConnectionLimit))" -ForegroundColor Red }
  }
  if ($markerPresent -and $restorationAuthorized -and $serviceMayNeedRestore) {
    Log "ECS 서비스 복구: desired-count $($restoreState.desiredCount)"
    aws ecs update-service --cluster $EcsCluster --service $EcsService --desired-count ([int]$restoreState.desiredCount) --region $Region --no-cli-pager | Out-Null
    if ($LASTEXITCODE -ne 0) { $failed = $true; $restorationSucceeded = $false; Write-Host "[migrate] 실패: ECS 서비스 복구 요청" -ForegroundColor Red }
    else {
      aws ecs wait services-stable --cluster $EcsCluster --services $EcsService --region $Region
      if ($LASTEXITCODE -ne 0) { $failed = $true; $restorationSucceeded = $false; Write-Host "[migrate] 실패: ECS 서비스 복구 대기" -ForegroundColor Red }
    }
  }
  if ($markerPresent -and $restorationAuthorized -and $schedulesMayNeedRestore) {
    foreach ($saved in @($restoreState.schedules)) {
      if ($saved.state -ne "ACTIVE") { continue }
      $scheduleResult = (& aws scheduler get-schedule --name ([string]$saved.name) --group-name $ScheduleGroup --region $Region --output json 2>&1)
      $scheduleJson = $scheduleResult -join [Environment]::NewLine
      if ($LASTEXITCODE -ne 0 -or -not $scheduleJson) { $failed = $true; $restorationSucceeded = $false; Write-Host "[migrate] 실패: 스케줄 복구용 조회 $($saved.name)" -ForegroundColor Red; continue }
      $schedule = $scheduleJson | ConvertFrom-Json
      if ($schedule.State -ne "ACTIVE" -and -not (Set-ScheduleState $schedule "ACTIVE" "restore")) {
        $failed = $true; $restorationSucceeded = $false; Write-Host "[migrate] 실패: 스케줄 복구 $($saved.name)" -ForegroundColor Red
      }
    }
  }
  if ($markerPresent -and $restorationAuthorized -and $restorationSucceeded) {
    aws ssm delete-parameter --name $MaintenanceStateParameter --region $Region --no-cli-pager | Out-Null
    if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "[migrate] 실패: 복구 완료 표식 삭제" -ForegroundColor Red }
    else { $markerPresent = $false }
  }
  foreach ($temporaryFile in $temporaryFiles) { Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue }
  $env:PGPASSWORD = $null
  $env:PGCLIENTENCODING = $null
  $env:PGAPPNAME = $null
  if ($tunnelProc -and -not $KeepTunnel) {
    Log "자동 기동한 터널 종료"
    Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
  } elseif ($tunnelProc) {
    Log "터널 유지(-KeepTunnel): localhost:$LocalPort (PID $($tunnelProc.Id))"
  }
}
if ($failed) { exit 1 }
if ($RecoverAccountingMaintenance) { Log "원상복구 완료. SQL은 적용하지 않았습니다."; exit 0 }
Log "완료. 적용 $($Files.Count)건 — 전부 멱등이라 재실행에 안전하다."
