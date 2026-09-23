#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)][ValidateSet("next", "worker")][string]$Component,
  [string]$TaskDefinitionJson = "",
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region = "ap-northeast-2",
  [string]$AccountId = "195748745315",
  [string]$Partition = "aws",
  [string[]]$AllowedSidecarNames = @()
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "runtime-db-boundary.ps1")

$config = if ($Component -eq "next") {
  @{ Container = "next"; Role = "mcm_app"; Secret = "mcm-ieps-staging/db-app"; ApplicationSecret = "mcm-ieps-staging/app"; ApplicationKeys = @("AUTH_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "SOLAPI_API_KEY", "SOLAPI_API_SECRET", "ANTHROPIC_API_KEY", "DART_API_KEY", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "DATA_GO_KR_API_KEY", "VOYAGE_API_KEY", "CLOVA_OCR_URL", "CLOVA_OCR_SECRET", "KMA_SERVICE_KEY", "BAROBILL_CERTKEY", "KAKAO_REST_API_KEY", "EMPLOYEE_PII_ENCRYPTION_KEY"); ApplicationKeyAliases = @{ KMA_SERVICE_KEY = "DATA_GO_KR_API_KEY" }; TaskRole = "mcm-ieps-staging-ecs-task"; ExecutionRole = "mcm-ieps-staging-ecs-execution-next"; Family = "mcm-ieps-staging-next" }
} else {
  @{ Container = "worker"; Role = "mcm_worker"; Secret = "mcm-ieps-staging/db-worker"; ApplicationSecret = "mcm-ieps-staging/app"; ApplicationKeys = @("DART_API_KEY", "DATA_GO_KR_API_KEY"); ApplicationKeyAliases = @{}; TaskRole = "mcm-ieps-staging-ecs-task-worker"; ExecutionRole = "mcm-ieps-staging-ecs-execution-worker"; Family = "mcm-ieps-staging-worker" }
}

if ($TaskDefinitionJson) {
  $taskDefinition = Get-Content -LiteralPath $TaskDefinitionJson -Raw | ConvertFrom-Json
} else {
  $env:AWS_PROFILE = $AwsProfile
  $json = aws ecs describe-task-definition --task-definition $config.Family --region $Region --query "taskDefinition" --output json
  if ($LASTEXITCODE -ne 0 -or -not $json) { throw "task definition lookup failed" }
  $taskDefinition = $json | ConvertFrom-Json
}

Assert-RuntimeDatabaseBoundary -TaskDefinition $taskDefinition -ContainerName $config.Container `
  -ExpectedRole $config.Role -ExpectedPartition $Partition -ExpectedRegion $Region `
  -ExpectedAccountId $AccountId -ExpectedSecretName $config.Secret `
  -ExpectedApplicationSecretName $config.ApplicationSecret -AllowedApplicationSecretKeys $config.ApplicationKeys `
  -ApplicationSecretKeyOverrides $config.ApplicationKeyAliases `
  -ExpectedTaskRoleName $config.TaskRole -ExpectedExecutionRoleName $config.ExecutionRole `
  -AllowedSidecarNames $AllowedSidecarNames
Write-Output "runtime-db-boundary-ok:$Component"
