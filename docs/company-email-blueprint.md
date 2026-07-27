# 그룹웨어 자체 도메인 메일(코넨사인 메일) 블루프린트

> 목표: 다우오피스·아마란스10처럼 **직원 계정별로 `{로컬파트}@koensain.app` 형태의 회사 메일 주소를 부여**하고,
> 2026-09 초 MCM 앱 구축 완료 시점부터 **모든 업무 메일을 이 주소로** 송·수신한다.
> 이 문서는 (1) 도메인/인프라 준비 **절차**와 (2) 앱 내 웹메일 **기능 구현 블루프린트**를 모두 다룬다.
>
> 작성일 2026-07-24. 관련: [e-approval-blueprint.md](e-approval-blueprint.md)(알림 디스패처 SES/솔라피 자산 재사용), `frontend/lib/notify/email-ses.ts`, `infra/aws/dns-https.tf`.

---

## 0. 지금 우리가 이미 가진 것 (재사용 자산)

블루프린트를 백지에서 시작하지 않는다. 아래는 **이미 구축·검증된 자산**이다.

| 자산 | 현황 | 이 프로젝트에서의 의미 |
|---|---|---|
| **도메인 `koensain.app`** | Route53 호스팅 존, ACM 인증서(apex+www), ALB 연결 | 메일 도메인으로 그대로 사용. DNS 레코드는 Terraform(`dns-https.tf`)으로 추가 |
| **SES 발신 검증** | `no-reply@koensain.app` 검증됨, 리전 `ap-northeast-2` | 발송 파이프라인 절반 완성. 개인 주소 발송으로 확장만 하면 됨 |
| **SES 발송 어댑터** | `frontend/lib/notify/email-ses.ts`(`SendEmailCommand`) | 텍스트 발송은 동작 중. 첨부/HTML 지원 위해 `SendRawEmailCommand`로 확장 |
| **`users.email_local`** | 042 마이그레이션에서 이미 **UNIQUE 로컬파트** 컬럼 존재 | ★ 메일 주소 = `email_local || '@' || 도메인`. **주소 부여 데이터 기반이 이미 절반 완성** |
| **`employee_no`(사번)=login_id** | 042에서 UNIQUE | 주소 충돌 시 fallback 규칙에 사용 |
| **알림 디스패처 패턴** | `approval_notify_log` 멱등·dedup, SQS/타이머 배치(`approval-remind-tick`) | 수신 파이프라인의 멱등·워커 패턴을 그대로 이식 |
| **S3·SQS·ECS worker** | 스크래퍼 워커가 SQS 트리거로 이미 가동 | 인바운드 메일 파싱 워커의 실행 토대 |
| **RBAC `account.manage`** | 042에서 시드됨 | 메일 관리(별칭·배포리스트)의 권한키 확장 지점 |

> 핵심: 우리는 **메일 "서버"를 새로 세우는 게 아니라**, AWS SES(발송+수신) 위에 **앱 내 웹메일 UI와 데이터 모델**을 얹는다. 스팸필터·큐·저장은 SES/S3가, UX·스레딩·검색은 MCM이 담당한다.

---

## 1. 아키텍처 결정 — 3가지 경로 비교 (먼저 확정 필요) ★

메일함을 "무엇이 소유·운영하느냐"에 따라 세 갈래다. **이 선택이 전체 블루프린트의 분량을 좌우**하므로 착수 전 확정한다.

| | **A. 네이티브(SES 자체 구축)** | **B. AWS WorkMail** | **C. Google Workspace / MS365 하이브리드** |
|---|---|---|---|
| 메일함 소유 | MCM(자체 DB/S3) | AWS 관리형 | 외부 SaaS |
| 앱 내 웹메일 UX | ★ 완전 통합(다우오피스형) | EWS/IMAP 임베드(제한적) | API 임베드 or 별도 로그인 |
| 배달성·스팸·바이러스 | **자체 책임**(DMARC/평판/필터) | AWS가 처리 | 최상(구글/MS가 처리) |
| 리전 | 발송·수신 **모두 서울 지원**(§2.4) | **서울 미지원**→타리전 | 무관 |
| 비용 | 사용량 과금(저용량 월 몇 $) | 사용자당 $4/월 | 사용자당 $6~/월 |
| 모바일 | Expo 앱에 직접 구현 | 표준 IMAP 클라이언트 | Gmail/Outlook 앱 |
| 구현·운영 부담 | **큼**(이 문서의 P0~P6) | 중 | 작음 |
| 데이터 소유·감사 | ★ 자기 소유(사규 보존·e-discovery 자유) | AWS 내 | SaaS 정책 종속 |

