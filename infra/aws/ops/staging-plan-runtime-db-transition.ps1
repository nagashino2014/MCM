#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][string]$SnapshotJson,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "runtime-db-boundary.ps1")

$contractPath = Join-Path $PSScriptRoot "runtime-db-transition-contract.json"
$contract = Get-Content -LiteralPath $contractPath -Raw | ConvertFrom-Json

function Assert-ValidJsonUnicode([string]$Json) {
  $insideString = $false
  for ($index = 0; $index -lt $Json.Length; $index++) {
    $character = $Json[$index]
    if (-not $insideString) {
      if ($character -eq '"') { $insideString = $true }
      continue
    }
    if ($character -eq '"') { $insideString = $false; continue }
    if ($character -ne '\') { continue }
    if ($index + 1 -ge $Json.Length) { throw "invalid JSON escape in snapshot" }
    if ($Json[$index + 1] -ne 'u') { $index++; continue }
    if ($index + 5 -ge $Json.Length) { throw "invalid JSON Unicode escape in snapshot" }
    $hex = $Json.Substring($index + 2, 4)
    if ($hex -cnotmatch '\A[0-9A-Fa-f]{4}\z') { throw "invalid JSON Unicode escape in snapshot" }
    $code = [Convert]::ToInt32($hex, 16)
    if ($code -ge 0xD800 -and $code -le 0xDBFF) {
      if ($index + 11 -ge $Json.Length -or $Json[$index + 6] -ne '\' -or $Json[$index + 7] -ne 'u') { throw "invalid Unicode surrogate in snapshot string" }
      $lowHex = $Json.Substring($index + 8, 4)
      if ($lowHex -cnotmatch '\A[0-9A-Fa-f]{4}\z') { throw "invalid Unicode surrogate in snapshot string" }
      $lowCode = [Convert]::ToInt32($lowHex, 16)
      if ($lowCode -lt 0xDC00 -or $lowCode -gt 0xDFFF) { throw "invalid Unicode surrogate in snapshot string" }
      $index += 11
      continue
    }
    if ($code -ge 0xDC00 -and $code -le 0xDFFF) { throw "invalid Unicode surrogate in snapshot string" }
    $index += 5
  }
  if ($insideString) { throw "unterminated JSON string in snapshot" }
}

$snapshotBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $SnapshotJson))
$snapshotText = ([Text.UTF8Encoding]::new($false, $true)).GetString($snapshotBytes)
Assert-ValidJsonUnicode $snapshotText
$snapshot = $snapshotText | ConvertFrom-Json

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Message) {
  if ([string]$Actual -cne [string]$Expected) { throw $Message }
}

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
}

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant() }
  finally { $sha.Dispose() }
}

function ConvertTo-StableJsonString([string]$Value) {
  for ($index = 0; $index -lt $Value.Length; $index++) {
    $character = $Value[$index]
    if ([char]::IsHighSurrogate($character)) {
      Assert-True ($index + 1 -lt $Value.Length -and [char]::IsLowSurrogate($Value[$index + 1])) "invalid Unicode surrogate in snapshot string"
      $index++
    } elseif ([char]::IsLowSurrogate($character)) {
      throw "invalid Unicode surrogate in snapshot string"
    }
  }
  $builder = New-Object Text.StringBuilder
  [void]$builder.Append('"')
  foreach ($character in $Value.ToCharArray()) {
    $code = [int][char]$character
    if ($code -eq 8) { [void]$builder.Append('\b') }
    elseif ($code -eq 9) { [void]$builder.Append('\t') }
    elseif ($code -eq 10) { [void]$builder.Append('\n') }
    elseif ($code -eq 12) { [void]$builder.Append('\f') }
    elseif ($code -eq 13) { [void]$builder.Append('\r') }
    elseif ($code -eq 34) { [void]$builder.Append('\"') }
    elseif ($code -eq 92) { [void]$builder.Append('\\') }
    elseif ($code -lt 32) { [void]$builder.Append(('\u{0:x4}' -f $code)) }
    else { [void]$builder.Append($character) }
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Sort-StringsOrdinal([object[]]$Values) {
  $array = [string[]]@($Values | ForEach-Object { [string]$_ })
  [Array]::Sort($array, [StringComparer]::Ordinal)
  return $array
}

function ConvertTo-StableJson([object]$Value) {
  if ($null -eq $Value) { return 'null' }
  if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
  if ($Value -is [string] -or $Value -is [char]) { return ConvertTo-StableJsonString ([string]$Value) }
  if ($Value -is [DateTimeOffset]) { return ConvertTo-StableJsonString $Value.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture) }
  if ($Value -is [DateTime]) { return ConvertTo-StableJsonString $Value.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture) }
  if ($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
    return ([IFormattable]$Value).ToString($null, [Globalization.CultureInfo]::InvariantCulture)
  }
  if ($Value -is [Collections.IDictionary]) {
    $parts = foreach ($key in @(Sort-StringsOrdinal -Values @($Value.Keys))) {
      (ConvertTo-StableJsonString $key) + ':' + (ConvertTo-StableJson $Value[$key])
    }
    return '{' + ($parts -join ',') + '}'
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [Management.Automation.PSCustomObject]) {
    $parts = @($Value | ForEach-Object { ConvertTo-StableJson $_ })
    return '[' + ($parts -join ',') + ']'
  }
  $propertyNames = Sort-StringsOrdinal -Values @($Value.PSObject.Properties | Where-Object MemberType -in @('NoteProperty', 'Property') | ForEach-Object Name)
  $propertyParts = foreach ($propertyName in @($propertyNames)) {
    (ConvertTo-StableJsonString $propertyName) + ':' + (ConvertTo-StableJson $Value.$propertyName)
  }
  return '{' + ($propertyParts -join ',') + '}'
}

