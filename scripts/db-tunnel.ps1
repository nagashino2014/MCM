# db-tunnel.ps1 — staging Aurora 로 가는 SSM 포트포워딩 터널을 연다 (여러 번 실행해도 안전)
# 사용법 (repo 루트에서):
#   powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1          # 터널 열기(이미 열려 있으면 그대로 둠)
#   powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1 -Stop    # 이 스크립트가 연 터널 닫기
#
# 로컬 앱은 localhost:15432 를 DB 로 본다. 그 포트를 bastion 을 거쳐 Aurora 5432 로
# 이어 주는 것이 이 터널이다. 터널이 없으면 로그인부터 실패한다.
# 필요한 것: AWS CLI + session-manager-plugin + SSO 프로필(mcm-kesi-staging).

param(
  [string]$AwsProfile = "mcm-kesi-staging",
  [string]$Region = "ap-northeast-2",
  [string]$ClusterIdentifier = "mcm-ieps-staging",
  [string]$BastionName = "mcm-ieps-staging-bastion",
  [int]$LocalPort = 15432,
  [switch]$Stop      # 터널 닫기
)

$ErrorActionPreference = "Stop"
$pidFile = Join-Path $env:TEMP "mcm-db-tunnel-$LocalPort.pid"

function Log($m) { Write-Host "[tunnel] $m" -ForegroundColor DarkCyan }
function Fail($m) { Write-Host "[tunnel] $m" -ForegroundColor Red }

# aws CLI 호출. ErrorActionPreference=Stop 상태에서 네이티브 stderr 가 예외로 바뀌는 것을
# 막기 위해 이 안에서만 Continue 로 낮춘다. 성공 여부는 $LASTEXITCODE 로 본다.
function Invoke-Aws {
  param([string[]]$AwsArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & aws @AwsArgs --profile $AwsProfile --region $Region 2>&1
  } finally {
    $ErrorActionPreference = $prev
  }
  return ($out | Out-String)
}

# 터널이 살아 있는지는 포트가 열려 있는지로 판단한다(Test-NetConnection 은 느리다).
function Test-TunnelPort {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $LocalPort, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(700)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if ($Stop) {
  if (Test-Path $pidFile) {
    $tunnelPid = (Get-Content $pidFile | Select-Object -First 1).Trim()
    if (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue) {
      Stop-Process -Id $tunnelPid -Force
      Log "터널을 닫았습니다 (PID $tunnelPid)"
    }
    Remove-Item $pidFile -Force
  } else {
    Log "이 스크립트가 연 터널이 없습니다."
  }
  exit 0
}

if (Test-TunnelPort) {
  Log "이미 localhost:$LocalPort 로 터널이 열려 있습니다."
  exit 0
}

foreach ($cmd in @("aws", "session-manager-plugin")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Fail "'$cmd' 가 설치돼 있지 않습니다."
    if ($cmd -eq "aws") {
      Write-Host "         AWS CLI: https://awscli.amazonaws.com/AWSCLIV2.msi"
    } else {
      Write-Host "         Session Manager plugin: https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe"
    }
    exit 1
  }
}

$env:AWS_PROFILE = $AwsProfile

# SSO 세션은 하루 정도면 만료된다. 만료돼 있으면 브라우저 로그인 창을 띄운다.
Invoke-Aws @("sts", "get-caller-identity", "--output", "text") | Out-Null
if ($LASTEXITCODE -ne 0) {
  Log "SSO 세션이 만료됐습니다. 브라우저에서 로그인하세요."
  & aws sso login --profile $AwsProfile
  if ($LASTEXITCODE -ne 0) { Fail "aws sso login 실패."; exit 1 }
}

# bastion 은 평소 꺼 둔다(월 ~$18). 꺼져 있으면 켜고 SSM 에 등록될 때까지 기다린다.
$found = Invoke-Aws @(
  "ec2", "describe-instances",
  "--filters", "Name=tag:Name,Values=$BastionName", "Name=instance-state-name,Values=pending,running,stopping,stopped",
  "--query", "Reservations[].Instances[].[InstanceId,State.Name]", "--output", "text"
)
if ($LASTEXITCODE -ne 0) { Fail "bastion 조회 실패: $found"; exit 1 }

$line = ($found -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
if (-not $line) { Fail "bastion 인스턴스를 찾지 못했습니다: $BastionName"; exit 1 }
$parts = $line.Trim() -split "\s+"
$instanceId = $parts[0]
$state = $parts[1]

if ($state -ne "running") {
  Log "bastion 기동: $instanceId (현재 $state) — 1~2분 걸립니다."
  Invoke-Aws @("ec2", "start-instances", "--instance-ids", $instanceId, "--no-cli-pager") | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "bastion 기동 실패."; exit 1 }
  Invoke-Aws @("ec2", "wait", "instance-running", "--instance-ids", $instanceId) | Out-Null
} else {
  Log "bastion 가동 중: $instanceId"
}

Log "SSM 에이전트 연결 대기..."
$online = $false
for ($i = 0; $i -lt 60; $i++) {
  $ping = Invoke-Aws @(
    "ssm", "describe-instance-information",
    "--filters", "Key=InstanceIds,Values=$instanceId",
    "--query", "InstanceInformationList[0].PingStatus", "--output", "text"
  )
  if ($LASTEXITCODE -eq 0 -and $ping.Trim() -eq "Online") { $online = $true; break }
  Start-Sleep -Seconds 3
}
if (-not $online) {
  Fail "bastion 이 SSM 에 등록되지 않았습니다(3분 대기). 잠시 뒤 다시 실행해 보세요."
  exit 1
}

$rdsHost = (Invoke-Aws @(
  "rds", "describe-db-clusters",
  "--db-cluster-identifier", $ClusterIdentifier,
  "--query", "DBClusters[0].Endpoint", "--output", "text"
)).Trim()
if ($LASTEXITCODE -ne 0 -or -not $rdsHost -or $rdsHost -eq "None") {
  Fail "RDS 엔드포인트를 찾지 못했습니다: $ClusterIdentifier"
  exit 1
}

# 터널 프로세스는 앱이 떠 있는 동안 계속 살아 있어야 하므로 별도 프로세스로 띄운다.
$sessionArgs = @(
  "ssm", "start-session",
  "--target", $instanceId,
  "--profile", $AwsProfile,
  "--region", $Region,
  "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
  "--parameters", "host=$rdsHost,portNumber=5432,localPortNumber=$LocalPort"
)
$proc = Start-Process -FilePath "aws" -ArgumentList $sessionArgs -WindowStyle Hidden -PassThru

for ($i = 0; $i -lt 40; $i++) {
  if (Test-TunnelPort) { break }
  if ($proc.HasExited) { Fail "터널 프로세스가 바로 종료됐습니다(exit $($proc.ExitCode))."; exit 1 }
  Start-Sleep -Milliseconds 500
}
if (-not (Test-TunnelPort)) {
  Fail "터널이 20초 안에 열리지 않았습니다."
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  exit 1
}

Set-Content -Path $pidFile -Value $proc.Id -Encoding ASCII
Log "연결됨: localhost:$LocalPort -> ${rdsHost}:5432 (PID $($proc.Id))"
exit 0
