#Requires -Version 5.1
<#
Read-only validator for the first R0B IAM and DB-secret-container Terraform plan.
Usage: .\staging-check-r0b-terraform-plan.ps1 -PlanPath <fresh saved plan> -ExpectedVersionId <recorded S3 version ID>
Run the state preflight before creating the plan. This validator repeats it before apply.
#>
param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$PlanPath,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ExpectedVersionId,
  [string]$TerraformDirectory = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Stop'
$resolvedPlan = (Resolve-Path -LiteralPath $PlanPath).Path
$directory = (Resolve-Path -LiteralPath $TerraformDirectory).Path
$repo = (Resolve-Path -LiteralPath (Join-Path $directory '../..')).Path
$head = (& git -C $repo rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the candidate Git commit.' }
$main = (& git -C $repo rev-parse origin/main)
if ($LASTEXITCODE -ne 0 -or [string]$head -cne [string]$main) {
  throw 'Plan validation requires HEAD to equal the reviewed origin/main.'
}
$dirty = @(& git -C $repo status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -ne 0) {
  throw 'Plan validation requires a clean main checkout.'
}
# Terraform automatically merges override files into existing blocks. Reject them
# even when they are committed and the saved plan contains the same file.
$overrideName = '^(?:override|.+_override)\.tf(?:\.json)?$'
$localOverrides = @(Get-ChildItem -LiteralPath $directory -File | Where-Object {
  $_.Name -imatch $overrideName
})
if ($localOverrides.Count -ne 0) {
  throw "Terraform override file is not allowed: $($localOverrides[0].Name)."
}
# These are the reviewed IAM policy inputs and provider selections for the
# first R0B apply. A later main commit may change other files, but these
# inputs need another review.
$reviewedSourceHashes = @{
  'ecs.tf' = '02A9DA7253785278ED11D71644E0A9357BD137BF885EA2859135A13554B2FCD9'
  'adt-ingest.tf' = 'F4FF76D6065DFBAEEA9F9C234C12A0066D10536DFB344771E74CB7C7D8547B45'
  'intel-batch.tf' = '623CB4CB7D73A7FE8B0A2D08551E6D6B7FEB573E66F8E1BDB391B2A19FCD930E'
  'facility-quality-worker.tf' = '0E56E039446D40DB2FD67CC3B4287F9A2F288CE8924B9BFF5B0EC2486FEC36E4'
  'facility-quality-worker-import.tf' = '250E10CAD1399008B8F6917382292CB393D417EFD1FECBA1A4E567EB41B2D826'
  'legacy-execution-secrets.tf' = '6EBEE8B63248612409666D4C9906FEA83A67DFC4B768A21BAB5B0768088240A2'
  'main.tf' = 'B70565874EB73A347C937BCB5B15B001182D29F6640D96D1DE7B087BFF469463'
  'variables.tf' = '6D49770C22D978EBB7E5B870795E6FC54702D5C8947B6F1D4F3FAF11ABDDE485'
  'versions.tf' = 'C4B4FE9C449652D64A96FA78B42B89866A88388794A1C5BB84FFAE3EF5BAE66C'
  '.terraform.lock.hcl' = 'C5774317D7AD52E77301821B2B020E231A0B1EDA6B1A0B5472A5701B7567AA3B'
}
$policySha = [System.Security.Cryptography.SHA256]::Create()
try {
  foreach ($file in $reviewedSourceHashes.Keys) {
    $source = Join-Path $directory $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "Reviewed R0B source is missing at $file."
    }
    # Git may convert LF to CRLF on Windows. Normalize only those byte pairs;
    # decoding/re-encoding would alter non-UTF8 bytes in older HCL comments.
    $sourceBytes = [IO.File]::ReadAllBytes($source)
    $normalized = [System.Collections.Generic.List[byte]]::new($sourceBytes.Length)
    for ($i = 0; $i -lt $sourceBytes.Length; $i++) {
      if ($sourceBytes[$i] -eq 13 -and $i + 1 -lt $sourceBytes.Length -and $sourceBytes[$i + 1] -eq 10) {
        $normalized.Add([byte]10)
        $i++
      } else {
        $normalized.Add($sourceBytes[$i])
      }
    }
    $actual = [BitConverter]::ToString($policySha.ComputeHash($normalized.ToArray())).Replace('-', '')
    if ($actual -cne $reviewedSourceHashes[$file]) {
      throw "Reviewed R0B source changed at $file."
    }
  }
} finally { $policySha.Dispose() }
$state = & (Join-Path $PSScriptRoot 'staging-check-terraform-state.ps1') `
  -ExpectedVersionId $ExpectedVersionId -TerraformDirectory $TerraformDirectory -PassThru

# A saved plan carries its own prior state and configuration. Check those bytes before
# trusting `terraform show`, because `terraform apply plan.bin` uses that embedded state.
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Terraform 1.9.8 plan archives carry backend metadata in field 13 of tfplan.
# This is an internal format: fail closed if a future version changes it.
function Read-Varint([byte[]]$bytes, [ref]$offset) {
  [long]$value = 0
  for ($shift = 0; $shift -le 63; $shift += 7) {
    if ($offset.Value -ge $bytes.Length) { throw 'Truncated saved plan metadata.' }
    $b = [int]$bytes[$offset.Value]
    $offset.Value++
    $value = $value -bor ([long]($b -band 127) -shl $shift)
    if (($b -band 128) -eq 0) { return $value }
  }
  throw 'Invalid saved plan metadata varint.'
}
function Get-ProtoFields([byte[]]$bytes) {
  $result = [System.Collections.Generic.List[object]]::new()
  $at = 0
  while ($at -lt $bytes.Length) {
    $tag = Read-Varint $bytes ([ref]$at)
    $number = [int]($tag -shr 3)
    $wire = [int]($tag -band 7)
    if ($number -le 0) { throw 'Invalid saved plan metadata tag.' }
    switch ($wire) {
      0 { $null = Read-Varint $bytes ([ref]$at) }
      1 { $at += 8 }
      2 {
        $length = Read-Varint $bytes ([ref]$at)
        if ($length -lt 0 -or $length -gt ($bytes.Length - $at)) {
          throw 'Truncated saved plan metadata field.'
        }
        $value = [byte[]]::new([int]$length)
        [Array]::Copy($bytes, $at, $value, 0, [int]$length)
        $result.Add([pscustomobject]@{ Number = $number; Bytes = $value })
        $at += [int]$length
      }
      5 { $at += 4 }
      default { throw 'Unsupported saved plan metadata wire type.' }
    }
    if ($at -gt $bytes.Length) { throw 'Truncated saved plan metadata.' }
  }
  return $result.ToArray()
}

function Read-MsgPackLength([byte[]]$bytes, [ref]$offset, [int]$width) {
  if ($width -lt 1 -or $width -gt 8 -or $offset.Value + $width -gt $bytes.Length) {
    throw 'Truncated saved plan backend value.'
  }
  [long]$number = 0
  for ($i = 0; $i -lt $width; $i++) {
    if ($number -gt ([long]::MaxValue - [int]$bytes[$offset.Value]) / 256) {
      throw 'Oversized saved plan backend value.'
    }
    $number = $number * 256 + [int]$bytes[$offset.Value]
    $offset.Value++
  }
  return $number
}
function Read-MsgPackValue([byte[]]$bytes, [ref]$offset, [int]$depth) {
  if ($depth -gt 20 -or $offset.Value -ge $bytes.Length) {
    throw 'Invalid saved plan backend MessagePack.'
  }
  $marker = [int]$bytes[$offset.Value]
  $offset.Value++
  $length = -1
  $kind = ''
  if ($marker -le 0x7f) { return $marker }
  if ($marker -ge 0xe0) { return ($marker - 256) }
  if ($marker -ge 0xa0 -and $marker -le 0xbf) { $kind = 'string'; $length = $marker -band 0x1f }
  elseif ($marker -ge 0x90 -and $marker -le 0x9f) { $kind = 'array'; $length = $marker -band 0x0f }
  elseif ($marker -ge 0x80 -and $marker -le 0x8f) { $kind = 'map'; $length = $marker -band 0x0f }
  else {
    switch ($marker) {
      0xc0 { return $null }
      0xc2 { return $false }
      0xc3 { return $true }
      0xc4 { $kind = 'opaque'; $length = Read-MsgPackLength $bytes $offset 1 }
      0xc5 { $kind = 'opaque'; $length = Read-MsgPackLength $bytes $offset 2 }
      0xc6 { $kind = 'opaque'; $length = Read-MsgPackLength $bytes $offset 4 }
      0xca { $kind = 'opaque'; $length = 4 }
      0xcb { $kind = 'opaque'; $length = 8 }
      0xcc { return (Read-MsgPackLength $bytes $offset 1) }
      0xcd { return (Read-MsgPackLength $bytes $offset 2) }
      0xce { return (Read-MsgPackLength $bytes $offset 4) }
      0xcf { return (Read-MsgPackLength $bytes $offset 8) }
      0xd0 { return (Read-MsgPackLength $bytes $offset 1) }
      0xd1 { return (Read-MsgPackLength $bytes $offset 2) }
      0xd2 { return (Read-MsgPackLength $bytes $offset 4) }
      0xd3 { return (Read-MsgPackLength $bytes $offset 8) }
      0xd9 { $kind = 'string'; $length = Read-MsgPackLength $bytes $offset 1 }
      0xda { $kind = 'string'; $length = Read-MsgPackLength $bytes $offset 2 }
      0xdb { $kind = 'string'; $length = Read-MsgPackLength $bytes $offset 4 }
      0xdc { $kind = 'array'; $length = Read-MsgPackLength $bytes $offset 2 }
      0xdd { $kind = 'array'; $length = Read-MsgPackLength $bytes $offset 4 }
      0xde { $kind = 'map'; $length = Read-MsgPackLength $bytes $offset 2 }
      0xdf { $kind = 'map'; $length = Read-MsgPackLength $bytes $offset 4 }
      default { throw 'Unsupported saved plan backend MessagePack marker.' }
    }
  }
  if ($length -lt 0 -or $length -gt 1000000) {
    throw 'Oversized saved plan backend MessagePack value.'
  }
  if ($kind -eq 'string' -or $kind -eq 'opaque') {
    if ($length -gt ($bytes.Length - $offset.Value)) { throw 'Truncated saved plan backend MessagePack value.' }
    if ($kind -eq 'string') {
      $value = [Text.Encoding]::UTF8.GetString($bytes, $offset.Value, [int]$length)
    } else { $value = $true }
    $offset.Value += [int]$length
    return $value
  }
  if ($kind -eq 'array') {
    $items = [System.Collections.Generic.List[object]]::new()
    for ($i = 0; $i -lt $length; $i++) { $items.Add((Read-MsgPackValue $bytes $offset ($depth + 1))) }
    return ,$items.ToArray()
  }
  if ($kind -eq 'map') {
    $map = [System.Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
    for ($i = 0; $i -lt $length; $i++) {
      $key = Read-MsgPackValue $bytes $offset ($depth + 1)
      if ($key -isnot [string] -or $map.ContainsKey($key)) {
        throw 'Invalid saved plan backend MessagePack map key.'
      }
      $map.Add($key, (Read-MsgPackValue $bytes $offset ($depth + 1)))
    }
    return ,$map
  }
  throw 'Unsupported saved plan backend MessagePack value.'
}

function ConvertTo-LfBytes([byte[]]$bytes) {
  $normalized = [System.Collections.Generic.List[byte]]::new($bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 13 -and $i + 1 -lt $bytes.Length -and $bytes[$i + 1] -eq 10) {
      $normalized.Add([byte]10)
      $i++
    } else {
      $normalized.Add($bytes[$i])
    }
  }
  return ,$normalized.ToArray()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPlan)
try {
  $archivedOverrides = @($archive.Entries | Where-Object {
    $_.FullName.StartsWith('tfconfig/m-/', [System.StringComparison]::Ordinal) -and
    ($_.FullName.Split('/')[-1] -imatch $overrideName)
  })
  if ($archivedOverrides.Count -ne 0) {
    throw "Saved plan contains a Terraform override file: $($archivedOverrides[0].FullName)."
  }
  $core = $archive.GetEntry('tfplan')
  if ($null -eq $core -or $core.Length -gt 50000000) {
    throw 'Saved plan has no bounded Terraform core metadata.'
  }
  $memory = [System.IO.MemoryStream]::new()
  $coreStream = $core.Open()
  try { $coreStream.CopyTo($memory); $coreFields = @(Get-ProtoFields $memory.ToArray()) }
  finally { $coreStream.Dispose(); $memory.Dispose() }
  $backendFields = @($coreFields | Where-Object Number -eq 13)
  if ($backendFields.Count -ne 1) { throw 'Saved plan backend metadata is missing or ambiguous.' }
  $backendParts = @(Get-ProtoFields $backendFields[0].Bytes)
  $kind = @($backendParts | Where-Object Number -eq 1)
  $config = @($backendParts | Where-Object Number -eq 2)
  $workspace = @($backendParts | Where-Object Number -eq 3)
  if ($kind.Count -ne 1 -or $config.Count -ne 1 -or $workspace.Count -ne 1 -or
      [Text.Encoding]::UTF8.GetString($kind[0].Bytes) -cne 's3' -or
      [Text.Encoding]::UTF8.GetString($workspace[0].Bytes) -cne 'default') {
    throw 'Saved plan was not built for the default S3 backend.'
  }
  $dynamic = @(Get-ProtoFields $config[0].Bytes)
  $msgpackFields = @($dynamic | Where-Object Number -eq 1)
  if ($dynamic.Count -ne 1 -or $msgpackFields.Count -ne 1) {
    throw 'Saved plan backend configuration has an unsupported encoding.'
  }
  $cursor = 0
  $backendConfig = Read-MsgPackValue $msgpackFields[0].Bytes ([ref]$cursor) 0
  if ($backendConfig -isnot [System.Collections.Generic.Dictionary[string,object]] -or
      $cursor -ne $msgpackFields[0].Bytes.Length) {
    throw 'Saved plan backend configuration is not one complete map.'
  }
  $requiredBackend = @{
    bucket = 'mcm-ieps-staging-tfstate-195748745315-apne2'
    key = 'mcm-ieps/staging/terraform.tfstate'
    region = 'ap-northeast-2'
    dynamodb_table = 'mcm-ieps-staging-terraform-lock'
  }
  foreach ($name in $requiredBackend.Keys) {
    if (-not $backendConfig.ContainsKey($name) -or
        $backendConfig[$name] -isnot [string] -or
        $backendConfig[$name] -cne $requiredBackend[$name]) {
      throw "Saved plan S3 backend $name differs from staging."
    }
  }
  $allowedNonNull = @('bucket', 'key', 'region', 'dynamodb_table',
                      'encrypt', 'allowed_account_ids')
  foreach ($entry in $backendConfig.GetEnumerator()) {
    if ($null -ne $entry.Value -and $allowedNonNull -cnotcontains $entry.Key) {
      throw "Saved plan S3 backend $($entry.Key) must be unset."
    }
  }
  if (-not $backendConfig.ContainsKey('encrypt') -or $backendConfig['encrypt'] -cne $true) {
    throw 'Saved plan S3 backend encryption must remain enabled.'
  }
  if (-not $backendConfig.ContainsKey('allowed_account_ids')) {
    throw 'Saved plan S3 backend allowed account is missing.'
  }
  $accounts = @($backendConfig['allowed_account_ids'])
  if ($accounts.Count -ne 1 -or [string]$accounts[0] -cne '195748745315') {
    throw 'Saved plan S3 backend allowed account differs from staging.'
  }

  $prior = $archive.GetEntry('tfstate')
  if ($null -eq $prior -or $prior.Length -gt 50000000) {
    throw 'Saved plan has no bounded prior state.'
  }
  $reader = [System.IO.StreamReader]::new($prior.Open())
  try { $priorState = $reader.ReadToEnd() | ConvertFrom-Json }
  finally { $reader.Dispose() }
  if ([string]$priorState.lineage -cne $state.Lineage -or
      $null -eq $priorState.serial -or [long]$priorState.serial -ne $state.Serial) {
    throw 'Saved plan was built from a different Terraform state lineage or serial.'
  }

  $configPrefix = 'tfconfig/m-/'
  $archived = @($archive.Entries | Where-Object {
    $_.FullName.StartsWith($configPrefix, [System.StringComparison]::Ordinal) -and
    ($_.FullName.EndsWith('.tf', [System.StringComparison]::Ordinal) -or
     $_.FullName.EndsWith('.tf.json', [System.StringComparison]::Ordinal))
  })
  $local = @(Get-ChildItem -LiteralPath $directory -File | Where-Object {
    $_.Name.EndsWith('.tf', [System.StringComparison]::Ordinal) -or
    $_.Name.EndsWith('.tf.json', [System.StringComparison]::Ordinal)
  })
  if ($archived.Count -ne $local.Count) {
    throw 'Saved plan configuration file set differs from the clean main checkout.'
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    foreach ($file in $local) {
      $entry = $archive.GetEntry("$configPrefix$($file.Name)")
      if ($null -eq $entry -or $entry.Length -ne $file.Length) {
        throw "Saved plan configuration differs at $($file.Name)."
      }
      $entryStream = $entry.Open()
      $fileStream = [System.IO.File]::OpenRead($file.FullName)
      try {
        $entryHash = [BitConverter]::ToString($sha.ComputeHash($entryStream))
        $fileHash = [BitConverter]::ToString($sha.ComputeHash($fileStream))
      } finally { $entryStream.Dispose(); $fileStream.Dispose() }
      if ($entryHash -cne $fileHash) {
        throw "Saved plan configuration differs at $($file.Name)."
      }
    }
    $lockPath = Join-Path $directory '.terraform.lock.hcl'
    $lockEntry = $archive.GetEntry('.terraform.lock.hcl')
    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf) -or
        $null -eq $lockEntry -or $lockEntry.Length -gt 1000000 -or
        (Get-Item -LiteralPath $lockPath).Length -gt 1000000) {
      throw 'Saved plan provider lockfile differs from the clean main checkout.'
    }
    $entryStream = $lockEntry.Open()
    $entryMemory = [System.IO.MemoryStream]::new()
    try {
      $entryStream.CopyTo($entryMemory)
      $entryHash = [BitConverter]::ToString($sha.ComputeHash((ConvertTo-LfBytes $entryMemory.ToArray())))
      $fileHash = [BitConverter]::ToString($sha.ComputeHash((ConvertTo-LfBytes ([IO.File]::ReadAllBytes($lockPath)))))
    } finally { $entryStream.Dispose(); $entryMemory.Dispose() }
    if ($entryHash -cne $fileHash) {
      throw 'Saved plan provider lockfile differs from the clean main checkout.'
    }
  } finally { $sha.Dispose() }
} finally { $archive.Dispose() }

$planText = & terraform "-chdir=$directory" show -json $resolvedPlan
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the saved Terraform plan.' }
$plan = ($planText -join "`n") | ConvertFrom-Json
if ($null -eq $plan.resource_changes) { throw 'Saved plan has no resource changes.' }
$transitionValue = $plan.variables.r0b_transition_allow_legacy_roles.value
# Terraform 1.9.8 keeps -var=true as the literal string "true" in the plan
# variable input, while fixture plans may contain a JSON boolean.
if (-not (($transitionValue -is [bool] -and $transitionValue) -or
          ($transitionValue -is [string] -and $transitionValue -ceq 'true'))) {
  throw 'Saved plan must explicitly retain legacy roles during R0B transition.'
}
$scheduled = [string]$plan.variables.scheduled_next_task_definition_arn.value
if ($scheduled -cne 'arn:aws:ecs:ap-northeast-2:195748745315:task-definition/mcm-ieps-staging-next:618') {
  throw 'Saved plan does not pin the reviewed Next schedule revision 618.'
}
foreach ($item in @(@('project_name','mcm-ieps'), @('environment','staging'),
                   @('aws_region','ap-northeast-2'), @('db_app_role_name','mcm_app'),
                   @('db_worker_role_name','mcm_worker'))) {
  $v = $plan.variables.PSObject.Properties[$item[0]]
  if ($null -ne $v -and [string]$v.Value.value -cne $item[1]) {
    throw "Unexpected Terraform variable $($item[0])."
  }
}

