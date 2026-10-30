#Requires -Version 5.1
<#
.SYNOPSIS
  ADT·intel 스케줄이 고정된 next revision 의 이미지에 schedule-pin-<rev> 보호 태그를 붙인다.

.DESCRIPTION
  ECR 수명주기 정책(ecr.tf)은 schedule-pin-* 태그 이미지를 개수 규칙에서 제외한다. buildx 이미지는
  이미지 묶음(index) + 플랫폼 매니페스트 + 출처 증명으로 나뉘고, 하위 매니페스트는 태그가 없어
  묶음에만 태그를 달면 하위가 만료돼 pull 이 깨진다. 그래서 묶음과 하위 매니페스트 모두에 태그를 단다:
    schedule-pin-<rev>              (태스크 정의가 가리키는 매니페스트)
    schedule-pin-<rev>-<digest 12>  (index 의 하위 매니페스트마다)
  매니페스트는 바이트 그대로 다시 올리고 --image-digest 로 digest 일치를 강제한다(새 이미지가 생기지 않음).
  이미 붙어 있으면 건너뛴다(멱등). 스케줄을 새 revision 으로 다시 고정할 때마다 실행한다.

.EXAMPLE
  .\infra\aws\ops\staging-protect-pinned-image.ps1 -Revision 745
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern("^[1-9][0-9]*$")][string]$Revision,
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region = "ap-northeast-2"
)

$ErrorActionPreference = "Stop"
$family = "mcm-ieps-staging-next"
$repo = "mcm-ieps-staging-next"
$mediaTypes = @("application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json")
$tmp = Join-Path ([IO.Path]::GetTempPath()) "mcm-pin-manifest-$PID.json"

function Log($m) { Write-Host "[protect-pin] $m" }

function Invoke-Aws([string[]]$AwsArguments) {
  $previousPreference = $ErrorActionPreference
  try {
    # PS 5.1 은 Stop 상태에서 native stderr 를 오류로 취급한다 — Continue + 종료 코드로 판정.
    $ErrorActionPreference = "Continue"
    $raw = & aws @AwsArguments --profile $AwsProfile --region $Region --no-cli-pager --output json 2>&1
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previousPreference }
  return @{ Code = $code; Text = ($raw | Out-String) }
}

function Get-Manifest([string]$Digest) {
  $r = Invoke-Aws (@("ecr", "batch-get-image", "--repository-name", $repo, "--image-ids", "imageDigest=$Digest", "--accepted-media-types") + $mediaTypes)
  if ($r.Code -ne 0) { throw "batch-get-image 실패($Digest): $($r.Text)" }
  # 같은 digest 에 태그가 여럿이면 태그마다 한 항목씩 온다(매니페스트는 동일).
  $img = @(($r.Text | ConvertFrom-Json).images | Where-Object { $_.imageId.imageDigest -ceq $Digest })
  if ($img.Count -lt 1) { throw "매니페스트를 찾지 못함: $Digest" }
  return $img[0]
}

function Add-PinTag([string]$Digest, [string]$Tag) {
  $img = Get-Manifest $Digest
  # 바이트 보존: 문자열을 BOM 없는 UTF-8 로 그대로 쓴다(개행 추가 시 digest 가 달라진다).
  [IO.File]::WriteAllBytes($tmp, (New-Object Text.UTF8Encoding($false)).GetBytes([string]$img.imageManifest))
  $r = Invoke-Aws @("ecr", "put-image", "--repository-name", $repo, "--image-tag", $Tag,
    "--image-manifest", "file://$tmp", "--image-manifest-media-type", [string]$img.imageManifestMediaType, "--image-digest", $Digest)
  if ($r.Code -eq 0) { Log "태그 추가: $Tag -> $Digest"; return $img }
  if ($r.Text -match "ImageAlreadyExistsException") { Log "이미 있음: $Tag"; return $img }
  throw "put-image 실패($Tag): $($r.Text)"
}

try {
  $td = Invoke-Aws @("ecs", "describe-task-definition", "--task-definition", "${family}:$Revision")
  if ($td.Code -ne 0) { throw "태스크 정의 조회 실패: ${family}:$Revision" }
  $image = [string](($td.Text | ConvertFrom-Json).taskDefinition.containerDefinitions[0].image)
  Log "revision $Revision image: $image"

  if ($image -match "@(sha256:[0-9a-f]{64})\z") {
    $digest = $Matches[1]
  } elseif ($image -match ":([^:/@]+)\z") {
    $d = Invoke-Aws @("ecr", "describe-images", "--repository-name", $repo, "--image-ids", "imageTag=$($Matches[1])")
    if ($d.Code -ne 0) { throw "ECR 에 이미지가 없습니다: $image — 이 revision 은 고정 대상으로 쓸 수 없습니다" }
    $digest = [string](($d.Text | ConvertFrom-Json).imageDetails[0].imageDigest)
  } else { throw "이미지 참조 형식을 해석하지 못함: $image" }

  $root = Add-PinTag $digest "schedule-pin-$Revision"
  $manifest = [string]$root.imageManifest | ConvertFrom-Json
  foreach ($child in @($manifest.manifests)) {
    if (-not $child.digest) { continue }
    $short = ([string]$child.digest).Substring(7, 12)
    Add-PinTag ([string]$child.digest) "schedule-pin-$Revision-$short" | Out-Null
  }
  Log "완료 — staging-assert-next-schedules-pinned.ps1 로 확인"
} finally {
  Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
}