### ✅ 확정(2026-07-24) — **A(네이티브 SES 자체구축)**. C는 배달성 미달 시 안전판.

- 사용자의 요구("MCM 앱 완료 시 **모든 업무 메일을 앱에서**")와 저장소 철학(모든 기능을 AWS 위에 자체 구축)에 **A가 정합**. 인원이 ~30명 저용량이라 SES 사용량 과금이 라이선스 대비 저렴하고, 사규 보존/감사에서 데이터 자기 소유가 유리하다.
- 단, **배달성(외부 대기업 메일서버가 스팸 처리하지 않게 하는 것)은 A의 최대 리스크**다. 이를 P0에서 DMARC 정렬·MAIL FROM·평판 관리로 정면 대응한다.
- **안전판**: 만약 배달성/운영 부담이 감당 안 되면, 메일함 백엔드만 Google Workspace로 바꾸고(§8) **본 문서의 P0(도메인/DNS)·P5(주소정책)·P6(컷오버)는 그대로**, P1~P4(자체 송수신/UI)만 "Workspace API 연동"으로 대체하면 된다. 즉 이 블루프린트는 A/C 어느 쪽으로 가도 앞뒤가 재사용된다.

> ✅ **확정: A(네이티브 자체구축)**. 아래 P0~P6이 실행 계획. 배달성 실측이 목표 미달일 때만 §8(C)로 후퇴.

---

## 2. 도메인·인프라 준비 절차 (P0) — "메일이 뜨고 안 튕기게" 만드는 단계

기능 코드보다 **먼저·독립적으로** 끝내야 하는 인프라/DNS 작업. 전부 `infra/aws/dns-https.tf` 인근에 신규 `.tf`로 추가(멱등).

### 2.1 SES 도메인 아이덴티티 & Easy DKIM
- SES에서 `koensain.app` **도메인 아이덴티티** 등록(현재 주소 단위 검증만 돼 있을 수 있음 → 도메인 단위로 승격).
- **Easy DKIM(2048bit)** 활성화 → SES가 발급하는 **CNAME 3개**를 Route53에 추가. (Terraform: `aws_sesv2_email_identity` + `aws_route53_record` 반복)
- 효과: 발신 메일에 도메인 서명 → 수신측 DKIM 통과.

### 2.2 SPF (발신 IP 인가)
- Route53에 apex TXT: `v=spf1 include:amazonses.com ~all`
- ⚠ apex TXT는 다른 용도(도메인 검증 등)와 **1레코드에 병합**해야 함(TXT는 여러 개면 SPF 무효 위험).

### 2.3 Custom MAIL FROM (SPF/DMARC 정렬) ★ 배달성 핵심
> ✅ 실제 적용값(2026-07-25): koensain.app에 이미 **`admin.koensain.app`**가 MAIL FROM으로 설정·검증(Success)돼 있어 그대로 채택(`mail_from_subdomain="admin"`). 아래는 일반 절차 설명(서브도메인명만 admin으로 대체).
- **`bounce.koensain.app`**(실제로는 `admin.koensain.app`)을 Custom MAIL FROM 도메인으로 지정.
  - 서브도메인 **MX**: `feedback-smtp.ap-northeast-2.amazonses.com`(우선순위 10)
  - 서브도메인 **SPF TXT**: `v=spf1 include:amazonses.com ~all`
- 효과: Return-Path가 우리 도메인 정렬(aligned) → **DMARC alignment 통과**(단순 include만으로는 정렬 실패로 스팸행 위험).

