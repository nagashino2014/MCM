# infra/aws/ops — 스테이징 비용 절감 운영 스크립트

개발자 1인용 staging 환경이 프로덕션급 리소스를 24/7 상시 가동해 **월 ~$380(≈50만원)** 이 나오던 것을,
"쓸 때만 켜는" on-demand 토글로 낮추기 위한 스크립트.

## 사용법 (PowerShell)

repo 루트에서 실행한다. `pwsh`(PowerShell 7)가 아니라 **Windows 기본 PowerShell 5.1** 로 돈다
(스크립트가 `#Requires -Version 5.1`). 실행 파일 이름이 `powershell.exe` 라 `pwsh` 는 없는 게 정상.

```powershell
# 하루 작업 끝 / 당분간 안 씀 → 내리기
.\infra\aws\ops\staging-stop.ps1

# 다시 작업 → 올리기 (기본: Aurora + next 웹만)
.\infra\aws\ops\staging-start.ps1

# OCR/파싱 필요 시 백엔드도
.\infra\aws\ops\staging-start.ps1 -Backend

# DB 직접접속(SSM 포워딩) 필요 시 bastion 도
.\infra\aws\ops\staging-start.ps1 -Backend -Bastion
```

전제: `AWS_PROFILE=mcm-kesi-staging` SSO 로그인 상태(`aws sso login --profile mcm-kesi-staging`).

- 실행 정책에 막히면: `powershell -ExecutionPolicy Bypass -File .\infra\aws\ops\<스크립트>.ps1`
- `aws scheduler` 서브커맨드는 **AWS CLI v2** 에 있다(`aws --version` 확인).
- ⚠ `.ps1` 은 **UTF-8 BOM 으로 저장**한다. PS 5.1 은 BOM 없는 UTF-8 을 CP949 로 해석해 한글 로그가 깨진다.

## DB 마이그레이션 적용

```powershell
.\infra\aws\ops\staging-apply-migrations.ps1                     # 기본: 200~204(근태 이벤트·식대)
.\infra\aws\ops\staging-apply-migrations.ps1 -Files 205_foo.sql  # 특정 파일만
.\infra\aws\ops\staging-apply-migrations.ps1 -KeepTunnel         # 적용 후 터널 유지
```

bastion SSM 포트포워딩(localhost:15432)을 통해 psql 로 `infra/aws/NNN_*.sql` 을 적용한다.
터널이 없으면 bastion 기동(stopped 면 start)부터 터널까지 자동으로 열고, 끝나면 자동
기동분만 정리한다. 접속 정보는 RDS 매니지드 마스터 시크릿에서 받는다(파일 저장 없음).
전제: psql 클라이언트 + Session Manager plugin 설치, SSO 로그인 상태.

## next(웹) 재배포

```powershell
.\infra\aws\ops\staging-deploy-next.ps1              # 빌드 → ECR 푸시 → 새 리비전 → 서비스 갱신
.\infra\aws\ops\staging-deploy-next.ps1 -Wait        # 배포 안정화까지 대기
```

태스크 정의가 `:latest` 가 아니라 **고정 태그**를 가리켜서 `force-new-deployment` 만으로는 반영되지
않는다(옛 태그로 재시작될 뿐). 스크립트가 CLAUDE.md 의 절차(빌드 → 푸시 → image 만 바꾼 새 리비전
등록 → update-service)를 그대로 수행한다. 프론트 전용 변경은 next 이미지만 재배포하면 된다.

## 자동 스케줄 → **해제됨** (2026-08-14 설치, 같은 날 해제)

next 는 현재 **24/7 상시 가동**한다. 자동 정지 스케줄은 삭제했다:

```powershell
.\infra\aws\ops\staging-schedule-setup.ps1 -Remove
```

