# infra/aws/ops — 스테이징 비용 절감 운영 스크립트

개발자 1인용 staging 환경이 프로덕션급 리소스를 24/7 상시 가동해 **월 ~$380(≈50만원)** 이 나오던 것을,
"쓸 때만 켜는" on-demand 토글로 낮추기 위한 스크립트.

## 사용법 (PowerShell)

```powershell
# 하루 작업 끝 / 당분간 안 씀 → 내리기
pwsh infra/aws/ops/staging-stop.ps1

# 다시 작업 → 올리기 (기본: Aurora + next 웹만)
pwsh infra/aws/ops/staging-start.ps1

# OCR/파싱 필요 시 백엔드도
pwsh infra/aws/ops/staging-start.ps1 -Backend

# DB 직접접속(SSM 포워딩) 필요 시 bastion 도
pwsh infra/aws/ops/staging-start.ps1 -Backend -Bastion
```

전제: `AWS_PROFILE=mcm-kesi-staging` SSO 로그인 상태(`aws sso login --profile mcm-kesi-staging`).

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