function ConvertTo-CanonicalValue([object]$Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [string] -or $Value -is [ValueType]) { return $Value }
  if ($Value -is [Collections.IDictionary]) {
    $ordered = [ordered]@{}
    foreach ($key in @(Sort-StringsOrdinal -Values @($Value.Keys))) {
      $ordered[$key] = ConvertTo-CanonicalValue $Value[$key]
    }
    return [pscustomobject]$ordered
  }
  if ($Value -is [Collections.IEnumerable] -and $Value -isnot [Management.Automation.PSCustomObject]) {
    $items = @($Value | ForEach-Object { ConvertTo-CanonicalValue $_ })
    return ,$items
  }
  $ordered = [ordered]@{}
  $propertyNames = Sort-StringsOrdinal -Values @($Value.PSObject.Properties | Where-Object MemberType -in @("NoteProperty", "Property") | ForEach-Object Name)
  foreach ($propertyName in @($propertyNames)) { $ordered[$propertyName] = ConvertTo-CanonicalValue $Value.$propertyName }
  return [pscustomobject]$ordered
}

function ConvertTo-CanonicalJson([object]$Value) {
  return ConvertTo-StableJson (ConvertTo-CanonicalValue $Value)
}

function Get-CanonicalOrdinalSortKey([object]$Value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-CanonicalJson $Value))
  return ([BitConverter]::ToString($bytes)).Replace('-', '')
}

function Sort-CanonicalArray([object[]]$Values) {
  return @($Values | Where-Object { $null -ne $_ } | Sort-Object { Get-CanonicalOrdinalSortKey $_ })
}

function Assert-ExactProperties([object]$Object, [string[]]$Expected, [string]$Label) {
  $actual = @(Sort-StringsOrdinal -Values @($Object.PSObject.Properties.Name))
  $wanted = @(Sort-StringsOrdinal -Values @($Expected))
  if (($actual -join '|') -cne ($wanted -join '|')) {
    throw "$Label property set mismatch: actual=$($actual -join ',') expected=$($wanted -join ',')"
  }
}

