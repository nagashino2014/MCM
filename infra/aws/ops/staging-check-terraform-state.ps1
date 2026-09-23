#Requires -Version 5.1
<#
Read-only preflight for staging Terraform plan/apply.
Usage: .\staging-check-terraform-state.ps1 -ExpectedVersionId <recorded S3 version ID>
Run from a checkout with infra/aws/backend.tf and an initialized S3 backend.
#>
param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ExpectedVersionId,
  [string]$TerraformDirectory = (Join-Path $PSScriptRoot '..'),
  [string]$AwsProfile = 'mcm-kesi-staging',
  [switch]$PassThru
)

$ErrorActionPreference = 'Stop'
$bucket = 'mcm-ieps-staging-tfstate-195748745315-apne2'
$key = 'mcm-ieps/staging/terraform.tfstate'
$region = 'ap-northeast-2'
$account = '195748745315'
$lineage = '748db01c-6b2f-ba63-b769-10789f067cad'
$directory = (Resolve-Path -LiteralPath $TerraformDirectory).Path
if (-not [string]::IsNullOrWhiteSpace($env:TF_DATA_DIR)) {
  throw 'TF_DATA_DIR is set; the initialized backend location cannot be verified safely.'
}

if (-not (Test-Path -LiteralPath (Join-Path $directory 'backend.tf') -PathType Leaf)) {
  throw 'Staging backend.tf is missing.'
}
$localStates = @(Get-ChildItem -LiteralPath $directory -File -Filter 'terraform.tfstate*' -ErrorAction Stop)
if ($localStates.Count -gt 0 -or (Test-Path -LiteralPath (Join-Path $directory 'terraform.tfstate.d'))) {
  throw 'Local Terraform state exists in this directory. Do not run Terraform here.'
}

$metadataPath = Join-Path $directory '.terraform/terraform.tfstate'
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
  throw 'Terraform backend is not initialized. Initialize non-interactively only after checking for local state.'
}
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.backend.type -cne 's3' -or
    $metadata.backend.config.bucket -cne $bucket -or
    $metadata.backend.config.key -cne $key -or
    $metadata.backend.config.region -cne $region -or
    $metadata.backend.config.dynamodb_table -cne 'mcm-ieps-staging-terraform-lock') {
  throw 'Initialized Terraform backend does not match the staging state location.'
}

$actualAccount = & aws sts get-caller-identity --profile $AwsProfile --query Account --output text
if ($LASTEXITCODE -ne 0 -or [string]$actualAccount -cne $account) {
  throw 'AWS caller account does not match staging.'
}

function Get-RemoteVersionId {
  $version = & aws s3api head-object --bucket $bucket --key $key --expected-bucket-owner $account `
    --profile $AwsProfile --query VersionId --output text
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$version)) {
    throw 'Cannot read the staging state object version.'
  }
  return [string]$version
}

$versionBefore = Get-RemoteVersionId
if ($versionBefore -cne $ExpectedVersionId) {
  throw 'S3 state version differs from the recorded version. Recheck the state before continuing.'
}

$previousProfile = $env:AWS_PROFILE
try {
  $env:AWS_PROFILE = $AwsProfile
  $workspace = & terraform "-chdir=$directory" workspace show
  if ($LASTEXITCODE -ne 0 -or [string]$workspace -cne 'default') {
    throw 'Terraform workspace must be default.'
  }
  $stateText = & terraform "-chdir=$directory" state pull
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read the initialized Terraform state.' }
  $state = ($stateText -join "`n") | ConvertFrom-Json
  if ([string]$state.lineage -cne $lineage) {
    throw 'Terraform state lineage does not match the migrated staging state.'
  }
  if ($null -eq $state.serial -or [long]$state.serial -lt 0) {
    throw 'Terraform state serial is missing or invalid.'
  }
  $versionAfter = Get-RemoteVersionId
  if ($versionAfter -cne $versionBefore) {
    throw 'S3 state changed during the preflight.'
  }
  if ($PassThru) {
    [pscustomobject]@{ VersionId = $versionAfter; Lineage = [string]$state.lineage; Serial = [long]$state.serial }
  } else {
    Write-Output "staging-state-ok:version=$versionAfter;serial=$($state.serial)"
  }
}
finally {
  $env:AWS_PROFILE = $previousProfile
}