### 2.4 인바운드(수신) 리전 — ✅ 서울(ap-northeast-2) 지원 확인됨
- **SES 이메일 수신이 서울에서 지원된다**(2026-07-25 확인, AWS General Reference "Email Receiving endpoints": `inbound-smtp.ap-northeast-2.amazonaws.com`). → **크로스리전 불필요**, 발송·수신을 서울 단일 리전에서 통합.
- 구성(`infra/aws/ses-inbound.tf`, `mail_inbound_region="ap-northeast-2"`로 활성화):
  1. 서울에 SES **Receipt Rule Set**(1리전 1활성) 구성.
  2. `koensain.app` **MX** → `inbound-smtp.ap-northeast-2.amazonaws.com`(우선순위 10).
  3. Receipt Rule 액션: **수신 전용 S3(서울)에 원문 MIME 저장** + **SNS**로 통지. 서울 앱/워커가 동일 리전에서 직접 GET.
  4. 서울 파싱 워커(§4-P2)가 SNS→SQS로 통지받아 처리.
- 현재 apex 조회 결과(2026-07-25): **apex TXT 없음**(SPF 신규 생성 안전) · **MX 없음**(수신 greenfield) · **`_dmarc`에 `p=none` 기존 존재**(TF가 rua 포함 버전으로 덮어씀). MX는 apex A레코드(웹앱)와 타입이 달라 공존.
- ⚠ **MX 컷오버(=`mail_inbound_region` 설정) 시점**: MX가 생기면 실제 수신이 시작되나 파싱 워커(P2) 없으면 S3에만 쌓여 앱에 안 보임(유실은 없음) → **수신 활성화는 P2 완료 후**.

### 2.5 DMARC 정책 (점진적 강화)
- Route53 `_dmarc.koensain.app` TXT: 시작은 관측 모드
  `v=DMARC1; p=none; rua=mailto:dmarc@koensain.app; ruf=mailto:dmarc@koensain.app; fo=1`
- rua 리포트를 1~2주 관찰(정렬 실패/스푸핑) → `p=quarantine` → 안정되면 `p=reject`로 강화.

### 2.6 SES 프로덕션 액세스(샌드박스 해제)
- 현재 SES는 **샌드박스**일 가능성(검증된 수신자에게만 발송). 운영 전 **프로덕션 액세스 요청**(발송 쿼터·임의 수신자 허용) 필요 — 승인에 영업일 소요될 수 있어 **P0에서 즉시 신청**.
- 바운스/신고(complaint) **SNS 알림 구독** 설정 → 하드바운스 주소 자동 억제(suppression). SES 계정 평판(반송률<5%, 신고율<0.1%) 관리.

### 2.7 (선택) 역방향 정합·부가
- 공유 IP로 시작(저용량이라 dedicated IP 불필요·오히려 워밍업 부담). BIMI/로고 인증은 후순위.

> **P0 산출물 체크리스트**: DKIM 3× CNAME · SPF TXT · MAIL FROM(MX+SPF) · 수신 MX · `_dmarc` TXT · SES 프로덕션 승인 · 바운스 SNS 구독. 전부 Terraform 커밋 + `terraform apply`(DNS/SES는 앱 배포와 무관하게 선행 가능).

---

## 3. 주소 체계 & 계정 정책 (P0와 병행 확정)

### 3.1 로컬파트 명명 규칙 ✅ 확정: **기존 개인 메일의 앞자리(로컬파트)를 그대로 승계**
- 방식: 입사 시 받는 본인 기존 메일주소의 **로컬파트를 그대로** 회사 도메인에 붙인다. 예) `hong1234@naver.com` → **`hong1234@koensain.app`**.
- 근거: (1) 로마자 변환·표준화가 불필요, (2) 본인이 이미 쓰던 아이디라 인지·기억 부담 0, (3) 로컬파트에 영문 실명을 안 쓰는 한국 관행에 부합.
- ★ **데이터 기반 이미 존재**: 042 마이그레이션이 `users.email_local`을 `split_part(email,'@',1)`(= 기존 메일 로컬파트)로 백필해 UNIQUE 보유 → **이 방식과 정확히 일치**. P5는 "정규화"가 아니라 "검수·확정"만 하면 됨.
- **정규화(부여 단계 검증)**: 소문자화, 허용 문자 `[a-z0-9._-]`로 제한(그 외 문자·비ASCII는 관리자 수정 유도), 선행/후행 `.` 금지, 과도하게 긴/부적절한 로컬파트(`lovely_star_2001` 등)는 **수기 대체 허용**.
- **충돌 처리**:
  - 서로 다른 제공자라도 로컬파트가 같으면(예: `mykim@naver.com`·`mykim@gmail.com`) 우리 도메인에서 충돌 → 042 로직상 충돌 로컬파트는 `email_local`이 NULL로 남아 있음. 부여 단계에서 **숫자 suffix**(`mykim`, `mykim2`) 또는 협의로 유일화.
  - **예약어 회피**: `no-reply`·`postmaster`·`admin`·`webmaster`·`dmarc`·별칭(`sales`·`hr`·`info`·`all` 등)과 겹치는 개인 로컬파트는 강제 대체.