function Normalize-UnorderedTaskArrays([object]$Definition) {
  foreach ($name in @('requiresCompatibilities', 'placementConstraints', 'volumes', 'inferenceAccelerators', 'tags')) {
    if ($Definition.PSObject.Properties.Name -contains $name) { $Definition.$name = @(Sort-CanonicalArray -Values @($Definition.$name)) }
  }
  if ($Definition.PSObject.Properties.Name -contains 'proxyConfiguration' -and $null -ne $Definition.proxyConfiguration -and $Definition.proxyConfiguration.PSObject.Properties.Name -contains 'properties') {
    $Definition.proxyConfiguration.properties = @(Sort-CanonicalArray -Values @($Definition.proxyConfiguration.properties))
  }
  foreach ($container in @($Definition.containerDefinitions)) {
    foreach ($name in @('environment','secrets','portMappings','mountPoints','volumesFrom','ulimits','dependsOn','systemControls','extraHosts','resourceRequirements','dockerSecurityOptions')) {
      if ($container.PSObject.Properties.Name -contains $name) { $container.$name = @(Sort-CanonicalArray -Values @($container.$name)) }
    }
    if ($container.PSObject.Properties.Name -contains 'linuxParameters' -and $null -ne $container.linuxParameters) {
      if ($container.linuxParameters.PSObject.Properties.Name -contains 'capabilities' -and $null -ne $container.linuxParameters.capabilities) {
        foreach ($name in @('add','drop')) {
          if ($container.linuxParameters.capabilities.PSObject.Properties.Name -contains $name) { $container.linuxParameters.capabilities.$name = @(Sort-CanonicalArray -Values @($container.linuxParameters.capabilities.$name)) }
        }
      }
      if ($container.linuxParameters.PSObject.Properties.Name -contains 'devices') {
        foreach ($device in @($container.linuxParameters.devices)) {
          if ($device.PSObject.Properties.Name -contains 'permissions') { $device.permissions = @(Sort-CanonicalArray -Values @($device.permissions)) }
        }
        $container.linuxParameters.devices = @(Sort-CanonicalArray -Values @($container.linuxParameters.devices))
      }
      if ($container.linuxParameters.PSObject.Properties.Name -contains 'tmpfs') {
        foreach ($tmpfs in @($container.linuxParameters.tmpfs)) {
          if ($tmpfs.PSObject.Properties.Name -contains 'mountOptions') { $tmpfs.mountOptions = @(Sort-CanonicalArray -Values @($tmpfs.mountOptions)) }
        }
        $container.linuxParameters.tmpfs = @(Sort-CanonicalArray -Values @($container.linuxParameters.tmpfs))
      }
    }
    if ($container.PSObject.Properties.Name -contains 'logConfiguration' -and $null -ne $container.logConfiguration -and $container.logConfiguration.PSObject.Properties.Name -contains 'secretOptions') {
      $container.logConfiguration.secretOptions = @(Sort-CanonicalArray -Values @($container.logConfiguration.secretOptions))
    }
  }
  $Definition.containerDefinitions = @(Sort-CanonicalArray -Values @($Definition.containerDefinitions))
  return $Definition
}

function Remove-Property([object]$Object, [string]$Name) {
  if ($Object.PSObject.Properties.Name -contains $Name) { $Object.PSObject.Properties.Remove($Name) }
}

function Normalize-TaskDefinition([object]$Definition, [string]$ContainerName, [string[]]$MutableEnvironment) {
  $copy = ConvertTo-CanonicalValue $Definition
  foreach ($name in @("taskDefinitionArn", "revision", "status", "requiresAttributes", "compatibilities", "registeredAt", "registeredBy", "deregisteredAt")) {
    Remove-Property $copy $name
  }
  $copy.taskRoleArn = "__approved_task_role__"
  $copy.executionRoleArn = "__approved_execution_role__"
  $containers = @($copy.containerDefinitions)
  $primary = @($containers | Where-Object { [string]$_.name -ceq $ContainerName })
  if ($primary.Count -ne 1) { throw "candidate/current primary container mismatch: $ContainerName" }
  $mutableSecrets = @($contract.approvedMutableSecrets)
  foreach ($container in $containers) {
    $environment = @($container.environment | Where-Object { $null -ne $_ -and $MutableEnvironment -cnotcontains [string]$_.name })
    $secrets = @($container.secrets | Where-Object { $null -ne $_ -and $mutableSecrets -cnotcontains [string]$_.name })
    $container.environment = $environment
    $container.secrets = $secrets
  }
  [void](Normalize-UnorderedTaskArrays $copy)
  return ConvertTo-CanonicalJson $copy
}

function Normalize-TaskDefinitionForHash([object]$Definition) {
  $copy = ConvertTo-CanonicalValue $Definition
  [void](Normalize-UnorderedTaskArrays $copy)
  return ConvertTo-CanonicalJson $copy
}

function Assert-SecretMetadata([object]$Secret, [object]$Component, [string]$Label) {
  $prefix = "arn:$($contract.partition):secretsmanager:$($contract.region):$($contract.accountId):secret:$($Component.secret)-"
  $pattern = '\A' + [regex]::Escape($prefix) + '[A-Za-z0-9]{6}\z'
  Assert-True ([string]$Secret.arn -cmatch $pattern) "$Label secret ARN mismatch"
  Assert-Equal $Secret.username $Component.role "$Label secret username mismatch"
  Assert-True ([bool]$Secret.passwordPresent) "$Label secret password is missing"
  Assert-Equal $Secret.currentVersionCount 1 "$Label secret must have exactly one AWSCURRENT version"
  Assert-True ([string]$Secret.currentVersionId -cmatch '\A[A-Za-z0-9-]{32,64}\z') "$Label secret AWSCURRENT version ID is invalid"
  Assert-Equal $Secret.pendingVersionCount 0 "$Label secret must not have an AWSPENDING version"
  Assert-Equal @($Secret.pendingVersionIds).Count $Secret.pendingVersionCount "$Label secret pending version metadata mismatch"
}

