# 노트북 개발환경 셋업 체크리스트

사무실 PC 외 기기(여행용 노트북 등)에서 MCM 개발을 이어가기 위한 준비 문서.
설치 명령 모음은 [scripts/laptop-setup.ps1](../scripts/laptop-setup.ps1) 참고 — `powershell -ExecutionPolicy Bypass -File scripts\laptop-setup.ps1` 로 일괄 실행 가능.

## 0. 아키텍처 요약 — 왜 이 목록인가

- **로컬 개발 DB는 로컬 PostgreSQL이 아니다.** `frontend/.env.local`의 `PGHOST=localhost / PGPORT=15432`는
  bastion(EC2) 경유 **SSM 포트포워딩 터널**로 staging Aurora에 붙는 것. → 노트북에 PostgreSQL 설치·데이터 덤프 **불필요**.
- 코드는 전부 git에 있고, **git에 없는 것은 시크릿 파일 3개**뿐(아래 2절).
- AWS 인증은 SSO라 액세스 키 복사가 필요 없다. 노트북에서 프로필 등록 + 브라우저 로그인만 하면 된다.
- `data/`(~14GB)는 IEPS 원본 아카이브라 개발에 불필요. OCR 파싱 테스트가 필요하면 샘플 PDF 몇 개만 챙긴다.

## 1. 도구 설치

| 도구 | 버전 기준(사무실 PC) | 용도 | 필수 여부 |
|---|---|---|---|
| Git | 2.x | 코드 | 필수 |
| Node.js | v22 LTS | frontend / scraper | 필수 |
| AWS CLI v2 | 2.x | SSO·배포·터널 | 필수 |
| **Session Manager Plugin** | 최신 | SSM 포트포워딩(DB 터널) | **필수** — 잊기 쉬움 |
| Claude Code | 최신 | AI 페어 | 권장 |
| GitHub CLI (`gh`) | 최신 | push 인증·PR | 권장 |
| Docker Desktop | 최신 | 스테이징 배포 이미지 빌드 | 배포 시 |
| Python | **3.11** (시스템 3.13 아님) | backend OCR·scripts | backend 작업 시 |

## 2. 코드 + 시크릿 복사

- [ ] `git clone <repo>` 후 `gh auth login`(또는 기존 git 자격증명)으로 push 확인
- [ ] **시크릿 파일 복사** — git에 없으므로 USB 또는 암호관리자로 직접 전달(이메일·메신저 평문 전송 금지):
  - [ ] `frontend/.env.local` — DB 접속·NextAuth·네이버/공공데이터 API 키
  - [ ] `backend/.env` — OpenAI 키 등 (backend 작업 시)
  - [ ] `infra/aws/staging.tfvars` — Terraform 작업 시에만
- [ ] `data/` 폴더는 복사하지 않는다 (필요 시 샘플 PDF만)

## 3. AWS SSO 프로필

```powershell
aws configure sso
# SSO session name : mcm-kesi (아무 이름)
# Start URL / Region: 사무실 PC의 ~/.aws/config 값 그대로
# 계정: 195748745315, 리전: ap-northeast-2, 프로필명: mcm-kesi-staging
```

> 가장 간단한 방법: 사무실 PC의 **`~/.aws/config` 파일을 통째로 복사**(시크릿 아님, SSO 설정만 있음).

- [ ] `aws sso login --profile mcm-kesi-staging` → 브라우저 인증 통과
- [ ] `aws sts get-caller-identity --profile mcm-kesi-staging` 로 확인

## 4. 의존성 설치