- **부여 UI**: `email_local` 기본값 자동 제안 → 관리자(또는 본인)가 확인/수정 후 확정(정규화·충돌·예약어 검사 통과 시 mailbox 생성).
- **역할 별칭/배포 리스트**(개인 아님, 부서·기능 공유함):
  - `sales@`, `hr@`, `support@`, `info@`, `no-reply@`(발신 전용), `dmarc@`(리포트 수신), `all@`(전 직원).
  - 별칭 → 실제 수신자 매핑 테이블로 관리(1:N fan-out).

### 3.2 계정 라이프사이클과 연동
- **입사(계정 발급)**: `account.manage` 흐름에서 사번·비번과 **동시에 메일 주소 생성**(mailbox 레코드 생성). 명명 규칙 자동 제안 + 중복 검사.
- **퇴사(비활성)**: `employee_profiles.status='inactive'` 시 mailbox **수신 정지 + 자동응답/포워딩**(사규상 보존기간 동안 읽기 유지, 신규 수신은 거부/전달).
- **개명·부서이동**: 기존 주소 유지 + 새 별칭 추가(과거 주소는 alias로 살려 유입 메일 보존).

### 3.3 `employee_profiles.email`의 의미 재정의
- 현재 `email`(개인/연락 메일)과 **회사 메일은 별개**. 신규로 회사 메일을 명시 저장(§4의 `mailboxes.address`가 원천, `employee_profiles`에는 파생 표시만).
- 알림 디스패처(`notify.ts::resolveContacts`)의 수신 이메일은 **회사 메일로 전환**할지 정책 결정(초기에는 개인/회사 둘 다 발송 가능하게 둠).

---

## 4. 데이터 모델 & 구현 단계 (P1~P6)

> 마이그레이션은 다음 번호부터: **095, 096, 097**(현재 최신 094). 멱등 `NNN_*.sql`. UI는 cdash 컨셉 필수(`.cursor/rules/ui-modernize.mdc`).

### 마이그레이션 095 — 메일 코어
```
mailboxes            -- 계정별 메일함(주소의 원천)
  mailbox_id PK, user_id FK, employee_id FK,
  address text UNIQUE,           -- {email_local}@koensain.app
  display_name text,             -- "홍길동 / 코넨사인"
  status ('active'|'suspended'|'closed'),
  quota_bytes bigint, used_bytes bigint,
  signature_html text,           -- 개인 서명
  auto_reply_json jsonb,         -- 부재중 자동응답
  created_at, updated_at

mail_aliases         -- 별칭/배포리스트 → 실수신자 fan-out
  alias_id PK, alias_local text UNIQUE,  -- 'sales'
  kind ('alias'|'list'),
  target_mailbox_ids text[],     -- 전개 대상
  active int, created_at

mail_messages        -- 송·수신 메시지(스레드 원자)
  message_id PK,                 -- 내부 UUID
  rfc_message_id text,           -- RFC822 Message-ID(헤더)
  thread_id text,                -- 스레드 그룹(References 기반)
  mailbox_id FK,                 -- 소유 메일함
  direction ('in'|'out'),
  from_addr text, to_addrs jsonb, cc_addrs jsonb, bcc_addrs jsonb,
  reply_to text, in_reply_to text, references_json jsonb,
  subject text, snippet text,
  body_text text, body_html text,
  raw_s3_key text,               -- 원문 MIME(S3)
  size_bytes bigint,
  has_attachments int,
  sent_at text, received_at text, created_at text,
  ses_message_id text,           -- 발송 추적/바운스 매칭
  UNIQUE(mailbox_id, rfc_message_id)   -- 수신 멱등

mail_attachments
  attachment_id PK, message_id FK,
  filename text, content_type text, size_bytes bigint,
  s3_key text, content_id text   -- 인라인 이미지(cid)
```