function Assert-TaskCandidate([string]$Label, [object]$Current, [object]$Candidate, [object]$Component) {
  Assert-Equal $Candidate.family $Component.family "$Label candidate family mismatch"
  Assert-RuntimeDatabaseBoundary -TaskDefinition $Candidate -ContainerName $Component.container `
    -ExpectedRole $Component.role -ExpectedPartition $contract.partition -ExpectedRegion $contract.region `
    -ExpectedAccountId $contract.accountId -ExpectedSecretName $Component.secret `
    -ExpectedApplicationSecretName $Component.applicationSecret -AllowedApplicationSecretKeys @($Component.applicationKeys) `
    -ExpectedTaskRoleName $Component.taskRole -ExpectedExecutionRoleName $Component.executionRole
  $mutableEnvironment = if ($Label -ceq 'next') { @($contract.approvedMutableEnvironment.next) } else { @($contract.approvedMutableEnvironment.worker) }
  $currentNormalized = Normalize-TaskDefinition $Current $Component.container $mutableEnvironment
  $candidateNormalized = Normalize-TaskDefinition $Candidate $Component.container $mutableEnvironment
  Assert-Equal $candidateNormalized $currentNormalized "$Label candidate contains changes outside the approved DB transition fields"
  if ($Label -ceq "next") {
    $primary = @($Candidate.containerDefinitions | Where-Object { [string]$_.name -ceq $Component.container })[0]
    $ready = @($primary.environment | Where-Object { [string]$_.name -ceq "MCM_FACILITY_QUALITY_WORKER_READY" })
    Assert-True ($ready.Count -eq 1 -and [string]$ready[0].value -ceq "false") "next candidate must keep the worker feature disabled"
  } else {
    $primary = @($Candidate.containerDefinitions | Where-Object { [string]$_.name -ceq $Component.container })[0]
    $workerFlags = @($primary.environment | Where-Object { [string]$_.name -ceq 'MCM_FACILITY_QUALITY_WORKER_READY' })
    Assert-Equal $workerFlags.Count 0 "worker candidate must not carry the Next worker feature flag"
  }
}

Assert-ExactProperties $snapshot @('version','generatedAt','collector','captureWindow','factCapturedAt','aws','database','secrets','iam','queue','current','candidates') 'snapshot'
Assert-ExactProperties $snapshot.collector @('name','version','principal') 'snapshot.collector'
Assert-ExactProperties $snapshot.captureWindow @('startedAt','finishedAt') 'snapshot.captureWindow'
Assert-ExactProperties $snapshot.factCapturedAt @('database','secrets','iam','queue','current','candidates') 'snapshot.factCapturedAt'
Assert-ExactProperties $snapshot.aws @('partition','region','accountId','cluster') 'snapshot.aws'
Assert-ExactProperties $snapshot.database @('name','proofVersion','roles','collectorExists','masterRuntimeSessionCount') 'snapshot.database'
Assert-ExactProperties $snapshot.database.roles @('app','worker') 'snapshot.database.roles'
Assert-ExactProperties $snapshot.database.roles.app @('name','login') 'snapshot.database.roles.app'
Assert-ExactProperties $snapshot.database.roles.worker @('name','login') 'snapshot.database.roles.worker'
Assert-ExactProperties $snapshot.secrets @('app','worker') 'snapshot.secrets'
Assert-ExactProperties $snapshot.secrets.app @('arn','username','passwordPresent','currentVersionCount','currentVersionId','pendingVersionCount','pendingVersionIds') 'snapshot.secrets.app'
Assert-ExactProperties $snapshot.secrets.worker @('arn','username','passwordPresent','currentVersionCount','currentVersionId','pendingVersionCount','pendingVersionIds') 'snapshot.secrets.worker'
Assert-ExactProperties $snapshot.iam @('legacyPassRoleEnabled','currentAndCandidateRolesCovered','inlinePolicies') 'snapshot.iam'
Assert-ExactProperties $snapshot.queue @('name','retentionSeconds','visibleMessages','notVisibleMessages','oldestMessageAgeSeconds','dlqVisibleMessages','dlqNotVisibleMessages','runningWorkerTasks','publishedLast5Minutes') 'snapshot.queue'
Assert-ExactProperties $snapshot.current @('nextTaskDefinition','workerTaskDefinition','nextService','schedules') 'snapshot.current'
Assert-ExactProperties $snapshot.current.nextService @('name','taskDefinitionArn','desiredCount','runningCount','pendingCount','deployments') 'snapshot.current.nextService'
Assert-ExactProperties $snapshot.candidates @('nextTaskDefinition','workerTaskDefinition') 'snapshot.candidates'
foreach ($deploymentItem in @($snapshot.current.nextService.deployments)) { Assert-ExactProperties $deploymentItem @('id','createdAt','status','rolloutState') 'snapshot.current.nextService.deployments[]' }
foreach ($scheduleItem in @($snapshot.current.schedules)) { Assert-ExactProperties $scheduleItem @('name','state','taskDefinitionArn','targetId','eventBusName','roleArn','scheduleExpression','taskCount','launchType','networkConfigurationSha256','inputSha256','platformVersion','enableExecuteCommand','propagateTags','ruleRoleArn','retryPolicySha256','deadLetterConfigSha256') 'snapshot.current.schedules[]' }
foreach ($policyItem in @($snapshot.iam.inlinePolicies)) { Assert-ExactProperties $policyItem @('roleName','policyName','documentSha256') 'snapshot.iam.inlinePolicies[]' }

