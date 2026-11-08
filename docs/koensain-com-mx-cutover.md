# koensain.com MX 전환(아마란스 → SES) 절차서

작성 2026-11-04. 아마란스10 해지에 맞춰 `koensain.com` 수신을 아마란스(`mail.bizboxa.com`)에서 MCM(SES)으로 옮긴다.
설계 배경은 [company-email-com-domain-phase1.md](company-email-com-domain-phase1.md) §9(2단계).

> **상태(2026-11-08): 전환 완료.** MX는 SES로 공개됐고 338·339를 적용했다. 남은 일은 §3-2 백업 가져오기(해지 11월 말 전)와 §3-4 해지 뒤 정리다. 실제 진행과 Wix에서 겪은 문제는 §5에 적었다.

## 1. 왜 지금 옮기나 — 수신 누락 진단(2026-11-04)

"아마란스에는 메일이 오는데 MCM 메일함에는 안 들어온다"는 보고를 읽기 전용으로 조사했다.

- MCM 쪽 수신 경로(SES 수신 규칙·`koensain.app` MX·S3·SQS·next 수신 틱)는 정상이다. CloudTrail에 10-01 이후 SES·Route53 변경은 없었다.
- 수신 버킷 원문(90일 보관분 56건)에 아마란스 자동 전달을 거친 메일이 **0건**이다. 1단계 설계의 "아마란스 자동 전달 → `.app`" 경로는 한 번도 동작하지 않았다.
- MCM에 있던 `.com` 메일은 전부 **아마란스 백업 ZIP 가져오기**(10-16, 11-02, 수동)로 들어온 것이었다. 가져온 메일 중 마지막 수신분이 10-30이라, 그 뒤로 "안 들어오는 것처럼" 보였다.

아마란스를 해지하면 자동 전달도 사라지므로 전달을 고치지 않고 MX를 SES로 옮긴다.

## 2. 준비도 점검 — 주소가 다른 사람

[ops/mail-com-cutover-readiness.sql](../infra/aws/ops/mail-com-cutover-readiness.sql)(읽기 전용)로 지금까지 메일에 나온 `.com` 주소가 전환 뒤 어디로 배달되는지 본다.

- 설계안의 "`.com` 앞자리 = 앱 이메일 앞자리" 가정은 **10명에게 맞지 않았다**(예: 정해원 아마란스 `haewon` ↔ 앱 `ssss8008`).
  이 사람들의 아마란스 주소 14개는 마이그레이션 **339**가 보조 주소로 원장에 더한다. 대조 근거는 가져온 메일의 받는 사람 표시 이름(이름/직급/부서)이다.
  - 이홍길은 앱 주소 `shied202001`이 오타다(2026-11-05 사용자 확인, 아마란스·개인 메일은 `shield202001`). 339는 메일 주소 관리에서 `shield202001@koensain.com`을 대표로 바꾸기 전이든 후든 통과한다. 로그인 아이디(`email_local`)는 메일 주소와 별개다.
- 수신 처리기(`lib/mail/inbound.ts`)는 이제 원장에 없는 `.com` 주소도 앱 앞자리·별칭으로 찾는다(`.app`과 같은 규칙).
- 남는 미배달 주소(MCM 계정이 없는 사람). 전환 뒤 이 주소로 온 메일은 **반송 없이 사라진다**(S3 원문만 90일 남음).
  - 퇴사자로 보이는 주소: 이정열·황태준·방경석·장문석(2개)·심만용·이정란·표지연·김태건·최현우·신석헌·조상현
  - 재직 여부 확인 필요: 전점식(`jjs3857`, 울산지사장), 이주연(`jylee4085`, 전문위원)
  - 김명호(`kmhgork`)는 가져온 메일에 아마란스 주소가 보이지 않는다. 아마란스 관리자 화면에서 실제 주소를 확인한다.
