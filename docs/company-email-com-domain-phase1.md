# koensain.com 메일 1단계 — SES 발신 전환 + 앱 다중 도메인 지원 설계안

> 작성 2026-10-15 · 상위 설계: [company-email-blueprint.md](company-email-blueprint.md)
> 상태: **설계안(미구현)**. 아마란스 주소 목록 수령 후 §2 매핑부터 확정한다.

## 0. 목표와 범위

- **목표**: 직원이 MCM 웹메일에서 `@koensain.com` 주소로 발신하게 한다. 발주처 그룹웨어·전자조달시스템에서 `.app` 발신이 차단되는 문제를 피한다.
- **1단계 범위**: 발신 주소만 전환한다. **koensain.com MX는 아마란스(`mail.bizboxa.com`)에 그대로 둔다** — 아마란스 메일은 계속 동작한다.
- **범위 밖(2단계)**: koensain.com MX를 SES로 옮기는 일, 아마란스 메일 데이터 이관, koensain.com 별칭(`sales@` 등).
- **전환 단위는 사람**: 메일함마다 "대표 발신 주소"를 바꾼다. 데이터만 바꾸므로 사람별로 즉시 되돌릴 수 있다.

## 1. 현재 상태 (2026-10-15 실측)

### 1.1 DNS (공개 조회, 8.8.8.8)

| 항목 | koensain.app (MCM) | koensain.com (아마란스) |
|---|---|---|
| 네임서버 | Route53 (Terraform `data.aws_route53_zone.main`) | **Wix** (`ns10/ns11.wixdns.net`) |
| MX | `10 inbound-smtp.ap-northeast-2.amazonaws.com` | `30 mail.bizboxa.com` (211.34.213.8) |
| SPF | `v=spf1 include:amazonses.com ~all` | `v=spf1 ip4:210.181.95.209 include:_spf.daouoffice.com include:_spf.google.com ~all` |
| DMARC | `p=none; adkim=s; aspf=s` + rua | **없음** |
| 기타 | — | `google-site-verification` TXT, `gw.koensain.com` A 211.46.114.36 |

- `210.181.95.209`의 역방향 이름은 `ptr.bizboxa.com`이므로 **아마란스 발신 IP**다.
- ⚠ **SPF DNS 조회 횟수(한도 10)**: `_spf.daouoffice.com`이 1회 + 하위 include 7회 = 8회, `_spf.google.com`이 1회로 **현재 9회**다. 여기에 `include:amazonses.com`을 더하면 **딱 10회**가 되어 여유가 없다. 다우오피스를 더 이상 쓰지 않는다면 `include:_spf.daouoffice.com`을 빼서 8회를 확보하는 것을 권한다(§4.2).

### 1.2 앱 코드 — 단일 도메인 전제