$capturedAt = [DateTimeOffset]$snapshot.generatedAt
$windowStartedAt = [DateTimeOffset]$snapshot.captureWindow.startedAt
$windowFinishedAt = [DateTimeOffset]$snapshot.captureWindow.finishedAt
$now = [DateTimeOffset]::UtcNow
$ageSeconds = ($now - $windowFinishedAt.ToUniversalTime()).TotalSeconds
Assert-True ($ageSeconds -le [double]$contract.snapshot.maximumAgeSeconds) "snapshot is older than the allowed capture window"
Assert-True (($now - $windowStartedAt.ToUniversalTime()).TotalSeconds -ge -[double]$contract.snapshot.maximumFutureSkewSeconds) "snapshot capture time is too far in the future"
Assert-True ($ageSeconds -ge -[double]$contract.snapshot.maximumFutureSkewSeconds) "snapshot capture completion is too far in the future"
Assert-True ($windowFinishedAt -ge $windowStartedAt) "snapshot capture window is reversed"
Assert-True (($windowFinishedAt - $windowStartedAt).TotalSeconds -le [double]$contract.snapshot.maximumCollectionWindowSeconds) "snapshot capture window is too wide"
Assert-True ($capturedAt -ge $windowFinishedAt) "snapshot generatedAt precedes capture completion"
Assert-True (($capturedAt - $windowFinishedAt).TotalSeconds -le [double]$contract.snapshot.maximumPlanDelaySeconds) "snapshot generation was delayed after capture"
foreach ($factName in @('database','secrets','iam','queue','current','candidates')) {
  $factTime = [DateTimeOffset]$snapshot.factCapturedAt.$factName
  Assert-True ($factTime -ge $windowStartedAt -and $factTime -le $windowFinishedAt) "fact '$factName' was captured outside the declared window"
}

Assert-Equal $snapshot.collector.name $contract.collector.name "snapshot collector name mismatch"
Assert-Equal $snapshot.collector.version $contract.collector.version "snapshot collector version mismatch"
$collectorPrincipal = [string]$snapshot.collector.principal
$collectorAllowed = @($contract.collector.allowedIamRoleArns) -ccontains $collectorPrincipal
if (-not $collectorAllowed) {
  foreach ($roleName in @($contract.collector.allowedStsRoleNames)) {
    $assumedPattern = '\Aarn:' + [regex]::Escape([string]$contract.partition) + ':sts::' + [regex]::Escape([string]$contract.accountId) + ':assumed-role/' + [regex]::Escape([string]$roleName) + '/[A-Za-z0-9+=,.@_-]+\z'
    if ($collectorPrincipal -cmatch $assumedPattern) { $collectorAllowed = $true; break }
  }
}
Assert-True $collectorAllowed "snapshot collector principal mismatch"

