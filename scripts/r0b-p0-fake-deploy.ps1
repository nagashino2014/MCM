#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)][ValidateSet('family','pinned-no-ack','pinned-no-wait','drift-before-register','master-boundary','pinned-ack-wait')][string]$Scenario,
  [Parameter(Mandatory=$true)][string]$CallLog
)

# Local fixture only. These functions shadow the real executables for the nested deploy script.
if (Test-Path -LiteralPath $CallLog) { throw 'CallLog must be a new file' }
[IO.File]::WriteAllText($CallLog, '', (New-Object Text.UTF8Encoding($false)))
$global:R0BTestScenario = $Scenario
$global:R0BTestCallLog = $CallLog
$global:R0BGuardCycle = 0
$global:LASTEXITCODE = 0
$account = '195748745315'
$cluster = 'mcm-ieps-staging'
$revision = "arn:aws:ecs:ap-northeast-2:${account}:task-definition/mcm-ieps-staging-next:618"
$family = "arn:aws:ecs:ap-northeast-2:${account}:task-definition/mcm-ieps-staging-next"
$global:R0BRevision = $revision
$global:R0BFamily = $family
$global:R0BClusterArn = "arn:aws:ecs:ap-northeast-2:${account}:cluster/${cluster}"

function global:aws {
  $operation = "$($args[0]):$($args[1])"
  [IO.File]::AppendAllText($global:R0BTestCallLog, "aws $operation`n", (New-Object Text.UTF8Encoding($false)))
  $global:LASTEXITCODE = 0
  switch ($operation) {
    'sts:get-caller-identity' {
      $global:R0BGuardCycle += 1
      return '{"Account":"195748745315"}'
    }
    'events:describe-rule' {
      $at = [Array]::IndexOf($args, '--name')
      return (@{ Name = [string]$args[$at+1]; State = 'ENABLED' } | ConvertTo-Json -Compress)
    }
    'events:list-targets-by-rule' {
      $targetRevision = $global:R0BRevision
      if ($global:R0BTestScenario -eq 'family' -or ($global:R0BTestScenario -eq 'drift-before-register' -and $global:R0BGuardCycle -ge 2)) {
        $targetRevision = $global:R0BFamily
      }
      $target = @{ Arn = $global:R0BClusterArn; EcsParameters = @{ TaskDefinitionArn = $targetRevision } }
      return (ConvertTo-Json -InputObject @{ Targets = @($target) } -Depth 5 -Compress)
    }
    'ecs:describe-services' { return $global:R0BRevision }
    'ecs:describe-task-definition' {
      $task = @{
        family = 'mcm-ieps-staging-next'
        taskRoleArn = "arn:aws:iam::${account}:role/mcm-ieps-staging-ecs-task"
        executionRoleArn = "arn:aws:iam::${account}:role/mcm-ieps-staging-ecs-execution-next"
        containerDefinitions = @(@{
          name = 'next'
          image = 'old-image'
          environment = @(
            @{ name = 'PGSSL'; value = 'require' },
            @{ name = 'PGSSL_REJECT_UNAUTHORIZED'; value = 'true' },
            @{ name = 'MCM_DB_ROLE_REQUIRED'; value = 'true' },
            @{ name = 'MCM_DB_EXPECTED_ROLE'; value = 'mcm_app' }
          )
          secrets = @(
            @{ name = 'PGUSER'; valueFrom = "arn:aws:secretsmanager:ap-northeast-2:${account}:secret:mcm-ieps-staging/db-app-Q7x2Lm:username::" },
            @{ name = 'PGPASSWORD'; valueFrom = "arn:aws:secretsmanager:ap-northeast-2:${account}:secret:mcm-ieps-staging/db-app-Q7x2Lm:password::" }
          )
        })
      }
      if ($global:R0BTestScenario -eq 'master-boundary') {
        $task.containerDefinitions[0].secrets[0].valueFrom = "arn:aws:secretsmanager:ap-northeast-2:${account}:secret:rds!cluster-master-Q7x2Lm:username::"
        $task.containerDefinitions[0].secrets[1].valueFrom = "arn:aws:secretsmanager:ap-northeast-2:${account}:secret:rds!cluster-master-Q7x2Lm:password::"
      }
      return (ConvertTo-Json -InputObject $task -Depth 8 -Compress)
    }
    'ecs:register-task-definition' { return "arn:aws:ecs:ap-northeast-2:195748745315:task-definition/mcm-ieps-staging-next:619" }
    'ecs:update-service' { return '{}' }
    'ecs:wait' { return '' }
    default { throw "unexpected fake AWS call: $operation" }
  }
}

function global:git {
  [IO.File]::AppendAllText($global:R0BTestCallLog, "git $($args -join ' ')`n", (New-Object Text.UTF8Encoding($false)))
  $global:LASTEXITCODE = 0
}

$deploy = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path 'infra/aws/ops/staging-deploy-next.ps1'
if ((Get-Command aws).CommandType -ne 'Function' -or (Get-Command git).CommandType -ne 'Function') {
  throw 'fake commands are not active'
}
switch ($Scenario) {
  'family' { & $deploy -Force -SkipBuild -AcknowledgePinnedScheduleLag -Wait }
  'pinned-no-ack' { & $deploy -Force -SkipBuild -Wait }
  'pinned-no-wait' { & $deploy -Force -SkipBuild -AcknowledgePinnedScheduleLag }
  'drift-before-register' { & $deploy -Force -SkipBuild -AcknowledgePinnedScheduleLag -Wait }
  'master-boundary' { & $deploy -Force -SkipBuild -AcknowledgePinnedScheduleLag -Wait }
  'pinned-ack-wait' { & $deploy -Force -SkipBuild -AcknowledgePinnedScheduleLag -Wait }
}
exit $LASTEXITCODE