| 위치 | 현재 동작 | 1단계 영향 |
|---|---|---|
| [mailbox.ts:10](../frontend/lib/mail/mailbox.ts) `MAIL_DOMAIN` | env 1개(기본 `koensain.app`) | 의미를 "SES 수신 도메인"으로 한정 |
| [mailbox.ts](../frontend/lib/mail/mailbox.ts) `ensureMailbox` | `address = local@MAIL_DOMAIN` 1개 생성 | 주소 원장(§3)에도 함께 기록 |
| [send.ts:113-161](../frontend/lib/mail/send.ts) | From·SES Source = `mailbox.address`, Message-ID = `@MAIL_DOMAIN` | From = 대표 주소, Message-ID는 From 도메인, 사내 수신자 단락(§5.3) |
| [inbound.ts:69-95](../frontend/lib/mail/inbound.ts) `parseNotification` | 수신자를 `mail.destination`(**MIME 헤더 To/Cc**)에서 읽음 | **봉투 수신자 `receipt.recipients`로 교체**(§5.2) |
| [inbound.ts:122-128](../frontend/lib/mail/inbound.ts) `resolveRecipients` | `도메인 === MAIL_DOMAIN`인 로컬파트만 매칭 | 주소 원장 전체 주소로 매칭 |
| [directory.ts](../frontend/lib/directory.ts)·[letter/send.ts](../frontend/lib/letter/send.ts)·[agreement/send.ts](../frontend/lib/agreement/send.ts)·[board.ts:254](../frontend/lib/board.ts) | `COALESCE(mb.address, email_local@MAIL_DOMAIN 또는 개인 메일)` | `mb.address`가 대표 주소이므로 **수정 불필요**(§3.2) |
| [aliases.ts](../frontend/lib/mail/aliases.ts) | `alias_local@MAIL_DOMAIN` | 1단계는 `.app` 유지(변경 없음) |
| [MailComposePage.tsx:207](../frontend/components/mail/MailComposePage.tsx) 전체답장 | 내 주소 1개만 제외 | 내 메일함의 **모든 주소** 제외 |
| [MailComposePage.tsx:412,471](../frontend/components/mail/MailComposePage.tsx)·[MailAliasManager.tsx:27](../frontend/components/mail/MailAliasManager.tsx) | `@koensain.app` 하드코딩 | 대표 주소 도메인으로 |
| [ApprovalLetterBoard.tsx:1503](../frontend/components/approval/ApprovalLetterBoard.tsx)·[LetterReviewModal.tsx:176](../frontend/components/approval/LetterReviewModal.tsx) | 옵션 문구 "회사 메일(@koensain.app)" | "회사 메일"로(도메인 표기 제거) |
| [send.ts:138](../frontend/lib/mail/send.ts) 추적 픽셀·[large-attachments.ts:130](../frontend/lib/mail/large-attachments.ts) 대용량 링크 | 본문 URL = `APP_PUBLIC_URL`(https://koensain.app) | §6 — 본문 링크에 `.app`이 남는 문제 |
| IAM [ecs.tf:157](../infra/aws/ecs.tf) | `ses:SendEmail/SendRawEmail` on `*` | 변경 불필요 |

**부수 결함(이번에 함께 해소)**: 수신자를 헤더에서 읽기 때문에 ① **숨은참조(Bcc)로 받은 메일은 유실**되고("수신자 mailbox 없음"으로 삭제), ② 봉투에 없는 사내 주소를 헤더에 적은 메일도 그 주소의 받은편지함에 들어간다. 1단계의 회신 수신 경로(§5.1)도 봉투 기준 매칭이 있어야 동작한다.

## 2. 주소 매핑 (아마란스 목록 수령 후 확정)

- 거래처가 알고 있는 주소는 **아마란스 주소**다. koensain.com 대표 주소의 로컬파트는 **아마란스 계정을 그대로** 쓴다(예: `kaikan00@koensain.com`).
- 앱의 기존 `.app` 로컬파트(개인 메일 앞자리 승계, `users.email_local`)는 **보조 수신 주소로 유지**한다. 이미 `.app`으로 주고받던 상대가 있으므로 지우지 않는다.
- 매핑표(직원 → 아마란스 주소) 작성 기준:
  - 재직자 전원 + 아마란스 공용 계정(있다면 목록에 표시. 1단계에서는 개인 메일함에 붙이지 않는다).
  - 아마란스 주소가 없는 직원은 1단계 대상에서 빼고 `.app`을 유지한다.
  - 로컬파트 중복·대소문자는 소문자로 정규화(`normalizeLocalPart`)한 뒤 검사한다.
- 매핑은 마이그레이션에 넣지 않는다. 관리자 화면(§5.5) 또는 1회성 스크립트로 등록한다(직원 실명·주소를 저장소에 커밋하지 않음).

## 3. 데이터 모델 — 마이그레이션 `280_mail_multi_domain.sql`(가번호)

> 번호는 커밋 직전 `git fetch` 후 원격 전 브랜치의 `infra/aws/`를 다시 확인한다(2026-10-15 기준 최대 279).

### 3.1 테이블

```sql
-- 메일 도메인 — inbound_mode: ses = MX 가 SES(앱이 직접 수신) / external = 외부 MX(아마란스 등).
CREATE TABLE IF NOT EXISTS mail_domains (
  domain        text PRIMARY KEY,               -- 소문자
  inbound_mode  text NOT NULL CHECK (inbound_mode IN ('ses', 'external')),
  send_enabled  integer NOT NULL DEFAULT 0,     -- SES identity 검증·DKIM 성공 후 1
  note          text,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

-- 메일함 주소 원장 — 한 메일함이 여러 주소를 가진다. is_primary = 발신 대표 주소(메일함당 1개).
CREATE TABLE IF NOT EXISTS mailbox_addresses (
  address     text PRIMARY KEY,                 -- 소문자 전체 주소
  mailbox_id  text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  domain      text NOT NULL REFERENCES mail_domains(domain),
  local_part  text NOT NULL,
  is_primary  integer NOT NULL DEFAULT 0,
  source      text NOT NULL DEFAULT 'legacy' CHECK (source IN ('legacy', 'amaranth', 'manual')),
  created_at  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_addresses_primary
  ON mailbox_addresses(mailbox_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_mailbox_addresses_mailbox ON mailbox_addresses(mailbox_id);
```

시드·백필(멱등):
- `mail_domains`: `koensain.app`(ses, send_enabled=1), `koensain.com`(external, send_enabled=**0**) — SES 검증이 끝나면 관리자가 1로 바꾼다.
- `mailbox_addresses`: 기존 `mailboxes.address` 전부를 `is_primary=1, source='legacy'`로 넣는다(`ON CONFLICT DO NOTHING`).

### 3.2 `mailboxes.address`의 의미 — "대표 주소 캐시"로 유지

- `mailboxes.address`는 지금처럼 남기고, 대표 주소를 바꿀 때 **같은 트랜잭션에서 함께 갱신**한다.
- 그러면 이 컬럼을 읽는 기존 코드(주소록·공문 참조자·계약 발송·발신 From)는 **수정 없이 `.com`을 보여 준다**. 수정 범위를 최소화하는 선택이다.
- `mailboxes.local_part`(UNIQUE)는 바꾸지 않는다. `.app` 수신 로컬파트로 남긴다(lazy 생성·`email_local` 경로와의 호환).
- 불변식: `mailboxes.address = (해당 메일함의 is_primary=1 주소)`. 대표 주소 변경은 `setPrimaryAddress()` 한 함수만 쓰게 한다.

### 3.3 대표 주소 전환 조건
- 대상 도메인의 `send_enabled = 1`
- 주소가 `mailbox_addresses`에 등록돼 있고 다른 메일함이 쓰지 않음(PK로 보장)
- 전환 이력은 기존 감사 로그 관례대로 남긴다(누가·언제·이전→이후).

## 4. DNS·SES (사용자 작업 + Terraform `-target`)

### 4.1 SES identity — 새 파일 `infra/aws/ses-mail-com.tf`
- 변수 `extra_send_domain`(기본 `""`) → `count`로 생성한다. **Route53 레코드는 만들지 않는다**(DNS는 Wix).
- 리소스:
  - `aws_ses_domain_identity.extra` (koensain.com)
  - `aws_ses_domain_dkim.extra`
  - `aws_ses_domain_mail_from.extra` (`bounce.koensain.com`, `behavior_on_mx_failure = "UseDefaultValue"`)
  - `aws_ses_identity_notification_topic` Bounce/Complaint → **기존** `aws_sns_topic.ses_bounce/ses_complaint` 재사용
  - `output "extra_domain_dns_records"` — Wix에 입력할 레코드 목록을 출력
- `aws_ses_domain_identity_verification`은 넣지 않는다. Wix 입력 전에는 apply가 최대 45분 대기하므로, 검증은 콘솔이나 `aws sesv2 get-email-identity`로 확인한다.
- 적용: CLAUDE.md "Terraform·Next 배포 경계"에 따라 **전체 apply 금지**. 위 주소만 `-target`으로 지정하고, plan에서 그 밖의 변경(특히 MX·SES koensain.app·Route53·bastion)이 없을 때만 진행한다.

### 4.2 Wix DNS에 입력할 레코드(사용자 작업)

| 이름 | 타입 | 값 | 비고 |
|---|---|---|---|
| `<token1~3>._domainkey` | CNAME ×3 | `<token>.dkim.amazonses.com` | Terraform output 값 |
| `_amazonses` | TXT | 검증 토큰 | 보조 검증(SES v1 identity) |
| `bounce` | MX | `10 feedback-smtp.ap-northeast-2.amazonses.com` | Custom MAIL FROM |
| `bounce` | TXT | `v=spf1 include:amazonses.com ~all` | |
| `@` (apex) | TXT | **기존 SPF를 수정**: `v=spf1 ip4:210.181.95.209 include:_spf.google.com include:amazonses.com ~all` | 다우오피스 미사용이 확인되면 이 형태. 계속 쓰면 daouoffice를 유지하고 amazonses를 덧붙인다(조회 10회, 여유 없음) |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:<.app과 같은 수신 주소>; fo=1; adkim=r; aspf=r` | **관측 모드**. koensain.com은 아마란스·구글이 함께 발신하므로 `.app`과 달리 relaxed로 시작 |

주의:
- **apex TXT에 SPF 레코드를 두 개 만들면 SPF가 무효**가 된다. 기존 레코드를 고쳐야 한다. `google-site-verification` TXT는 그대로 둔다.
- **MX(`@`)는 건드리지 않는다** — 아마란스 수신 유지.
- Wix에서 서브도메인 MX(`bounce`)를 입력할 수 없으면 MAIL FROM을 생략한다. 이 경우 Return-Path가 `amazonses.com`이 되어 SPF 정렬은 실패하지만, **DKIM 정렬로 DMARC는 통과**한다.
- DMARC는 rua 리포트에서 아마란스·SES 발신이 모두 통과하는 것을 2~4주 확인한 뒤 `quarantine`으로 올린다(2단계 판단 항목).

## 5. 앱 변경

### 5.1 회신 수신 경로 — 1단계의 핵심 제약
MX가 아마란스에 있으므로 **외부에서 `x@koensain.com`으로 보낸 회신은 아마란스로 들어간다**. 앱에서 회신을 보려면 다음 중 하나가 필요하다.

| 방식 | 내용 | 판단 |
|---|---|---|
| **A. 아마란스 자동전달(권장)** | 아마란스에서 사용자마다 `x(.app 로컬)@koensain.app`으로 자동전달을 설정한다 → SES 수신 → 봉투 기준 라우팅(§5.2)으로 해당 메일함에 들어감 | 코드는 §5.2만 있으면 된다. **아마란스가 원본 헤더를 유지해 전달(redirect)하는지, 새 메일로 감싸는지 파일럿에서 확인 필요** |
| B. 아마란스 IMAP 폴링 | 앱이 아마란스 계정 비밀번호를 저장하고 가져옴 | 비권장 — 직원별 자격증명 저장은 상위 설계 §5에서 피하기로 한 방식 |
| C. 회신 없음 감수 | 회신은 아마란스에서 확인 | 파일럿 초기에만 허용 |

- 자동전달은 원 발신자의 SPF를 깨뜨리지만, 현재 수신 파이프라인은 SPF 판정으로 거르지 않으므로 받는 데 영향은 없다. 다만 SES 스팸 판정 표시가 늘 수 있으니 파일럿에서 관찰한다.
- 같은 메일이 두 경로(직접·전달)로 들어와도 `UNIQUE(mailbox_id, rfc_message_id)`로 한 번만 쌓인다.

### 5.2 수신 — 봉투 기준 라우팅 ([inbound.ts](../frontend/lib/mail/inbound.ts))
- `parseNotification`: 수신자를 `receipt.recipients`(Receipt Rule이 매칭한 **SMTP RCPT TO**)에서 읽는다. 값이 없을 때만 기존 `mail.destination`으로 폴백한다.
- `resolveRecipients(addresses)`:
  1. 전체 주소로 `mailbox_addresses` 조회(도메인 무관)
  2. 못 찾았고 도메인이 `MAIL_DOMAIN`이면 → 기존 `users.email_local` lazy 생성 경로
  3. 도메인이 `MAIL_DOMAIN`이면 → 별칭 fan-out(기존과 같음)
- Receipt Rule `recipients = [var.domain_name]`은 1단계에서 **변경 없음**(koensain.com은 SES로 오지 않는다).
- 효과: Bcc 유실 해소, 헤더 위조 배달 차단, 아마란스 전달 메일(헤더 To=`.com`, 봉투=`.app`) 정상 배달.

### 5.3 발신 ([send.ts](../frontend/lib/mail/send.ts))
- From·SES Source = `mailbox.address`(대표 주소) — 기존 코드 그대로. 발신 직전에 대표 주소 도메인이 `send_enabled=1`인지 확인하고, 아니면 `.app` 주소로 대체하지 않고 **오류로 멈춘다**(조용한 폴백 금지).
- Message-ID·인라인 cid 도메인 = **From 주소의 도메인**(From과 Message-ID 도메인이 다르면 일부 필터가 감점).
- **사내 수신자 단락**: 수신자가 `mailbox_addresses`에 있고 그 주소의 도메인이 `external`(=koensain.com)이면, 헤더 To/Cc는 그대로 두고 **SES Destination만 그 메일함의 `.app`(ses 도메인) 주소로** 바꿔 보낸다. 현재도 수신자마다 따로 보내므로(`destinations: [r.address]`) 그 자리에서 바꾸면 된다.
  - 이유: 전환한 동료에게 보낸 메일이 아마란스를 거쳐 돌아오지 않고 앱에 바로 들어온다. 아마란스 전달 설정이 없어도 사내 메일은 동작한다.
  - 아직 전환하지 않은 직원의 `.com` 주소는 원장에 없으므로 평소처럼 아마란스로 간다.
- 공문·계약·성과급 발송([letter/send.ts](../frontend/lib/letter/send.ts)·[bonus/send.ts](../frontend/lib/bonus/send.ts) 등)은 모두 `sendMail`을 거치므로 자동으로 따라온다.
- 시스템 알림(`BID_NOTIFY_EMAIL_FROM = no-reply@koensain.app`)은 1단계에서 유지한다(사내 수신 위주). 대외 차단이 확인되면 `no-reply@koensain.com`으로 tfvars만 바꾸면 된다(IAM `*`).

### 5.4 API·UI
- `GET /api/mail/mailbox`: 응답에 `addresses: string[]`(내 메일함 전체 주소)를 추가한다.
- 전체답장([MailComposePage.tsx:207](../frontend/components/mail/MailComposePage.tsx)): `addresses` 전부를 제외한다.
- 하드코딩 `@koensain.app`(cid 2곳·별칭 관리 기본값·공문 옵션 문구 2곳)을 정리한다.
- 메일 화면의 "보낸 사람" 표시는 기존대로 대표 주소. 별도 발신 주소 선택 UI는 1단계에서 만들지 않는다(UX 단순함 원칙).

### 5.5 관리자 화면 — 주소 등록·대표 전환
- 위치: 기존 메일 관리(별칭 관리 `MailAliasManager`)와 같은 관리자 영역에 "회사 주소" 탭을 둔다. Precision UI 규칙과 기존 cdash 컴포넌트를 쓴다.
- 기능: 직원별 주소 목록, `.com` 주소 등록(일괄 붙여넣기 지원 — 아마란스 목록 입력용), 대표 주소 전환/되돌리기, 도메인 `send_enabled` 토글.
- 권한: 기존 메일 관리 권한을 재사용한다(새 role 만들지 않음).

## 6. 본문 링크 도메인(`.app`이 본문에 남는 문제)

발신 주소를 `.com`으로 바꿔도 본문에는 `https://koensain.app/...`이 남는다. 수신 확인 추적 픽셀(모든 발신)과 대용량 첨부 링크다. **URL의 TLD로 거르는 필터라면 여전히 걸릴 수 있다.**

- **1단계 기본**: 그대로 두고 파일럿에서 실제 차단 여부를 본다.
- **1-b(차단이 계속될 때)**: `mail.koensain.com`을 앱 링크 전용 호스트로 둔다.
  - Wix CNAME `mail` → ALB, ACM 인증서(DNS 검증 CNAME은 Wix에 입력), `aws_lb_listener_certificate` 추가(`-target`)
  - 새 env `MAIL_LINK_BASE_URL`(없으면 `APP_PUBLIC_URL`) — 추적 픽셀·대용량 링크 두 곳만 사용
  - `/api/mail/track`·`/api/mail/large/*`는 비로그인 경로라 호스트가 달라도 동작하는지 확인(미들웨어 확인 필요)
- 대안: 대외 수신자에게는 추적 픽셀을 넣지 않는 옵션. 수신 확인 기능이 축소되므로 사용자 결정 사항.

## 7. 진행 순서와 확인 지점

| 단계 | 작업 | 담당 | 완료 기준 |
|---|---|---|---|
| 1-0 | 사전 확인: ① 아마란스 주소 목록 ② 아마란스 사용자별 자동전달 가능 여부·방식 ③ 다우오피스 SPF 사용 여부 ④ Wix DNS 관리 권한 ⑤ 최근 반송 기록의 거절 사유(도메인/IP) | 사용자 | 5개 답 확보 |
| 1-1 | `ses-mail-com.tf` 작성 → `-target` plan 검토 → apply | Claude 작성·사용자 적용 | SES 콘솔에서 koensain.com DKIM 대기 |
| 1-2 | Wix DNS 입력(§4.2) | 사용자 | SES identity `SUCCESS`, DKIM `SUCCESS`, MAIL FROM `SUCCESS`(또는 생략 결정) |
| 1-3 | 앱 구현: 마이그 280 + §5.2·5.3·5.4·5.5 | Claude | `tsc`(수정 파일 한정)·로컬 단위 확인 |
| 1-4 | 마이그 적용(`staging-apply-migrations.ps1 -Files`) + Next 배포(`staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`) | 사용자 | 기존 `.app` 사용자 동작 변화 없음 |
| 1-5 | 파일럿 1~2명 대표 주소 전환 + 아마란스 자동전달 설정 | 사용자 | 아래 검증 표 통과 |
| 1-6 | 전사 전환(사람별) | 사용자 | 매핑표 전원 전환 |

배포 경계: 새 테이블 2개 추가뿐이고 ADT·intel 배치가 쓰는 표의 스키마 변경이 아니므로 일반 Next 배포 경로를 쓸 수 있다. 배포할 때는 "ADT·intel 배치는 고정 revision(현재 618)에 남고 서비스만 새 revision으로 이동한다"는 경고를 함께 적는다.

### 파일럿 검증 표

| 확인 | 방법 | 통과 기준 |
|---|---|---|
| 인증 정렬 | Gmail·네이버·다음으로 발신 → 원문 보기 | `dkim=pass header.d=koensain.com`, `dmarc=pass` |
| 실제 차단처 | 과거 차단됐던 발주처 그룹웨어·전자조달시스템으로 발신 | 수신 확인(상대에게 확인 요청) |
| 회신 수신 | 외부에서 `.com` 주소로 회신 | 아마란스 + 앱 받은편지함 양쪽 도착, 스레드 연결 |
| Bcc 수신 | 외부에서 `.app` 주소를 Bcc로 발신 | 앱 받은편지함 도착(기존 유실 해소) |
| 사내 단락 | 전환자 → 전환자 발신 | 아마란스를 거치지 않고 앱에 즉시 도착, 헤더 To는 `.com` |
| 미전환자 | 전환자 → 미전환자 `.com` | 아마란스로 정상 도착 |
| 아마란스 공존 | 아마란스에서 직접 외부 발신 | DMARC rua에서 `210.181.95.209` SPF pass 확인 |
| 되돌리기 | 대표 주소를 `.app`으로 되돌림 | 다음 발신부터 `.app`, 데이터 손실 없음 |

## 8. 위험과 되돌리기

| 위험 | 대응 |
|---|---|
| SPF 조회 10회 초과 → **아마란스 발신까지 SPF permerror** | §4.2 — daouoffice 정리를 먼저 하거나, 입력 직후 SPF 검사 도구로 조회 횟수를 확인 |
| SPF 레코드 중복 입력 | 기존 레코드를 수정(새로 추가하지 않음) |
| 아마란스 자동전달이 원본을 감싸 보냄 | 회신 스레드가 끊길 수 있음 → 파일럿에서 확인, 안 되면 2단계(MX 전환)를 앞당기는 판단 |
| SES 공유 IP 평판 때문에 도메인을 바꿔도 차단 | 1-0 ⑤ 반송 기록으로 먼저 구분. IP 원인이면 전용 IP(소량 발송은 워밍업이 어려움)나 차단처에 화이트리스트를 요청하는 방식을 별도 검토 |
| 대표 주소 불변식 깨짐(`mailboxes.address` ≠ primary) | `setPrimaryAddress()` 단일 경로 + 마이그레이션 백필 검증 쿼리 |
| 되돌리기 | 사람별: 대표 주소를 `.app`으로 되돌림(데이터만). 전체: `mail_domains.send_enabled=0`으로 바꾸면 .com 발신이 오류로 멈춘다. 이 상태에서는 대표 주소 일괄 복귀 후 다시 발신 |

## 9. 2단계로 넘기는 판단 기준(참고)
- 파일럿과 전사 전환 후 2~4주 동안 DMARC 리포트에 이상이 없을 것
- 아마란스 메일함을 계속 써야 하는 이유(결재 연동 등)가 없을 것
- 아마란스 과거 메일 이관 방법(IMAP/내보내기) 확인
- 이후 할 일: koensain.com MX → SES, Receipt Rule에 koensain.com 추가, `mail_domains.inbound_mode='ses'`, DMARC 강화