Assert-Equal $snapshot.version $contract.snapshotVersion "snapshot version mismatch"
Assert-Equal $snapshot.aws.partition $contract.partition "AWS partition mismatch"
Assert-Equal $snapshot.aws.region $contract.region "AWS region mismatch"
Assert-Equal $snapshot.aws.accountId $contract.accountId "AWS account mismatch"
Assert-Equal $snapshot.aws.cluster $contract.cluster "ECS cluster mismatch"
Assert-Equal $snapshot.database.name $contract.database "database name mismatch"
Assert-Equal $snapshot.database.proofVersion $contract.databaseProofVersion "database proof version mismatch"
Assert-True ([bool]$snapshot.database.roles.app.login -and [string]$snapshot.database.roles.app.name -ceq [string]$contract.components.next.role) "mcm_app role is not ready"
Assert-True ([bool]$snapshot.database.roles.worker.login -and [string]$snapshot.database.roles.worker.name -ceq [string]$contract.components.worker.role) "mcm_worker role is not ready"
Assert-True (-not [bool]$snapshot.database.collectorExists) "mcm_collector must not exist"
Assert-Equal $snapshot.database.masterRuntimeSessionCount 0 "master runtime sessions must be zero before cutover"
Assert-SecretMetadata $snapshot.secrets.app $contract.components.next "app"
Assert-SecretMetadata $snapshot.secrets.worker $contract.components.worker "worker"
Assert-True ([bool]$snapshot.iam.legacyPassRoleEnabled) "dual PassRole transition window is not open"
Assert-True ([bool]$snapshot.iam.currentAndCandidateRolesCovered) "current and candidate task/execution roles are not all covered"
$expectedPolicyKeys = @($contract.iamTransitionPolicies | ForEach-Object { "$($_.roleName)|$($_.policyName)" } | Sort-Object -CaseSensitive)
$actualPolicyKeys = @($snapshot.iam.inlinePolicies | ForEach-Object { "$($_.roleName)|$($_.policyName)" } | Sort-Object -CaseSensitive)
Assert-Equal ($actualPolicyKeys -join "|") ($expectedPolicyKeys -join "|") "IAM transition policy set mismatch"
foreach ($policy in @($snapshot.iam.inlinePolicies)) {
  Assert-True ([string]$policy.documentSha256 -cmatch '\A[0-9a-f]{64}\z') "IAM transition policy document hash is invalid"
}

$service = $snapshot.current.nextService
Assert-Equal $service.name $contract.nextService "Next service mismatch"
Assert-True ([int]$service.desiredCount -gt 0) "Next service must be running before transition"
Assert-Equal $service.runningCount $service.desiredCount "Next service is not steady"
Assert-Equal $service.pendingCount 0 "Next service has pending tasks"
Assert-Equal @($service.deployments).Count 1 "Next service has multiple deployments"
$deployment = @($service.deployments)[0]
Assert-True ([string]$deployment.status -ceq 'PRIMARY' -and [string]$deployment.rolloutState -ceq 'COMPLETED') "Next service primary deployment is not completed"
Assert-True ([string]$deployment.id -cmatch '\Aecs-svc/[0-9]+\z') "Next service deployment ID is invalid"
$deploymentCreatedAt = [DateTimeOffset]$deployment.createdAt
Assert-True ($deploymentCreatedAt -le $windowFinishedAt.AddSeconds([double]$contract.snapshot.maximumFutureSkewSeconds)) "Next service deployment timestamp is too far in the future"