```powershell
# frontend (필수)
cd frontend; npm install

# scraper (스크래퍼 작업 시)
cd scraper; npm install; npx playwright install chromium

# backend (OCR 작업 시에만 — torch/paddle 포함 수 GB, 시간 오래 걸림)
cd backend
py -3.11 -m venv venv311
.\venv311\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 5. DB 연결 (SSM 터널) — 개발 서버 띄우는 순서

staging 리소스는 on-demand 토글([infra/aws/ops/README.md](../infra/aws/ops/README.md))이므로 순서대로.
**①~③은 [scripts/db-tunnel.ps1](../scripts/db-tunnel.ps1) 한 번으로 끝난다**(SSO 만료 확인 → bastion 기동 → 포트포워딩까지 자동, 이미 열려 있으면 그대로 둔다):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1
powershell -ExecutionPolicy Bypass -File scripts\db-tunnel.ps1 -Stop   # 작업 끝나면 터널만 닫기
```

아래는 그 스크립트가 대신 해 주는 수동 절차(디버깅용 참고):

```powershell
# ① SSO 로그인 + bastion 기동
aws sso login --profile mcm-kesi-staging
.\infra\aws\ops\staging-start.ps1 -Bastion    # OCR도 쓰면 -Backend 추가

# ② bastion 인스턴스 ID + RDS 엔드포인트 조회
$env:AWS_PROFILE = "mcm-kesi-staging"
$bastionId = aws ec2 describe-instances --region ap-northeast-2 `
  --filters "Name=tag:Name,Values=mcm-ieps-staging-bastion" "Name=instance-state-name,Values=running" `
  --query "Reservations[0].Instances[0].InstanceId" --output text
$rdsHost = aws rds describe-db-clusters --region ap-northeast-2 `
  --db-cluster-identifier mcm-ieps-staging --query "DBClusters[0].Endpoint" --output text

# ③ 포트포워딩 터널 (이 창은 열어둔 채 유지)
aws ssm start-session --target $bastionId --region ap-northeast-2 `
  --document-name AWS-StartPortForwardingSessionToRemoteHost `
  --parameters "host=$rdsHost,portNumber=5432,localPortNumber=15432"

# ④ 새 창에서 dev 서버
cd frontend
npm run dev        # .env.local의 PG* 값 사용
# 또는 npm run dev:aws  (RDS 마스터 시크릿을 Secrets Manager에서 받아 사용)
```

- Aurora는 min 0 ACU auto-pause — **첫 쿼리가 수 초~수십 초 걸릴 수 있음**(자동 재개), 오류 아님.
- 작업 종료 시 `.\infra\aws\ops\staging-stop.ps1` 로 내려서 비용 절약.

## 6. 배포 (여행 중 주의사항)

- 배포 절차는 [CLAUDE.md](../CLAUDE.md) "빌드 / 배포" 절 그대로 (고정 태그 → 새 태스크 정의 리비전 → `update-service`).
- **`next` 이미지(프론트)는 노트북에서 무리 없음.**
- **backend OCR 이미지(~15GB)는 여행지 회선으로 푸시 비추천** — 백엔드 배포가 꼭 필요하면 사무실 PC 원격 접속(Tailscale/RDP)을 백업 수단으로 준비.
- `.dockerignore`가 `data/`·venv를 제외하는지 확인(노트북엔 어차피 없음).

## 7. 출발 전 리허설 (노트북에서 전부 통과할 것)

- [ ] `aws sso login` → `sts get-caller-identity` 성공
- [ ] bastion 기동 + SSM 터널 → `npm run dev` → 브라우저에서 로그인 + DB 조회 화면(계약/사업장 목록) 표시
- [ ] 사소한 커밋 1개 `git push` 성공
- [ ] (배포 예정이면) `next` 이미지 빌드→ECR 푸시→서비스 업데이트 1회 성공
- [ ] Claude Code 로그인 및 이 저장소에서 동작 확인

## 부록 — 원격 접속 백업 (방법 B)

노트북 셋업이 본안, 아래는 백업:

- 사무실 PC와 노트북에 **Tailscale**(개인 무료) 설치 → RDP 또는 VS Code Remote Tunnels(`code tunnel`)로 접속.
- 사무실 PC 전원 옵션에서 절전 해제, Windows 업데이트 자동 재부팅 유의.
- 용도: backend 15GB 이미지 배포, `data/` 원본 참조 등 노트북에서 무거운 작업.