**왜 껐나** — 평일 22:00 정지가 야간 작업을 끊었다(첫날 바로 503). 그런데 상시 가동의 비용
대부분은 Fargate(월 ~$20)가 아니라 **Aurora ACU** 였다. next 안의 주기 틱(`instrumentation.ts`)이
5분마다 설정 테이블을 조회해 **auto-pause(유휴 300초)가 영영 발동하지 못하던 것**이 원인.
틱이 캐시된 설정으로 "할 일 없음" 을 먼저 판정하게 고쳐(`frontend/lib/tick-cache.ts`) 유휴
시간대 auto-pause 를 되살렸고, 상시 가동 추가 비용이 **월 ~$34 → ~$10 대**로 내려갔다.

- 되돌리려면(다시 자동 정지) 인자 없이 재실행: `.\infra\aws\ops\staging-schedule-setup.ps1`
  → 매일 08:00 기동 / 평일 22:00·주말 20:00 정지 (Asia/Seoul).
- 그룹 `mcm-ieps-staging-ops` 와 IAM 롤 `mcm-ieps-staging-scheduler` 는 남겨뒀다(재설치 편의).
- 당분간 안 쓸 때 수동으로 내리는 건 종전대로 `staging-stop.ps1`.

### ⚠ 틱을 새로 추가할 때
`instrumentation.ts` 에 주기 타이머를 추가하면 **매 틱마다 DB 를 열지 않도록** 사전 판정을
캐시로 처리해야 한다(`lib/tick-cache.ts` 규칙 참고). 안 그러면 Aurora 가 24시간 깨어 있어
월 ~$50 이 조용히 붙는다. ALB 헬스체크(`/api/health`)가 DB 를 안 건드리는 것과 같은 이유다.

## 무엇을 끄고 켜나

| 리소스 | stop | start | 절감(월, 대략) |
|---|---|---|---|
| ECS `next` (0.5vCPU/1GB) | desired 0 | desired 1 | ~$18 |
| ECS `backend` OCR (2vCPU/8GB) | desired 0 | `-Backend` 시 1 | ~$85 |
| bastion t3.micro | stop | `-Bastion` 시 start | ~$18 |
| Aurora Serverless v2 (min 0 ACU) | 커넥션 끊기면 자동 pause | 첫 커넥션에 자동 재개 | ~$50 |

## Aurora auto-pause (min 0 ACU)
클러스터가 `min_capacity=0` + `seconds_until_auto_pause=300` 으로 설정돼 있다(infra/aws/main.tf).
- ECS 가 내려가 **DB 커넥션이 0** 이 되면 300초 뒤 자동 일시정지 → ACU 컴퓨트 과금 **$0**.
- 커넥션이 다시 들어오면 **수 초 내 자동 재개**. 별도 stop/start 명령·7일 재시작 제약 없음.
- 그래서 스크립트는 Aurora 를 직접 건드리지 않는다(ECS 를 내리면 자동으로 pause 됨).

## 네트워크 구성 (NAT 제거됨)
NAT Gateway 는 비용 절감을 위해 **제거**했다(2026-07-02). 대신:
- ECS(next/backend)·bastion 은 **public subnet + public IP** 로 IGW 직결 아웃바운드를 쓴다.
  인바운드는 SG 로 차단(ecs=ALB/self, bastion=egress only)되어 안전.
- private subnet 에는 RDS 만 남고 아웃바운드 경로 없음.
- ⚠ **worker 를 `aws ecs run-task` 로 띄울 때는 반드시 public subnet + `assignPublicIp=ENABLED`** 로 지정해야
  외부 IEPS 사이트 스크래핑(Playwright) 아웃바운드가 된다(과거엔 NAT 로 나갔음).

## 주의
- **완전 중단이 아니다.** 아래 고정 리소스는 stop 후에도 계속 과금된다(합계 월 ~$25):
  - ALB(~$16), 유휴 태스크 없으면 public IPv4 과금도 없음, EBS/S3 스토리지·Route53 등.
- `start` 후 next 태스크 기동 + ALB 헬스체크 통과까지 1~3분 걸린다.

## 참고: 이미 정리한 것
- 도쿄(ap-northeast-1) `futureops-proxy-aws` t3.micro(방치된 코인거래앱 마이그레이션 잔재) **종료 + EIP 해제 완료**
  (2026-07-02). 월 ~$14 절감. futureops 재마이그레이션은 차후 서울 리전으로 진행 예정.