$revisionPattern = '\Aarn:' + [regex]::Escape([string]$contract.partition) + ':ecs:' + [regex]::Escape([string]$contract.region) + ':' + [regex]::Escape([string]$contract.accountId) + ':task-definition/' + [regex]::Escape([string]$contract.components.next.family) + ':[1-9][0-9]*\z'
Assert-True ([string]$service.taskDefinitionArn -cmatch $revisionPattern) "Next service is not pinned to an approved revision"
Assert-Equal $service.taskDefinitionArn $snapshot.current.nextTaskDefinition.taskDefinitionArn "Next service and current task definition mismatch"
$scheduleNames = @($snapshot.current.schedules | ForEach-Object { [string]$_.name } | Sort-Object)
$expectedScheduleNames = @($contract.scheduleRules | ForEach-Object { [string]$_ } | Sort-Object)
Assert-Equal ($scheduleNames -join "|") ($expectedScheduleNames -join "|") "schedule set mismatch"
foreach ($schedule in @($snapshot.current.schedules)) {
  Assert-True ([string]$schedule.taskDefinitionArn -cmatch $revisionPattern) "schedule '$($schedule.name)' is not pinned to a Next revision"
  Assert-True ([string]$schedule.state -ceq 'ENABLED') "schedule '$($schedule.name)' must be enabled before transition"
  Assert-True ([string]$schedule.targetId -cmatch '\A[A-Za-z0-9._-]{1,64}\z') "schedule '$($schedule.name)' target ID is invalid"
  Assert-True ([string]$schedule.eventBusName -cmatch '\A[A-Za-z0-9._/-]{1,256}\z') "schedule '$($schedule.name)' event bus name is invalid"
  $scheduleRoleArn = 'arn:' + [string]$contract.partition + ':iam::' + [string]$contract.accountId + ':role/' + [string]$schedule.name + '-events'
  Assert-Equal ([string]$schedule.roleArn) $scheduleRoleArn "schedule '$($schedule.name)' execution role mismatch"
  Assert-True (![string]::IsNullOrWhiteSpace([string]$schedule.scheduleExpression)) "schedule '$($schedule.name)' expression is missing"
  Assert-Equal ([string]$schedule.scheduleExpression) ([string]$contract.scheduleApprovedDefaults.expressions.PSObject.Properties[[string]$schedule.name].Value) "schedule '$($schedule.name)' expression differs from approved rule"
  Assert-True ([string]$schedule.launchType -ceq 'FARGATE') "schedule '$($schedule.name)' launch type mismatch"
  Assert-True ([int64]$schedule.taskCount -eq [int64]$contract.scheduleApprovedDefaults.taskCount) "schedule '$($schedule.name)' task count is invalid"
  Assert-True ([string]$schedule.networkConfigurationSha256 -cmatch '\A[0-9a-f]{64}\z') "schedule '$($schedule.name)' network digest is invalid"
  Assert-True ([string]$schedule.inputSha256 -cmatch '\A[0-9a-f]{64}\z') "schedule '$($schedule.name)' input digest is invalid"
  Assert-Equal ([string]$schedule.inputSha256) ([string]$contract.scheduleApprovedInputSha256.PSObject.Properties[[string]$schedule.name].Value) "schedule '$($schedule.name)' Input digest differs from approved Terraform declaration"
  Assert-True ($null -eq $schedule.platformVersion -or (![string]::IsNullOrWhiteSpace([string]$schedule.platformVersion))) "schedule '$($schedule.name)' platform version is invalid"
  Assert-True ($null -eq $schedule.enableExecuteCommand -or $schedule.enableExecuteCommand -is [bool]) "schedule '$($schedule.name)' execute-command flag is invalid"
  Assert-True ($null -eq $schedule.propagateTags -or [string]$schedule.propagateTags -cin @('TASK_DEFINITION','SERVICE','NONE')) "schedule '$($schedule.name)' tag propagation is invalid"
  Assert-True ($null -eq $schedule.ruleRoleArn -and $null -eq $schedule.retryPolicySha256 -and $null -eq $schedule.deadLetterConfigSha256) "schedule '$($schedule.name)' unsupported settings must be null"
}

Assert-Equal $snapshot.queue.name $contract.queue.name "queue mismatch"
Assert-True ([int64]$snapshot.queue.retentionSeconds -ge [int64]$contract.queue.minimumRetentionSeconds) "queue retention is shorter than the transition contract"
foreach ($name in @('visibleMessages','notVisibleMessages','oldestMessageAgeSeconds','dlqVisibleMessages','dlqNotVisibleMessages','runningWorkerTasks','publishedLast5Minutes')) {
  Assert-True ([int64]$snapshot.queue.$name -ge 0) "queue counter '$name' is invalid"
}
Assert-True ([int64]$snapshot.queue.visibleMessages -le [int64]$contract.queue.maximumVisibleMessages) "visible queue backlog must be drained before transition"
Assert-True ([int64]$snapshot.queue.notVisibleMessages -le [int64]$contract.queue.maximumNotVisibleMessages) "in-flight queue work must be drained before transition"
Assert-True (([int64]$snapshot.queue.dlqVisibleMessages + [int64]$snapshot.queue.dlqNotVisibleMessages) -le [int64]$contract.queue.maximumDlqMessages) "DLQ must be empty before transition"
Assert-True ([int64]$snapshot.queue.runningWorkerTasks -le [int64]$contract.queue.maximumRunningWorkerTasks) "worker tasks must be stopped before transition"
Assert-True ([int64]$snapshot.queue.publishedLast5Minutes -le [int64]$contract.queue.maximumPublishedLast5Minutes) "queue publishers must be quiescent before transition"
Assert-True ([int64]$snapshot.queue.oldestMessageAgeSeconds -eq 0) "oldest queue age must be zero after drain"

Assert-TaskCandidate "next" $snapshot.current.nextTaskDefinition $snapshot.candidates.nextTaskDefinition $contract.components.next
Assert-TaskCandidate "worker" $snapshot.current.workerTaskDefinition $snapshot.candidates.workerTaskDefinition $contract.components.worker

