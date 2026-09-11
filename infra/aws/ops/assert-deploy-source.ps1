#Requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$RepoRoot)
$ErrorActionPreference = 'Stop'

# 운영에만 존재하는 미커밋 UI가 다음 main 배포에서 사라진 사고(2026-09-11) 방지.
# 원격 갱신은 호출자가 수행한다. 이 검사는 네트워크/배포 동작을 하지 않는다.
$tracked = @(git -C $RepoRoot diff --name-only HEAD)
if ($LASTEXITCODE -ne 0) { throw '배포 소스 변경 조회 실패' }
$untracked = @(git -C $RepoRoot ls-files --others --exclude-standard -- frontend scraper data/ksic .dockerignore)
if ($LASTEXITCODE -ne 0) { throw '미추적 빌드 입력 조회 실패' }
if ($tracked.Count -or $untracked.Count) {
  throw ('미커밋 변경이 있습니다. 사용자 승인 후 커밋·main 통합·푸시를 완료하세요. 변경 파일 수: ' + ($tracked.Count + $untracked.Count))
}
git -C $RepoRoot merge-base --is-ancestor HEAD origin/main
if ($LASTEXITCODE -ne 0) { throw '현재 커밋이 origin/main에 없습니다. main 통합·푸시 후 배포하세요.' }
git -C $RepoRoot merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw '최신 origin/main 커밋이 누락됐습니다. 최신 main을 가져온 뒤 배포하세요.' }
Write-Host '[deploy] 소스 가드: 미커밋 빌드 변경 없음, HEAD = origin/main'