### 마이그레이션 096 — 폴더/라벨/상태
```
mail_folders         -- 시스템+사용자 폴더(inbox/sent/drafts/trash/archive/spam + custom)
  folder_id PK, mailbox_id FK, name text, system_kind text, sort int
mail_message_state   -- 메시지×폴더 배치 + 플래그
  message_id FK, folder_id FK, mailbox_id FK,
  is_read int, is_starred int, is_deleted int, labels text[],
  PRIMARY KEY(message_id, folder_id)
mail_drafts          -- 작성 중 임시저장(자동저장)
```

### 마이그레이션 097 — 발송 로그/바운스/설정
```
mail_send_log        -- 발송 시도·SES 결과·멱등 dedup(approval_notify_log 패턴 이식)
mail_bounces         -- SNS 바운스/complaint 수신 → 수신자 suppression
mail_settings        -- 도메인/서명 기본값/보존기간/관리 정책
```

---

### P1 — 발송(Outbound) : "본인 주소로 보내기" ⭐ 첫 실사용 가치
- `email-ses.ts`를 **`SendRawEmailCommand`**로 확장: MIME 조립(HTML+text, 첨부, 인라인 cid), `From: 홍길동 <gildong.hong@koensain.app>`, `Reply-To`, `Message-ID`, `References`(답장 스레딩).
- 서버 라우트 `POST /api/mail/send`: 세션 사용자의 mailbox로 **서버가 대리 발송**(★ 개인 SMTP 자격증명 불필요 — 앱 세션이 인가). → 자격증명 취급 리스크 회피.
- 첨부는 S3 업로드 → MIME 첨부. `mail_send_log`에 멱등 기록 + Sent 폴더에 `mail_messages(direction='out')` 적재.
- UI: `frontend/app/(app)/mail/compose` + 모달 작성기(cdash, 리치텍스트). 서명 자동 삽입.
- **여기까지만 배포해도** 직원이 회사 주소로 발송 가능(수신은 개인 메일로 답장 오게 임시 운용 가능) → 빠른 실사용.

### P2 — 수신(Inbound) 파이프라인 : SES → S3 → SQS → 워커
- §2.4 수신 리전 확정 후: Receipt Rule(S3 저장 + SNS→SQS 통지).
- **파싱 워커**(scraper worker에 핸들러 추가 or 신규 Lambda): SQS 메시지 → S3 원문 MIME 로드 → `mailparser`로 파싱 → 수신자 로컬파트로 **mailbox 해석**(별칭이면 fan-out) → `mail_messages(direction='in')` + 첨부 S3 + Inbox 폴더 state. `UNIQUE(mailbox_id, rfc_message_id)`로 멱등.
- 스레딩: `In-Reply-To`/`References`로 `thread_id` 결정(없으면 제목+참여자 휴리스틱).
- 바운스/complaint: SNS 구독 워커가 `mail_bounces` 적재 + 하드바운스 주소 발송 차단.

### P3 — 웹메일 UI (다우오피스형) : `frontend/app/(app)/mail`
- 3-pane cdash 레이아웃: 폴더 사이드 / 리스트(스레드·읽음·별표·검색) / 뷰어(본문·첨부·답장/전달).
- 기능: 읽음/안읽음·별표·이동·삭제(휴지통)·검색(제목/발신/본문)·페이지네이션(`PaginationControls` 재사용).
- 답장/전체답장/전달 → P1 발송기로 연결(원문 인용·스레드 헤더 세팅).
- 자동저장 드래프트, 서명 관리, 부재중 자동응답 설정.

### P4 — 관리/정책 : `frontend/app/(app)/mail/admin` (`account.manage` 권한)
- 계정 발급 흐름에 **메일 주소 생성 통합**(명명 규칙·중복검사·별칭).
- 별칭/배포리스트 CRUD(`sales@`, `all@` …), 포워딩/자동응답 정책.
- 보존기간·감사 로그·용량 모니터, 퇴사자 메일 처리(정지/전달/보존).
- DMARC 리포트(`dmarc@`) 요약 대시보드(선택).

### P5 — 주소 부여 & 데이터 마이그레이션
- `users.email_local` 백필 검수 → mailbox 일괄 생성 스크립트(`scripts/`): 활성 직원 ~30명 mailbox 생성 + 충돌 유일화.
- (선택) 기존 개인 메일함에서 과거 업무 메일 **임포트**(IMAP fetch or `.eml`/mbox 업로드 파서 재사용).
- 전 직원 서명·명함 주소 갱신.