function Assert-PolicyDocument([object]$change, [string]$address) {
  $raw = [string]$change.change.after.policy
  if ([string]::IsNullOrWhiteSpace($raw)) {
    if ($change.change.after_unknown.policy -cne $true) {
      throw "Policy body is absent from the plan at $address."
    }
    # New role/secret ARNs may be unknown until apply. The exact archived HCL
    # bytes and variables controlling these policy targets were checked above.
    return
  }
  $policy = $raw | ConvertFrom-Json
  if ($policy.Version -cne '2012-10-17' -or
      ((@($policy.PSObject.Properties.Name | Sort-Object) -join '|') -cne 'Statement|Version')) {
    throw "Unexpected policy document shape at $address."
  }
  $statements = @($policy.Statement)
  if ($address -ceq 'aws_iam_role_policy.worker_access') {
    if ($statements.Count -ne 1 -or $statements[0].Effect -cne 'Allow' -or
        (@($statements[0].PSObject.Properties.Name | Sort-Object) -join '|') -cne 'Action|Effect|Resource') {
      throw 'Worker access policy shape changed.'
    }
    $actions = @($statements[0].Action | Sort-Object)
    $wanted = @('sqs:ChangeMessageVisibility','sqs:DeleteMessage','sqs:GetQueueAttributes','sqs:ReceiveMessage')
    if (($actions -join '|') -cne ($wanted -join '|') -or
        (@($statements[0].Resource) -join '|') -cne 'arn:aws:sqs:ap-northeast-2:195748745315:mcm-ieps-staging-jobs') {
      throw 'Worker access policy grants unreviewed permissions.'
    }
  }
  if ($address -cin @('aws_iam_role_policy.adt_ingest_events',
                      'aws_iam_role_policy.intel_batch_events',
                      'aws_iam_role_policy.facility_quality_worker_start')) {
    if ($statements.Count -ne 2) { throw "Policy statement count changed at $address." }
    $pass = @($statements | Where-Object { @($_.Action) -ccontains 'iam:PassRole' })
    $run = @($statements | Where-Object { @($_.Action) -ccontains 'ecs:RunTask' })
    if ($pass.Count -ne 1 -or $run.Count -ne 1 -or $pass[0].Effect -cne 'Allow' -or
        $run[0].Effect -cne 'Allow' -or
        (@($pass[0].Action) -join '|') -cne 'iam:PassRole' -or
        (@($run[0].Action) -join '|') -cne 'ecs:RunTask' -or
        (@($pass[0].PSObject.Properties.Name | Sort-Object) -join '|') -cne 'Action|Condition|Effect|Resource' -or
        (@($run[0].PSObject.Properties.Name | Sort-Object) -join '|') -cne 'Action|Condition|Effect|Resource' -or
        (@($pass[0].Condition.PSObject.Properties.Name) -join '|') -cne 'StringEquals' -or
        (@($run[0].Condition.PSObject.Properties.Name) -join '|') -cne 'ArnEquals' -or
        $pass[0].Condition.StringEquals.'iam:PassedToService' -cne 'ecs-tasks.amazonaws.com') {
      throw "PassRole policy shape changed at $address."
    }
    $cluster = 'arn:aws:ecs:ap-northeast-2:195748745315:cluster/mcm-ieps-staging'
    $family = if ($address -ceq 'aws_iam_role_policy.facility_quality_worker_start') { 'worker' } else { 'next' }
    $task = "arn:aws:ecs:ap-northeast-2:195748745315:task-definition/mcm-ieps-staging-${family}:*"
    if ((@($run[0].Resource) -join '|') -cne $task -or
        $run[0].Condition.ArnEquals.'ecs:cluster' -cne $cluster) {
      throw "RunTask boundary changed at $address."
    }
    $actual = @($pass[0].Resource | Sort-Object)
    $legacyTask = 'arn:aws:iam::195748745315:role/mcm-ieps-staging-ecs-task'
    $legacyExec = 'arn:aws:iam::195748745315:role/mcm-ieps-staging-ecs-execution'
    if ($address -ceq 'aws_iam_role_policy.facility_quality_worker_start') {
      $wanted = @($legacyTask, $legacyExec,
        'arn:aws:iam::195748745315:role/mcm-ieps-staging-ecs-task-worker',
        'arn:aws:iam::195748745315:role/mcm-ieps-staging-ecs-execution-worker') | Sort-Object
    } else {
      $wanted = @($legacyTask, $legacyExec,
        'arn:aws:iam::195748745315:role/mcm-ieps-staging-ecs-execution-next') | Sort-Object
    }
    if (($actual -join '|') -cne ($wanted -join '|')) {
      throw "PassRole targets changed at $address."
    }
  }
}

