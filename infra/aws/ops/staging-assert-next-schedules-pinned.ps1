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

# 고정 revision 이미지가 ECR 에 남아 있고 schedule-pin 태그로 보호되는지 확인한다.
# 보호 태그가 없으면 이후 배포 푸시가 개수 규칙으로 그 이미지를 만료시켜 배치가 조용히 멈춘다(2026-10-01).
$pinnedRevision = $pinnedArn.Substring($expectedTaskPrefix.Length)
$pinTag = "schedule-pin-$pinnedRevision"
$repoName = [string]$contract.components.next.family
$taskDef = Read-AwsJson @("ecs", "describe-task-definition", "--task-definition", $pinnedArn)
$pinnedImage = [string]$taskDef.taskDefinition.containerDefinitions[0].image
$imageRef = if ($pinnedImage -match "@(sha256:[0-9a-f]{64})\z") { "imageDigest=$($Matches[1])" } elseif ($pinnedImage -match ":([^:/@]+)\z") { "imageTag=$($Matches[1])" } else { $null }
if (-not $imageRef) { throw "next schedule pin preflight image reference invalid: $pinnedImage" }
$previousPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $rawImage = & aws ecr describe-images --repository-name $repoName --image-ids $imageRef --profile $AwsProfile --region $Region --no-cli-pager --output json 2>$null
  $imageExitCode = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousPreference }
if ($imageExitCode -ne 0 -or -not $rawImage) {
  throw "next schedule pin preflight: 고정 revision $pinnedRevision 의 이미지가 ECR 에 없습니다($pinnedImage) — ADT·intel 배치가 실패 중입니다. 스케줄을 이미지가 있는 revision 으로 다시 고정하세요"
}
$imageTags = @(($rawImage | Out-String | ConvertFrom-Json).imageDetails[0].imageTags)
if ($imageTags -cnotcontains $pinTag) {
  throw "next schedule pin preflight: 고정 revision $pinnedRevision 이미지에 보호 태그 $pinTag 가 없습니다 — .\infra\aws\ops\staging-protect-pinned-image.ps1 -Revision $pinnedRevision 실행 후 다시 배포하세요"
}

Write-Output "next-schedules-pinned-ok"