### P6 — 컷오버(2026-09 초) & 대외 전환
- **MX 최종 전환**은 P2 검증 완료 후. 소규모 파일럿(2~3명) → 전사.
- 대외 공지: 거래처에 신규 주소 안내(공문/서명). 기존 개인 주소는 **포워딩 or 자동응답**으로 일정기간 유예.
- 알림 디스패처(`notify.ts`)의 발신·수신 주소를 회사 메일로 정렬.
- 모바일(Expo `apps/mobile`): 메일 탭 추가(리스트/뷰어/작성) — P3 API 재사용.

---

## 5. 보안 · 컴플라이언스 · 운영 주의

- **자격증명 취급 회피**: 발송은 앱 세션 인가로 서버 대리 발송 → 직원별 SMTP 비번을 앱에 저장하지 않음. 외부 클라이언트(Outlook) IMAP은 **후순위(P6+)**, 필요 시 SES SMTP는 팀 단위로만.
- **바운스/신고 자동 억제**로 SES 평판 보호(반송률·신고율 임계 관리). 미준수 시 SES 계정 정지 위험.
- **보존/감사(e-discovery)**: 사규 보존기간 동안 원문 MIME(S3, 버전닝/객체락 고려)+메타 보존. 관리자 열람은 `account.manage`+감사로그.
- **프롬프트/자동화 안전**: 자동 발송(알림 외)·자동 포워딩 규칙·대량 발송은 사용자 승인 게이트. 외부로 나가는 첨부/본문은 검토 후 발송.
- **스팸 인바운드**: SES 기본 스팸/바이러스 스캔 헤더(SPF/DKIM/spam verdict) 활용 + Spam 폴더 라우팅. 첨부 실행파일 격리.
- **개인정보**: 메일 본문/첨부에 주민번호 등 유입 가능 → 검색 인덱스에서 마스킹 정책 검토.

---

## 6. 비용·리스크 요약

- **비용(A안, ~30명 저용량)**: SES 발송 $0.10/1k + 수신·S3·SQS 소액 → 월 수 $ 수준. 라이선스형(B/C 월 $120~180) 대비 저렴.
- **최대 리스크 = 배달성**: 대형 수신처(네이버/구글/다음·대기업)가 스팸 처리하면 업무 마비. → P0 DMARC 정렬·MAIL FROM·평판 관리로 정면 대응, **파일럿으로 실측 후 전사 컷오버**.
- ~~2순위 리스크 = 수신 리전 제약~~ → **해소됨**: 서울에서 SES 수신 지원 확인(§2.4). 발송·수신 단일 리전, 크로스리전 복잡도 없음.
- **완화책**: 배달성이 목표 미달이면 §1-C(Workspace 백엔드)로 후퇴 가능하도록 P0/P5/P6를 백엔드 독립적으로 설계.

---

## 7. 착수 순서(권장)

1. **[사용자 확정]** A(자체) vs C(Workspace 백엔드) · 로컬파트 명명 규칙 · 수신 리전.
2. **P0 인프라**(DNS/SES/DKIM/SPF/MAIL FROM/DMARC/프로덕션 신청/수신 MX) — 코드와 무관하게 선행, 승인 대기 병렬.
3. **P1 발송** 배포 → 소수 파일럿으로 외부 발송 배달성 실측(주요 수신처로 테스트).
4. **P2 수신** → **P3 웹메일 UI** → 파일럿 확대.
5. **P4 관리 · P5 주소 부여/임포트** → **P6 컷오버(9월 초)**.

---

## 8. 부록 — C(Workspace 백엔드) 선택 시 델타

P1~P4를 다음으로 대체(P0/P5/P6 재사용):
- 도메인 `koensain.app`를 Workspace/365에 검증(제공자 지정 MX/DKIM/SPF로 §2 레코드 교체).
- 계정 프로비저닝 API(Google Admin SDK Directory)로 mailbox 자동 생성(§3 라이프사이클 연동).
- 앱 내 표시는 Gmail API(읽기/발송)로 임베드하거나, 초기에는 "메일은 Gmail" 안내 + MCM은 알림/링크만.
- 배달성·스팸·모바일·2FA는 제공자가 처리 → 운영 부담 최소, 대신 월 사용자당 과금.