$expected = @{
  'aws_iam_role.ecs_task_execution_next'                = 'create'
  'aws_iam_role.ecs_task_execution_worker'              = 'create'
  'aws_iam_role.ecs_task_worker'                         = 'create'
  'aws_iam_role_policy.adt_ingest_events'                = 'update'
  'aws_iam_role_policy.ecs_task_execution_next_secrets' = 'create'
  'aws_iam_role_policy.ecs_task_execution_worker_secrets' = 'create'
  'aws_iam_role_policy.facility_quality_worker_start'   = 'update'
  'aws_iam_role_policy.intel_batch_events'              = 'update'
  'aws_iam_role_policy.worker_access'                    = 'create'
  'aws_iam_role_policy_attachment.ecs_task_execution_next'   = 'create'
  'aws_iam_role_policy_attachment.ecs_task_execution_worker' = 'create'
  'aws_secretsmanager_secret.db_app'                     = 'create'
  'aws_secretsmanager_secret.db_worker'                  = 'create'
}

$seen = @{}
$creates = 0
$updates = 0
$imports = 0
$movedSeen = $false
foreach ($change in @($plan.resource_changes)) {
  $actions = @($change.change.actions)
  if ($actions.Count -ne 1) { throw "Unexpected action count at $($change.address)." }
  $action = [string]$actions[0]
  if ($action -ceq 'no-op') {
    if ($null -ne $change.change.importing) { throw "Unexpected import at $($change.address)." }
    if ($null -ne $change.previous_address -and
        ($change.address -cne 'aws_iam_role_policy.ecs_task_execution_secrets[0]' -or
         $change.previous_address -cne 'aws_iam_role_policy.ecs_task_execution_secrets')) {
      throw "Unexpected moved state address at $($change.address)."
    }
    if ($null -ne $change.previous_address) { $movedSeen = $true }
    continue
  }
  $address = [string]$change.address
  if ($null -ne $change.previous_address) { throw "Unexpected moved state address at $address." }
  if (-not $expected.ContainsKey($address)) { throw "Unapproved Terraform change at $address." }
  if ($action -cne $expected[$address]) { throw "Unapproved Terraform action at $address." }
  if ($seen.ContainsKey($address)) { throw "Duplicate Terraform change at $address." }
  $seen[$address] = $true

  if ($address.StartsWith('aws_iam_role_policy.', [System.StringComparison]::Ordinal)) {
    Assert-PolicyDocument $change $address
  }
  if ($action -ceq 'create') { $creates++ }
  if ($action -ceq 'update') { $updates++ }

  if ($address -ceq 'aws_iam_role_policy.facility_quality_worker_start') {
    if ($change.change.importing.id -cne 'mcm-ieps-staging-ecs-task:mcm-ieps-staging-facility-quality-worker-start') {
      throw 'Existing facility worker policy is not being imported.'
    }
    $imports++
  } elseif ($null -ne $change.change.importing) {
    throw "Unexpected import at $address."
  }
}

$missing = @($expected.Keys | Where-Object { -not $seen.ContainsKey($_) })
if ($missing.Count -gt 0) { throw "Expected Terraform changes are missing: $($missing -join ', ')." }
if ($creates -ne 10 -or $updates -ne 3 -or $imports -ne 1 -or -not $movedSeen) {
  throw 'R0B change totals do not match the reviewed plan.'
}
Write-Output "r0b-terraform-plan-ok:imports=$imports;creates=$creates;updates=$updates;deletes=0"
