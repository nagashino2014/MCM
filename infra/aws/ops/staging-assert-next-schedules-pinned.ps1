#Requires -Version 5.1
param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region = "ap-northeast-2"
)

$ErrorActionPreference = "Stop"
$contract = Get-Content -LiteralPath (Join-Path $PSScriptRoot "runtime-db-schedule-pin-contract-20260921.json") -Raw | ConvertFrom-Json
if ($Region -cne [string]$contract.region -or $contract.partition -cne "aws" -or
    $contract.scheduleRules.Count -ne 2) {
  throw "next schedule pin preflight contract mismatch"
}

function Read-AwsJson([string[]]$AwsArguments) {
  $previousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 treats native stderr as an error under Stop even on exit 0.
    $ErrorActionPreference = "Continue"
    $raw = & aws @AwsArguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
    $awsExitCode = $LASTEXITCODE
  } catch { throw "next schedule pin preflight AWS read failed" }
  finally { $ErrorActionPreference = $previousPreference }
  if ($awsExitCode -ne 0 -or -not $raw) { throw "next schedule pin preflight AWS read failed" }
  try { return ($raw | Out-String | ConvertFrom-Json) }
  catch { throw "next schedule pin preflight AWS response invalid" }
}

$caller = Read-AwsJson @("sts", "get-caller-identity")
if ([string]$caller.Account -cne [string]$contract.accountId) {
  throw "next schedule pin preflight account mismatch"
}

$expectedCluster = "arn:$($contract.partition):ecs:${Region}:$($contract.accountId):cluster/$($contract.cluster)"
$expectedTaskPrefix = "arn:$($contract.partition):ecs:${Region}:$($contract.accountId):task-definition/$($contract.components.next.family):"
if (-not $contract.components.next.family) { throw "next schedule pin preflight family missing" }
$pinnedArn = $null
foreach ($name in $contract.scheduleRules) {
  $rule = Read-AwsJson @("events", "describe-rule", "--name", [string]$name)
  $listing = Read-AwsJson @("events", "list-targets-by-rule", "--rule", [string]$name)
  if ($rule.Name -cne $name -or $rule.State -cne "ENABLED" -or
      $listing.NextToken -or $listing.Targets -isnot [array] -or $listing.Targets.Count -ne 1) {
    throw "next schedule pin preflight rule or target mismatch: $name"
  }
  $target = $listing.Targets[0]
  $taskArn = [string]$target.EcsParameters.TaskDefinitionArn
  if ($target.Arn -cne $expectedCluster -or
      -not $taskArn.StartsWith($expectedTaskPrefix, [StringComparison]::Ordinal) -or
      -not [regex]::IsMatch($taskArn.Substring($expectedTaskPrefix.Length), "\A[1-9][0-9]*\z")) {
    throw "next schedule pin preflight requires a numeric Next revision: $name"
  }
  if ($pinnedArn -and $taskArn -cne $pinnedArn) {
    throw "next schedule pin preflight targets differ"
  }
  $pinnedArn = $taskArn
}

Write-Output "next-schedules-pinned-ok"