- 처리 방법: ① 필요한 주소만 별칭(`mail_aliases`)으로 담당자에게 돌린다, ② 그대로 둔다(퇴사자 메일 유실 허용).
  - **결정(2026-11-08, 사용자): ② 그대로 둔다.** 재직 여부 확인 대상 2명도 퇴직자였고, 김명호는 아마란스 주소가 없다. 별칭은 추가하지 않는다.

## 3. 순서

### 3-1. 사전 준비(언제든, 전환 전)

1. 이 PR을 main에 머지한다.
2. 마이그레이션 339를 적용하고 next를 배포한다. 339를 적용하면 앱에서 옛 주소(예: `haewon@`)로 보낸 메일이 아마란스 대신 그 사람의 앱 메일함으로 간다. 대표 주소로 보낼 때와 같은 동작이다.
   - ADT·intel 배치는 고정 revision(현재 754)에 남고 서비스만 새 revision으로 이동한다.

   ```powershell
   git fetch origin
   git checkout main
   git pull origin main
   $env:AWS_PROFILE = "mcm-kesi-staging"
   .\infra\aws\ops\staging-apply-migrations.ps1 -Files 339_mail_com_amaranth_addresses.sql
   .\infra\aws\ops\staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait
   ```
3. SES 수신 규칙에 `koensain.com`을 더한다(Terraform `-target`). MX가 바뀌기 전에는 `.com` 메일이 SES로 오지 않으므로 미리 해 둬도 안전하다.
   - 메인 체크아웃의 `infra/aws`(옛 로컬 state)에서 실행하지 말고 origin/main 분리 worktree에서 실행한다.
   - 2026-11-04 plan 확인: `aws_ses_receipt_rule.store` recipients에 `koensain.com` 추가 1건, **0 add · 1 change · 0 destroy**. 적용 직전 plan에 다른 주소가 보이면 중단한다.

   ```powershell
   $env:AWS_PROFILE = "mcm-kesi-staging"
   $td = "arn:aws:ecs:ap-northeast-2:195748745315:task-definition/mcm-ieps-staging-next:754"
   terraform plan "-var-file=C:\CodingProject\MCM\infra\aws\staging.tfvars" -var r0b_transition_allow_legacy_roles=true -var "scheduled_next_task_definition_arn=$td" -var enable_extra_domain_inbound=true -target=aws_ses_receipt_rule.store -out=mx2.tfplan
   terraform apply mx2.tfplan
   ```
   이후 이 worktree에서 다른 `-target` apply를 할 때도 `-var enable_extra_domain_inbound=true`를 빼면 수신자에서 `.com`이 빠진다.
4. §2의 미배달 주소 처리를 결정한다.

### 3-2. 과거 메일 옮기기(해지 전)

- 직원별로 아마란스 환경설정 → 메일함 관리에서 받은·보낸·사용자 메일함을 백업(ZIP)하고, MCM 메일 → 메일 가져오기로 올린다.
- 11-04 기준 가져온 사람은 이재영·이태하·정해원 3명뿐이다(점검 SQL 3번). 같은 메일은 Message-ID로 한 번만 들어가므로 전환 당일 마지막 백업을 한 번 더 올려도 된다.
- 11-08 재조회도 같은 3명이었다(이근형은 1건 시작 후 취소). 나머지 재직자는 아마란스 메일을 쓰지 않은 것으로 본다(사용자 판단). 아마란스 해지는 11월 말이다.
- 아마란스 인증 실패가 24시간에 10회 쌓이면 메일 인증이 자동으로 꺼진다. 비밀번호를 반복해 넣지 않는다.

### 3-3. 전환 당일