$snapshotHash = Get-Sha256Hex $snapshotBytes
$nextCandidateJson = Normalize-TaskDefinitionForHash $snapshot.candidates.nextTaskDefinition
$workerCandidateJson = Normalize-TaskDefinitionForHash $snapshot.candidates.workerTaskDefinition
$plan = [ordered]@{
  version = $contract.planVersion
  ready = $true
  sourceSnapshotSha256 = $snapshotHash
  sourceCapturedAt = ([DateTimeOffset]$snapshot.generatedAt).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
  collector = [ordered]@{
    name = [string]$snapshot.collector.name
    version = [string]$snapshot.collector.version
    principal = [string]$snapshot.collector.principal
  }
  captureWindow = [ordered]@{
    startedAt = $windowStartedAt.ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
    finishedAt = $windowFinishedAt.ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
    facts = [ordered]@{
      database = ([DateTimeOffset]$snapshot.factCapturedAt.database).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
      secrets = ([DateTimeOffset]$snapshot.factCapturedAt.secrets).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
      iam = ([DateTimeOffset]$snapshot.factCapturedAt.iam).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
      queue = ([DateTimeOffset]$snapshot.factCapturedAt.queue).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
      current = ([DateTimeOffset]$snapshot.factCapturedAt.current).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
      candidates = ([DateTimeOffset]$snapshot.factCapturedAt.candidates).ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture)
    }
  }
  secretVersions = [ordered]@{
    app = [ordered]@{ currentVersionId = [string]$snapshot.secrets.app.currentVersionId; pendingVersionCount = [int]$snapshot.secrets.app.pendingVersionCount }
    worker = [ordered]@{ currentVersionId = [string]$snapshot.secrets.worker.currentVersionId; pendingVersionCount = [int]$snapshot.secrets.worker.pendingVersionCount }
  }
  iamPolicies = @($snapshot.iam.inlinePolicies | Sort-Object roleName, policyName | ForEach-Object { [ordered]@{ roleName = [string]$_.roleName; policyName = [string]$_.policyName; documentSha256 = [string]$_.documentSha256 } })
  current = [ordered]@{
    nextServiceTaskDefinitionArn = [string]$service.taskDefinitionArn
    nextDeployment = [ordered]@{ id = [string]$deployment.id; createdAt = $deploymentCreatedAt.ToUniversalTime().ToString("o", [Globalization.CultureInfo]::InvariantCulture) }
    schedules = @($snapshot.current.schedules | Sort-Object name | ForEach-Object { [ordered]@{ name = [string]$_.name; state = [string]$_.state; taskDefinitionArn = [string]$_.taskDefinitionArn; targetId = [string]$_.targetId; eventBusName = [string]$_.eventBusName; roleArn = [string]$_.roleArn; scheduleExpression = [string]$_.scheduleExpression; taskCount = [int]$_.taskCount; launchType = [string]$_.launchType; networkConfigurationSha256 = [string]$_.networkConfigurationSha256; inputSha256 = [string]$_.inputSha256; platformVersion = $(if ($null -ne $_.platformVersion) { [string]$_.platformVersion } else { $null }); enableExecuteCommand = $_.enableExecuteCommand; propagateTags = $(if ($null -ne $_.propagateTags) { [string]$_.propagateTags } else { $null }); ruleRoleArn = $null; retryPolicySha256 = $null; deadLetterConfigSha256 = $null } })
  }
  candidates = [ordered]@{
    nextTaskDefinitionSha256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($nextCandidateJson))
    workerTaskDefinitionSha256 = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($workerCandidateJson))
  }
  queue = [ordered]@{
    visibleMessages = [int64]$snapshot.queue.visibleMessages
    notVisibleMessages = [int64]$snapshot.queue.notVisibleMessages
    oldestMessageAgeSeconds = [int64]$snapshot.queue.oldestMessageAgeSeconds
    dlqVisibleMessages = [int64]$snapshot.queue.dlqVisibleMessages
    dlqNotVisibleMessages = [int64]$snapshot.queue.dlqNotVisibleMessages
    runningWorkerTasks = [int64]$snapshot.queue.runningWorkerTasks
    publishedLast5Minutes = [int64]$snapshot.queue.publishedLast5Minutes
    retentionSeconds = [int64]$snapshot.queue.retentionSeconds
  }
  phases = @($contract.phases)
  rollback = @("worker_disabled", "legacy_passrole_restored", "schedules_restored", "next_service_restored", "previous_runtime_verified")
}

$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), ((ConvertTo-CanonicalJson $plan) + "`n"), [Text.UTF8Encoding]::new($false))
Write-Output "runtime-db-transition-plan-ok:$snapshotHash"
