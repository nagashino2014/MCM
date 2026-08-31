# laptop-setup.ps1 — 노트북 개발환경 일괄 설치 스크립트
# 사용법 (repo 루트에서):
#   powershell -ExecutionPolicy Bypass -File scripts\laptop-setup.ps1                # 필수 도구 + frontend 의존성
#   powershell -ExecutionPolicy Bypass -File scripts\laptop-setup.ps1 -Scraper       # + scraper 의존성 (Playwright 포함)
#   powershell -ExecutionPolicy Bypass -File scripts\laptop-setup.ps1 -Backend       # + backend Python 3.11 venv (수 GB, 오래 걸림)
#   powershell -ExecutionPolicy Bypass -File scripts\laptop-setup.ps1 -SkipTools     # 도구 설치 건너뛰고 npm/pip만
# 체크리스트 본문: docs/laptop-setup-checklist.md

param(
  [switch]$Scraper,
  [switch]$Backend,
  [switch]$SkipTools
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

# ── 1. 도구 설치 (winget) ──────────────────────────────────────────
if (-not $SkipTools) {
  Write-Host "== 도구 설치 (winget) ==" -ForegroundColor Cyan

  $tools = @(
    @{ Id = "Git.Git";                       Name = "Git" },
    @{ Id = "OpenJS.NodeJS.LTS";             Name = "Node.js LTS (v22)" },
    @{ Id = "Amazon.AWSCLI";                 Name = "AWS CLI v2" },
    @{ Id = "Amazon.SessionManagerPlugin";   Name = "Session Manager Plugin (SSM 터널 필수)" },
    @{ Id = "GitHub.cli";                    Name = "GitHub CLI" },
    @{ Id = "Docker.DockerDesktop";          Name = "Docker Desktop (배포용)" }
  )
  if ($Backend) {
    $tools += @{ Id = "Python.Python.3.11"; Name = "Python 3.11 (backend venv 용)" }
  }

  foreach ($t in $tools) {
    Write-Host ("-- {0} ({1})" -f $t.Name, $t.Id)
    winget install --id $t.Id --exact --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      Write-Warning ("{0} 설치 실패 또는 이미 설치됨 (exit {1}) — 계속 진행" -f $t.Name, $LASTEXITCODE)
    }
  }

  Write-Host "-- Claude Code (npm 글로벌)"
  npm install -g @anthropic-ai/claude-code
  if ($LASTEXITCODE -ne 0) { Write-Warning "Claude Code 설치 실패 — Node 설치 후 새 셸에서 재시도" }

  Write-Host "`n※ winget 설치 직후에는 PATH 반영을 위해 새 터미널을 여는 것이 안전하다." -ForegroundColor Yellow
}

# ── 2. frontend 의존성 (필수) ─────────────────────────────────────
Write-Host "`n== frontend: npm install ==" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "frontend")
try {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "frontend npm install 실패" }
} finally { Pop-Location }

# ── 3. scraper 의존성 (-Scraper) ──────────────────────────────────
if ($Scraper) {
  Write-Host "`n== scraper: npm install + Playwright chromium ==" -ForegroundColor Cyan
  Push-Location (Join-Path $repoRoot "scraper")
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "scraper npm install 실패" }
    npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "playwright chromium 설치 실패" }
  } finally { Pop-Location }
}

# ── 4. backend Python venv (-Backend) ─────────────────────────────
if ($Backend) {
  Write-Host "`n== backend: Python 3.11 venv + requirements (수 GB) ==" -ForegroundColor Cyan
  Push-Location (Join-Path $repoRoot "backend")
  try {
    py -3.11 -m venv venv311
    if ($LASTEXITCODE -ne 0) { throw "Python 3.11 venv 생성 실패 — py -3.11 확인" }
    & .\venv311\Scripts\python.exe -m pip install --upgrade pip
    & .\venv311\Scripts\python.exe -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "backend pip install 실패" }
  } finally { Pop-Location }
}

# ── 5. 남은 수동 단계 안내 ─────────────────────────────────────────
Write-Host @"

== 설치 완료. 남은 수동 단계 (docs/laptop-setup-checklist.md 참고) ==
 1. 시크릿 복사: frontend/.env.local, backend/.env, infra/aws/staging.tfvars
 2. AWS SSO:    aws configure sso  (프로필 mcm-kesi-staging) → aws sso login
 3. git 인증:   gh auth login
 4. DB 터널:    powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1  → npm run dev
"@ -ForegroundColor Green