1. (전날) Wix에서 `koensain.com` MX의 TTL을 가능한 만큼 줄인다(Wix 기본 1시간).
2. Wix DNS에서 `koensain.com` MX를 바꾼다.
   - 추가: `10 inbound-smtp.ap-northeast-2.amazonaws.com`
   - 삭제: `30 mail.bizboxa.com`
   - apex SPF·`bounce.koensain.com`·DKIM·`_amazonses`·DMARC는 건드리지 않는다.
   - ⚠ Wix 편집기로는 이 변경을 의도대로 할 수 없었다(§5-2). 저장할 때마다 Wix 권한 서버에서 루트와 `bounce`를 함께 확인하고(`nslookup -type=MX koensain.com ns10.wixdns.net`), 공개되기 전에는 다음 수정을 하지 않는다.
3. 루트 MX가 SES 하나로 공개된 것을 확인한 뒤 바로 마이그레이션 338을 적용한다. 앱에서 동료 `.com` 주소로 보내는 메일이 SES로 바로 가게 된다(사내 단락 해제).

   ```powershell
   $env:AWS_PROFILE = "mcm-kesi-staging"
   .\infra\aws\ops\staging-apply-migrations.ps1 -Files 338_mail_com_inbound_ses.sql
   ```
4. 확인
   - `nslookup -type=MX koensain.com 8.8.8.8`에 SES 주소만 보인다.
   - 외부(Gmail·네이버)에서 `.com` 주소 2~3개(옛 주소 포함, 예: `haewon@koensain.com`)로 보낸다 → 1분 안에 S3 원문이 생기고 MCM 받은편지함에 도착한다.

     ```bash
     aws s3api list-objects-v2 --bucket mcm-ieps-staging-mail-inbound --prefix inbound/ --query "sort_by(Contents,&LastModified)[-5:].[LastModified,Key]" --output text --profile mcm-kesi-staging --region ap-northeast-2
     ```
   - next 로그에 `[mail-inbound] 수신자 mailbox 없음`이 `.com` 주소로 찍히면 §2의 미배달 주소다.
5. DNS 캐시 때문에 몇 시간은 일부 메일이 아마란스로 간다. 아마란스 해지는 **최소 하루 뒤**에 하고, 그 전에 마지막 백업을 가져온다.

### 3-4. 해지 뒤 정리

- apex SPF에서 아마란스 IP(`ip4:210.181.95.209`)를 뺀다. 다우오피스·Google 항목은 계속 쓰는지 확인하고 정리한다.
- DMARC 보고서(rua)를 2~4주 지켜본 뒤 `p=quarantine`을 검토한다.

## 4. 되돌리기

- Wix MX를 `30 mail.bizboxa.com`으로 되돌리고(아마란스를 아직 해지하지 않았을 때만 의미가 있다), `UPDATE mail_domains SET inbound_mode = 'external' WHERE domain = 'koensain.com'`.
- 수신 규칙의 `.com`은 남겨 둬도 무해하다(MX가 아마란스면 SES로 오지 않음).
- 339 보조 주소는 남겨 둔다(되돌린 상태에서도 사내 단락이 옛 주소를 앱으로 배달한다).

## 5. 진행 기록(2026-11-08)

### 5-1. 순서와 결과

| 시각(KST) | 작업 | 결과 |
|---|---|---|
| 오후 | PR #117 머지, 339 적용 | 적용 전 읽기 전용 미리보기로 14개 주소가 각각 메일함 1개에 대응하고 충돌이 없음을 확인. 적용 뒤 14행 `is_primary=0` |
| 오후 | next 배포 | next:797, 메일 게이트웨이 같은 이미지(:78) |
| 17:07 | SES 수신 규칙 `-target` apply | `store-and-notify` 수신자에 `koensain.com` 추가(0 추가·1 변경·0 삭제). state 버전 `XsFtU6NL…`(serial 9) → `2sASDRQP…` |
| 17시대 | Wix MX 변경 시도 | §5-2의 문제로 여러 번 다시 고침 |
| 약 17:50~19:40 | **반송 구간** | Wix가 루트 MX를 `10 feedback-smtp…amazonses.com` + `40 inbound-smtp…`으로 공개. `feedback-smtp`는 `.com` 수신자를 `550 Mailbox does not exist`로 거부하므로, 이 사이 외부에서 `.com`으로 보낸 메일은 보낸 사람에게 반송됐을 수 있다 |
| 19:40 | 공개 정상화 | 루트 `40 inbound-smtp.ap-northeast-2.amazonaws.com` 하나, `bounce` `10 feedback-smtp…` 하나(Wix 권한 서버 2곳·8.8.8.8·1.1.1.1 일치) |
| 19:4x | 338 적용 | `koensain.com` `inbound_mode=ses` |
| 19:47 | 외부 수신 확인 | 네이버 → `kaikan00@koensain.com`이 S3를 거쳐 MCM 받은편지함에 도착(SPF·스팸·바이러스 PASS). 옛 주소 `haewon@`은 SMTP `RCPT TO` 250까지만 확인 |

