param([string]$Profile = 'mcm-kesi-staging', [string]$Region = 'ap-northeast-2')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$frontendRoot = Join-Path $repoRoot 'frontend'
$infoCode = "import {loadLocalIntelligenceEnvironment} from './scripts/local-intelligence-environment.mjs'; const cfg=await loadLocalIntelligenceEnvironment(); const u=new URL(cfg.sourceDatabaseUrl); console.log(JSON.stringify({host:u.hostname,port:u.port,database:u.pathname}));"
Push-Location $frontendRoot
try { $sourceInfo = (& node --input-type=module -e $infoCode) | ConvertFrom-Json; if ($LASTEXITCODE -ne 0) { throw '수집 DB 설정을 확인하지 못했습니다.' } } finally { Pop-Location }
if ($sourceInfo.host -notin @('localhost','127.0.0.1','[::1]') -or $sourceInfo.port -ne '15432') { throw '원본 수집 DB는 인증된 localhost:15432 터널 연결만 지원합니다. 직접 원격 연결은 허용하지 않습니다.' }
if (Get-NetTCPConnection -State Listen -LocalPort 15432 -ErrorAction SilentlyContinue) { Write-Output '기존 수집 DB 연결을 사용합니다.'; return }
$aws = 'C:/Program Files/Amazon/AWSCLIV2/aws.exe'
$pluginDir = 'C:/Program Files/Amazon/SessionManagerPlugin/bin'
if (!(Test-Path -LiteralPath $aws) -or !(Test-Path -LiteralPath (Join-Path $pluginDir 'session-manager-plugin.exe'))) { throw 'AWS CLI와 Session Manager Plugin이 필요합니다.' }
$env:PATH = $pluginDir + ';' + $env:PATH
$endpoint = & $aws rds describe-db-clusters --db-cluster-identifier mcm-ieps-staging --profile $Profile --region $Region --query 'DBClusters[0].Endpoint' --output text
if ($LASTEXITCODE -ne 0 -or !$endpoint) { throw '수집 DB 위치를 확인하지 못했습니다. AWS 로그인을 확인하세요.' }
$instance = & $aws ec2 describe-instances --profile $Profile --region $Region --filters 'Name=tag:Name,Values=mcm-ieps-staging-bastion' 'Name=instance-state-name,Values=running' --query 'Reservations[].Instances[].InstanceId | [0]' --output text
if ($LASTEXITCODE -ne 0 -or $instance -eq 'None' -or !$instance) { throw '수집 DB 접속용 인스턴스를 확인하지 못했습니다.' }
$outputRoot = Join-Path $frontendRoot '.next/local-intelligence-demo'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$parameters = Join-Path $outputRoot 'source-tunnel-parameters.json'
@{host=@($endpoint.Trim());portNumber=@('5432');localPortNumber=@('15432')} | ConvertTo-Json -Compress | Set-Content -LiteralPath $parameters -Encoding utf8
$arguments = 'ssm start-session --target '+$instance.Trim()+' --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters file://"'+$parameters+'" --profile '+$Profile+' --region '+$Region
$tunnel = Start-Process -FilePath $aws -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput (Join-Path $outputRoot 'source-tunnel.log') -RedirectStandardError (Join-Path $outputRoot 'source-tunnel-error.log') -PassThru
@{pid=$tunnel.Id;port=15432} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $outputRoot 'source-tunnel-process.json') -Encoding utf8
for ($attempt=0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -State Listen -LocalPort 15432 -ErrorAction SilentlyContinue) { Write-Output '수집 DB 읽기 연결을 준비했습니다.'; return }
  if ($tunnel.HasExited) { throw '수집 DB 연결을 열지 못했습니다. source-tunnel-error.log를 확인하세요.' }
}
throw '수집 DB 연결 준비 시간이 지났습니다.'
