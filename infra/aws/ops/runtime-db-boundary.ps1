function Assert-RuntimeDatabaseBoundary {
  param(
    [Parameter(Mandatory = $true)]$TaskDefinition,
    [Parameter(Mandatory = $true)][string]$ContainerName,
    [Parameter(Mandatory = $true)][string]$ExpectedRole,
    [Parameter(Mandatory = $true)][string]$ExpectedPartition,
    [Parameter(Mandatory = $true)][string]$ExpectedRegion,
    [Parameter(Mandatory = $true)][string]$ExpectedAccountId,
    [Parameter(Mandatory = $true)][string]$ExpectedSecretName,
    [Parameter(Mandatory = $true)][string]$ExpectedApplicationSecretName,
    [Parameter(Mandatory = $true)][string[]]$AllowedApplicationSecretKeys,
    [Parameter(Mandatory = $true)][string]$ExpectedTaskRoleName,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutionRoleName,
    [string[]]$AllowedSidecarNames = @()
  )

  $definitions = @($TaskDefinition.containerDefinitions)
  $definition = @($definitions | Where-Object { [string]$_.name -ceq $ContainerName })
  if ($definition.Count -ne 1) { throw "container '$ContainerName' must exist exactly once" }
  $definition = $definition[0]

  if (-not [string]::IsNullOrWhiteSpace([string]$TaskDefinition.pidMode) -or
      -not [string]::IsNullOrWhiteSpace([string]$TaskDefinition.ipcMode)) {
    throw "explicit PID/IPC namespace sharing is forbidden in runtime database tasks"
  }

  # The boundary belongs to the whole task. A sidecar shares the task network and
  # volumes, so a clean primary container does not make a credential-bearing
  # sidecar safe. Secret-free observability sidecars remain allowed.
  foreach ($candidate in $definitions) {
    $candidateName = [string]$candidate.name
    $candidateEnvironment = @($candidate.environment | Where-Object { $null -ne $_ })
    $candidateSecrets = @($candidate.secrets | Where-Object { $null -ne $_ })
    $candidateEnvironmentFiles = @($candidate.environmentFiles | Where-Object { $null -ne $_ })
    if ($candidateEnvironmentFiles.Count) {
      throw "environmentFiles are forbidden in runtime database tasks (found in '$candidateName')"
    }

    $databaseUrlEnvironment = @($candidateEnvironment | Where-Object { ([string]$_.name).ToUpperInvariant() -eq "DATABASE_URL" })
    $databaseUrlSecrets = @($candidateSecrets | Where-Object { ([string]$_.name).ToUpperInvariant() -eq "DATABASE_URL" })
    if ($databaseUrlEnvironment.Count -or $databaseUrlSecrets.Count) {
      throw "DATABASE_URL is forbidden in every container (found in '$candidateName')"
    }

    if ($candidateName -cne $ContainerName) {
      if ($AllowedSidecarNames -cnotcontains $candidateName) {
        throw "unapproved sidecar '$candidateName'"
      }
      foreach ($entry in $candidateEnvironment) {
        $environmentName = [string]$entry.name
        $allowedEnvironment = $environmentName -clike "FLB_*" -or $environmentName -cin @("LOG_LEVEL", "AWS_REGION", "AWS_DEFAULT_REGION")
        if (-not $allowedEnvironment) {
          throw "environment '$environmentName' is forbidden in sidecar '$candidateName'"
        }
      }
      if ($candidateSecrets.Count) {
        throw "secrets are forbidden in sidecar '$candidateName'"
      }
      if (@($candidate.volumesFrom | Where-Object { $null -ne $_ }).Count) {
        throw "volumesFrom is forbidden in sidecar '$candidateName'"
      }
      if (@($candidate.mountPoints | Where-Object { $null -ne $_ }).Count) {
        throw "volume mounts are forbidden in sidecar '$candidateName'"
      }
    }
  }

  $primaryEnvironment = @($definition.environment | Where-Object { $null -ne $_ })
  $allowedPostgresEnvironment = @("PGHOST", "PGPORT", "PGDATABASE", "PGSSL", "PGSSL_REJECT_UNAUTHORIZED", "PGAPPNAME", "PG_POOL_MAX")
  foreach ($entry in $primaryEnvironment) {
    $environmentName = [string]$entry.name
    $environmentValue = [string]$entry.value
    if ($environmentName -clike "PG*" -and $allowedPostgresEnvironment -cnotcontains $environmentName) {
      throw "unexpected PostgreSQL environment '$environmentName'"
    }
    if ($environmentName -ceq "PG_POOL_MAX" -and ($environmentValue -cnotmatch '\A[1-9][0-9]{0,2}\z' -or [int]$environmentValue -gt 100)) {
      throw "PG_POOL_MAX must be an integer from 1 to 100"
    }
    if ($environmentName -ceq "PGSSL" -and $environmentValue -cne "require") {
      throw "PGSSL must be require"
    }
    if ($environmentName -ceq "PGSSL_REJECT_UNAUTHORIZED" -and $environmentValue -cnotin @("true", "false")) {
      throw "PGSSL_REJECT_UNAUTHORIZED must be true or false"
    }
    if ($environmentName -ceq "PGAPPNAME" -and ($environmentValue.Length -lt 1 -or $environmentValue.Length -gt 63)) {
      throw "PGAPPNAME must contain 1 to 63 characters"
    }
  }

  $pgSsl = @($primaryEnvironment | Where-Object { [string]$_.name -ceq "PGSSL" })
  $pgSslVerify = @($primaryEnvironment | Where-Object { [string]$_.name -ceq "PGSSL_REJECT_UNAUTHORIZED" })
  if ($pgSsl.Count -ne 1 -or [string]$pgSsl[0].value -cne "require") {
    throw "PGSSL=require is required exactly once"
  }
  if ($pgSslVerify.Count -ne 1 -or [string]$pgSslVerify[0].value -cne "true") {
    throw "PGSSL_REJECT_UNAUTHORIZED=true is required exactly once"
  }

  $roleRequired = @($primaryEnvironment | Where-Object { [string]$_.name -ceq "MCM_DB_ROLE_REQUIRED" })
  $expected = @($primaryEnvironment | Where-Object { [string]$_.name -ceq "MCM_DB_EXPECTED_ROLE" })
  if ($roleRequired.Count -ne 1 -or [string]$roleRequired[0].value -cne "true") {
    throw "MCM_DB_ROLE_REQUIRED=true is missing"
  }
  if ($expected.Count -ne 1 -or [string]$expected[0].value -cne $ExpectedRole) {
    throw "MCM_DB_EXPECTED_ROLE must be $ExpectedRole"
  }

  $primarySecrets = @($definition.secrets | Where-Object { $null -ne $_ })
  $dbUser = @($primarySecrets | Where-Object { [string]$_.name -ceq "PGUSER" })
  $dbPassword = @($primarySecrets | Where-Object { [string]$_.name -ceq "PGPASSWORD" })
  if ($dbUser.Count -ne 1 -or $dbPassword.Count -ne 1) { throw "PGUSER/PGPASSWORD secret references are missing" }
  $userSource = [string]$dbUser[0].valueFrom
  $passwordSource = [string]$dbPassword[0].valueFrom
  $secretArnPrefix = "arn:$ExpectedPartition`:secretsmanager:$ExpectedRegion`:$ExpectedAccountId`:secret:$ExpectedSecretName-"
  $userPattern = '\A' + [regex]::Escape($secretArnPrefix) + '[A-Za-z0-9]{6}:username::\z'
  $passwordPattern = '\A' + [regex]::Escape($secretArnPrefix) + '[A-Za-z0-9]{6}:password::\z'
  if ($userSource -cnotmatch $userPattern -or $passwordSource -cnotmatch $passwordPattern) {
    throw "runtime task does not use the expected role-specific DB secret"
  }

  $applicationSecretArnPrefix = "arn:$ExpectedPartition`:secretsmanager:$ExpectedRegion`:$ExpectedAccountId`:secret:$ExpectedApplicationSecretName-"
  foreach ($secret in $primarySecrets) {
    $secretName = [string]$secret.name
    if ($secretName -cin @("PGUSER", "PGPASSWORD")) { continue }
    if ($AllowedApplicationSecretKeys -cnotcontains $secretName) {
      throw "unapproved runtime secret '$secretName'"
    }
    if (@($primarySecrets | Where-Object { [string]$_.name -ceq $secretName }).Count -ne 1) {
      throw "runtime secret '$secretName' must exist at most once"
    }
    $applicationPattern = '\A' + [regex]::Escape($applicationSecretArnPrefix) + '[A-Za-z0-9]{6}:' + [regex]::Escape($secretName) + '::\z'
    if ([string]$secret.valueFrom -cnotmatch $applicationPattern) {
      throw "runtime secret '$secretName' does not use the approved application secret"
    }
  }

  $expectedTaskRoleArn = "arn:$ExpectedPartition`:iam::$ExpectedAccountId`:role/$ExpectedTaskRoleName"
  $expectedExecutionRoleArn = "arn:$ExpectedPartition`:iam::$ExpectedAccountId`:role/$ExpectedExecutionRoleName"
  if ([string]$TaskDefinition.taskRoleArn -cne $expectedTaskRoleArn) {
    throw "unexpected ECS task role"
  }
  if ([string]$TaskDefinition.executionRoleArn -cne $expectedExecutionRoleArn) {
    throw "unexpected ECS execution role"
  }
}