- 우선순위는 Wix 편집 창에서 바꿀 수 없어 10이 아니라 40으로 남았다. MX가 하나뿐이라 동작에는 영향이 없다.
- TTL을 전날 줄이는 단계(§3-3 1)는 건너뛰었다. 해지가 11월 말이라 그 사이 아마란스로 간 메일은 백업으로 옮긴다.

### 5-2. Wix DNS 편집기의 함정

- `koensain.com` MX는 DNS 화면의 **메일함(OTHER) → 메일함 관리** 창에서만 바꿀 수 있다. **기타 MX 레코드** 표는 호스트 칸 뒤에 `.koensain.com`이 고정이라 하위 도메인만 넣을 수 있다(`@`·빈칸 거부).
- 메일함 관리 창은 루트와 `bounce.koensain.com`의 MX를 한 목록으로 보여 주고, 저장할 때 섞어 쓴다.
  - 루트 줄의 대상만 `mail.bizboxa.com` → `inbound-smtp…`으로 고쳐 저장했더니 루트는 그대로였다. 대신 `bounce`에 `30 inbound-smtp…`이 새로 생겨 1분 안에 공개됐다.
  - 창에서 지운 줄이 저장 뒤에도 남는다. 같은 주소 값(`feedback-smtp…`)이 다른 줄(`bounce`)에 있으면 삭제가 반영되지 않는 것으로 보인다. 값이 하나뿐인 `mail.bizboxa.com`은 지워졌다.
- Wix 화면 값과 권한 서버 값이 수십 분 동안 다를 수 있다. 화면에 남은 잘못된 값이 40~60분 뒤에 공개돼 §5-1의 반송 구간이 생겼다. SOA serial(`2016112212`)은 바뀌지 않으므로 공개 여부는 레코드 값으로만 판단한다.
- 저장하면 "외부 비즈니스 이메일이 연결되었습니다" 알림이 뜨지만, 의도대로 저장됐다는 뜻은 아니다.
- 다음에 MX를 바꿀 일이 있으면 Wix 편집기를 쓰기 전에 DNS를 Route53으로 옮기는 것을 검토한다.

### 5-3. 반송 확인 방법(시험 메일 없이)

공개 MX 서버가 받는 사람을 받아 주는지 SMTP 대화로만 확인한다(`DATA` 전 `RSET`·`QUIT`).

```powershell
$c = New-Object System.Net.Sockets.TcpClient; $c.Connect("inbound-smtp.ap-northeast-2.amazonaws.com", 25)
$s = $c.GetStream(); $r = New-Object IO.StreamReader($s); $w = New-Object IO.StreamWriter($s); $w.NewLine = "`r`n"; $w.AutoFlush = $true
$r.ReadLine(); $w.WriteLine("EHLO probe.koensain.app"); do { $l = $r.ReadLine() } while ($l -match '^\d{3}-')
$w.WriteLine("MAIL FROM:<probe@koensain.app>"); $r.ReadLine()
$w.WriteLine("RCPT TO:<haewon@koensain.com>"); $r.ReadLine()   # 250 Ok 여야 한다
$w.WriteLine("QUIT"); $c.Close()
```
