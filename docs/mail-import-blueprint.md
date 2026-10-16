# 메일 가져오기 설계안 — 파일 업로드 + IMAP

> 작성 2026-10-16 · 상위 설계: [company-email-blueprint.md](company-email-blueprint.md) §4-P5(임포트), [company-email-com-domain-phase1.md](company-email-com-domain-phase1.md)
> 상태: **설계안(미구현)**. 결정 D-1~D-4 확정(2026-10-16, 권장안대로). 착수는 I-0 사전 확인(아마란스 IMAP 로그인) 뒤.

## 0. 목표와 원칙

- **목표**: 직원이 지금까지 쓰던 메일함(아마란스 `@koensain.com`, 네이버·다음·지메일 등 개인 메일)의 **과거 송수신 메일을 MCM 메일함으로 옮긴다.**
- **원칙**
  1. **본인만, 본인 메일함으로.** 직원이 자기 계정의 메일을 자기 MCM 메일함에만 가져온다. 관리자가 남의 메일을 대신 가져오는 기능은 만들지 않는다.
  2. **고르게 한다.** 개인 메일에는 사적인 메일이 섞여 있으므로 폴더·기간을 직원이 고른다.
  3. **원본을 보존한다.** 원문 MIME을 그대로 보관하고, 같은 메일은 몇 번을 가져와도 한 번만 저장한다.
  4. **받은편지함을 어지럽히지 않는다.** 가져온 메일은 기본적으로 별도 폴더에 넣는다.
  5. **비밀번호는 최소한으로만 다룬다**(§5.3).

## 1. 현재 상태 (2026-10-16 실측)

### 1.1 재사용할 수 있는 것

| 항목 | 위치 | 쓰임 |
|---|---|---|
| MIME 파서 | `mailparser` (이미 의존성) | 원문 → 제목·주소·본문·첨부 |
| ZIP 해제 | `jszip` (이미 의존성) | `.zip` 안의 `.eml` 묶음 |
| 수신 적재 로직 | [inbound.ts](../frontend/lib/mail/inbound.ts) `storeForMailbox` | 메시지·첨부·폴더 배치·스팸 판정 — 가져오기용으로 공용 함수로 분리해 재사용 |
| 중복 방지 | `mail_messages UNIQUE(mailbox_id, rfc_message_id)` (095) | 같은 메일 재가져오기 시 건너뜀 |
| 사용자 폴더 | `mail_folders.system_kind IS NULL` = 카테고리 (096, [categories.ts](../frontend/lib/mail/categories.ts)) | "가져온 메일" 폴더 |
| 원 폴더 표시 | `mail_message_state.labels jsonb` (096) | 원래 폴더 경로를 라벨로 보존 |
| 내 주소 목록 | `mailbox_addresses` (280), `getMailboxAddresses` | 보낸 메일 판별 |
| 비밀 암호화 | [secret-crypto.ts](../frontend/lib/scraper/secret-crypto.ts) `encryptSecret`·`decryptSecret` (AES-256-GCM, AUTH_SECRET 파생 키) | IMAP 비밀번호 임시 보관 |
| 주기 실행 | [instrumentation.ts](../frontend/instrumentation.ts) `callTick` + `/api/internal/*-tick` (AUTH_SECRET 헤더 가드) | 가져오기 작업을 조금씩 처리 |
| 대용량 업로드 | 메일 대용량 첨부 presigned 업로드([large-attachments route](../frontend/app/api/mail/large-attachments/route.ts), 261)·메신저 업로드와 같은 `@aws-sdk/s3-request-presigner` 경로(S3 CORS PUT 적용됨) | 큰 `.mbox`·`.zip` 업로드 |

### 1.2 주의할 제약

- **수신 원문 버킷은 90일 뒤 삭제된다**(`mail-inbound` 버킷 `inbound/` 접두어 lifecycle). 가져온 원문은 **앱 데이터 버킷**(`putContractDocument` 경로)의 `mail-import/` 아래에 둔다.
- **Next 서버는 매일 밤 정지**한다(08시 기동, 평일 22시·주말 20시 정지). 가져오기는 중단됐다가 다음 기동 후 **이어서** 처리해야 한다.
- **Next 미들웨어 본문 한도 210MB**. 그보다 큰 파일은 S3 presigned 업로드로 받는다.

### 1.3 원본 메일함별 경로

| 원본 | IMAP | 파일 내보내기 | 비고 |
|---|---|---|---|
| 아마란스 (`mail.bizboxa.com`) | 포트 993·143·995·110 **열림**(10-15 접속 시험, 로그인 미시험). **직원 계정 IMAP 로그인 허용 여부 미확인** | 공개 자료에서 일괄 내보내기 기능 확인 못 함 | I-0에서 확인 |
| 네이버 | `imap.naver.com:993` SSL. 환경설정에서 IMAP 사용 + 2단계 인증 시 애플리케이션 비밀번호 | 메일 1통씩 저장(.eml) | IMAP 권장 |
| 다음(카카오) | IMAP 사용 설정 + 앱 비밀번호 | — | IMAP 권장 |
| 지메일 | `imap.gmail.com:993`. 2단계 인증 + 앱 비밀번호 | Google Takeout `.mbox` | 둘 다 가능 |
| 아웃룩(PC) | 계정에 따라 다름 | `.pst` — **지원 안 함**. 아웃룩에서 메일을 끌어 `.eml`로 저장하거나 IMAP 경로 사용 | 안내만 |

## 2. 공통 설계 — 가져오기 작업

### 2.1 작업(job) 단위
- 직원이 "가져오기"를 시작하면 작업 1건이 생기고, 서버가 **틱마다 조금씩** 처리한다(§2.5).
- 작업 상태: `pending`(대기) → `running`(처리 중) → `done` / `failed` / `cancelled`. `paused`는 Next 정지·오류 재시도 대기.
- 직원은 진행률(처리 n / 전체 N, 건너뜀, 실패)과 오류를 화면에서 보고, 언제든 취소할 수 있다.

### 2.2 적재 규칙

| 항목 | 규칙 |
|---|---|
| 보낸 메일 판별 | 보낸 사람이 **내 주소**(MCM 메일함 주소 전체 + 가져오는 원 계정 주소)면 `direction='out'`, 아니면 `'in'`. IMAP은 `\Sent` 폴더도 보낸 메일로 본다 |
| 폴더 배치 | 보낸 메일 → **보낸편지함**. 받은 메일 → **"가져온 메일(원본 이름)"** 사용자 폴더(예: `가져온 메일(아마란스)`). 옵션으로 "받은편지함에 넣기" 선택 가능 |
| 원 폴더 | 원래 폴더 경로를 `labels`에 `import:<원본>/<폴더>`로 남긴다 |
| 읽음 | IMAP `\Seen` 그대로, 파일은 읽음으로 |
| 날짜 | 원문 `Date` 헤더(없으면 IMAP INTERNALDATE, 그것도 없으면 가져온 시각) |
| 중복 | `Message-ID`로 판별. 없는 메일은 원문 SHA-256으로 `<import-{hash}@mcm.local>` 합성 |
| 스팸 판정 | 적용하지 않는다(과거 메일을 스팸함으로 옮기지 않음) |
| 수신 확인·추적 | 적용하지 않는다 |
| 알림 | 가져온 메일로는 새 메일 알림·푸시를 보내지 않는다 |
| 원문 | 앱 데이터 버킷 `mail-import/{mailboxId}/{jobId}/{hash}.eml` (`raw_s3_key`) |
| 한 통 크기 | 기본 상한 50MB. 넘으면 건너뛰고 실패 목록에 남긴다 |

### 2.3 용량
- 가져온 메일도 메일함 용량(`quota_bytes`, 103)에 포함한다. 시작 전에 **예상 용량**(IMAP은 폴더별 크기 합계, 파일은 파일 크기)을 보여 주고, 남은 용량을 넘으면 시작을 막고 관리자 용량 배분을 안내한다.
- 용량 집계 방식은 기존 메일함 사용량 계산 경로에 맞춘다(구현 시 확인).

### 2.4 권한·감사
- 시작·취소·완료는 접속기록(`recordAccessLog`, `targetKind: "mail_import"`)에 남긴다. 본문·비밀번호는 기록하지 않는다.
- 관리자는 **작업 현황만**(누가·언제·몇 통·상태) 볼 수 있고 메일 내용은 볼 수 없다.

### 2.5 처리 엔진
- 새 틱 `/api/internal/mail-import-tick`을 `instrumentation.ts`에 1분 주기로 추가한다(기존 수신 틱과 같은 방식).
- 틱 1회는 **시간 예산 40초** 안에서 처리한다. 동시에 처리하는 작업은 **전체 1건**(advisory lock)으로 둬서 DB와 Next 서버 부하를 묶는다.
- 진행 위치(IMAP 폴더·UID, 파일 byte offset·ZIP 항목 순번)를 틱마다 저장해 **정지 후 이어서** 처리한다.
- 처리량은 메일 크기에 따라 다르다. 파일럿에서 실측해 안내 문구에 반영한다(목표: 1만 통을 하루 안에).

## 3. 데이터 모델 — 마이그레이션 `281_mail_import.sql`(가번호)

> 번호는 착수 직전 `git fetch` 후 원격 전 브랜치의 `infra/aws/`를 다시 확인한다(2026-10-16 기준 최대 280).

```sql
CREATE TABLE IF NOT EXISTS mail_import_jobs (
  job_id           text PRIMARY KEY,
  mailbox_id       text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  user_id          text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('file', 'imap')),
  source_label     text NOT NULL,                 -- '아마란스', '네이버' … (폴더 이름에 사용)
  source_address   text,                          -- 원 계정 주소(보낸 메일 판별)
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'paused', 'done', 'failed', 'cancelled')),
  options          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 폴더 목록·기간·받은편지함 배치 여부
  -- 파일 방식
  upload_keys      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- S3 키 목록
  -- IMAP 방식(비밀번호는 작업이 끝나면 NULL 로 지운다, §5.3)
  imap_host        text,
  imap_port        integer,
  imap_user        text,
  imap_secret_enc  text,
  secret_expires_at text,
  -- 진행
  cursor           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 폴더·UID / 파일·offset
  total_count      integer,
  done_count       integer NOT NULL DEFAULT 0,
  skipped_count    integer NOT NULL DEFAULT 0,             -- 중복
  failed_count     integer NOT NULL DEFAULT 0,
  bytes_imported   bigint NOT NULL DEFAULT 0,
  last_error       text,
  failures         jsonb NOT NULL DEFAULT '[]'::jsonb,     -- 최근 실패 100건(제목·사유)
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  finished_at      text
);
CREATE INDEX IF NOT EXISTS idx_mail_import_jobs_user ON mail_import_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_import_jobs_active ON mail_import_jobs(status) WHERE status IN ('pending', 'running', 'paused');
```

- IMAP 증분 재실행을 위해 폴더별 `UIDVALIDITY`·마지막 UID를 `cursor`에 남긴다. 같은 원본을 다시 가져오면 직전 작업의 cursor 이후만 읽는다.

## 4. 방식 A — 파일 업로드

### 4.1 지원 형식

| 형식 | 처리 |
|---|---|
| `.eml` (여러 개 동시 선택) | 파일 1개 = 메일 1통 |
| `.zip` | 안의 `.eml`을 모두 처리(하위 폴더 이름 = 원 폴더 라벨) |
| `.mbox` | `From ` 구분 줄로 메일을 나눔. 지메일 Takeout의 `X-Gmail-Labels` 헤더를 원 폴더 라벨로 사용 |

- `.pst`(아웃룩)는 지원하지 않는다. 화면에서 대체 방법(아웃룩에서 `.eml`로 끌어 저장, 또는 IMAP)을 안내한다.

### 4.2 업로드
- 브라우저 → **S3 presigned 업로드**(메일 대용량 첨부 업로드와 같은 방식). 파일당 상한 2GB.
- 업로드가 끝나면 작업을 만들고, 서버가 S3에서 읽어 처리한다. 원본 업로드 파일은 작업 완료 7일 뒤 지운다.
- `.mbox`는 S3 범위 읽기(Range)로 조금씩 읽고 byte offset을 cursor에 저장한다(파일 전체를 메모리에 올리지 않음).

### 4.3 화면 흐름
1. 메일 설정 → **메일 가져오기** → "파일로 가져오기"
2. 원본 이름(예: 지메일) 입력, 원 계정 주소(선택) 입력 → 파일 선택
3. 예상 통수·용량 확인 → 시작
4. 진행률 표시, 완료 후 "가져온 메일(지메일)" 폴더로 이동 버튼

## 5. 방식 B — IMAP

### 5.1 연결
- 라이브러리: **`imapflow`**(신규 의존성 — D-2 확정 2026-10-16). Node 스트리밍·IDLE·UID 처리 지원.
- 서버 프리셋: 아마란스(`mail.bizboxa.com:993`), 네이버(`imap.naver.com:993`), 다음(`imap.daum.net:993`), 지메일(`imap.gmail.com:993`). "직접 입력"도 허용하되 아래 보안 검사를 통과해야 한다.
- **SSL(993)만 허용**한다. 평문 143은 쓰지 않는다.

### 5.2 화면 흐름
1. 메일 설정 → **메일 가져오기** → "메일 계정에서 가져오기"
2. 원본 선택(프리셋) → 계정 주소·비밀번호(또는 **앱 비밀번호**) 입력 → [연결 확인]
3. 연결되면 **폴더 목록과 폴더별 통수·크기**를 보여 준다. 직원이 폴더와 기간(예: 최근 3년)을 고른다. 기본 선택은 받은편지함·보낸편지함만
4. 예상 용량 확인 → 시작 → 진행률

원본별 사전 준비 안내(네이버 IMAP 사용 설정·앱 비밀번호 발급 등)는 `CdHelp`로 단다.

### 5.3 비밀번호 취급 (D-1 확정 2026-10-16: 처리 기간 동안만 암호화 보관)
상위 설계는 "직원별 메일 비밀번호를 앱에 저장하지 않는다"로 정했다. 가져오기는 여러 틱에 걸쳐 처리하므로 **처리 기간 동안만** 예외를 둔다.
- `encryptSecret`(AES-256-GCM)으로 암호화해 `imap_secret_enc`에 둔다. 화면·API 응답·로그에 다시 내보내지 않는다.
- **작업이 끝나거나(done·failed·cancelled) 7일이 지나면 즉시 NULL로 지운다.** 만료 정리는 import 틱이 매번 수행한다.
- 직원에게 **앱 비밀번호 사용을 권장**한다(원 계정 비밀번호가 아니라 언제든 폐기할 수 있음). 가져오기가 끝나면 앱 비밀번호를 삭제하라고 안내한다.
- 채택하지 않은 대안(D-1 B안): 비밀번호를 보관하지 않고 "브라우저를 열어 둔 동안만" 처리. 안전하지만 큰 메일함은 수 시간 화면을 켜 둬야 해 비현실적이라 권하지 않는다.

### 5.4 보안 검사 (직접 입력 호스트)
- 호스트를 DNS 해석한 뒤 **사설·루프백·링크로컬(169.254 포함, IPv4-mapped IPv6 포함)·VPC 대역이면 거절**한다(서버가 내부망으로 접속하는 것 방지).
- 포트는 993만. 연결 시간 제한 15초, 인증 실패는 즉시 작업 실패(재시도 안 함 — 계정 잠김 방지).
- 원 서버의 속도 제한·연결 끊김은 `paused`로 두고 다음 틱에 이어서 재시도(최대 5회 연속 실패 시 `failed`).

### 5.5 처리
- 폴더마다 `UIDVALIDITY` 확인 → UID 오름차순으로 기간 내 메일을 50통씩 `BODY.PEEK[]`로 받는다(**원 서버의 읽음 표시를 바꾸지 않는다**).
- 원 메일함에서 **아무것도 지우거나 옮기지 않는다**(읽기 전용).
- 재실행 시 cursor 이후 UID만 받는다 → **증분 동기화**. 아마란스 2단계(MX 전환) 직전 마지막 증분에 사용한다.

## 6. 화면

- 위치: **메일 설정 → 메일 가져오기**(전 직원). 회사 주소처럼 관리자 전용이 아니다.
- 구성: [새 가져오기] 버튼(파일 / 메일 계정), 내 작업 목록(원본·상태·진행률·통수·용량·시작/완료 시각·[취소]·[다시 실행(증분)]).
- 관리자 섹션(선택): 전 직원 작업 현황 표(내용 없음).
- UI는 Precision 기준([ui-precision-standard.md](ui-precision-standard.md))과 cdash 컴포넌트를 따른다. 긴 안내는 `CdHelp`로.

## 7. 개인정보 안내 (화면 문구 초안)

> 개인 메일에는 사적인 메일이 섞여 있을 수 있습니다. 업무에 필요한 폴더와 기간만 골라 가져오세요. 가져온 메일은 회사 메일함에 보관되며, 퇴사 시 회사 메일함과 함께 처리됩니다.

- 퇴사 시 처리(보관·삭제)는 회사 메일함 정책을 따른다. 정책 문구는 사규 담당자 확인 후 확정한다.

## 8. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **I-0 사전 확인** | ① 아마란스 계정으로 IMAP 로그인 시험(아웃룩·휴대폰 메일 앱에 `mail.bizboxa.com` 993 SSL로 추가) ② 안 되면 더존에 IMAP 허용 문의 ③ 파일럿 2~3명의 원 메일함 크기(통수·GB) 파악 | 아마란스 IMAP 가능 여부 확정(결정 D-1~D-4는 10-16 확정) |
| **I-1 공통 + `.eml`·`.zip`** | 마이그 281, `storeForMailbox` 공용화, import 틱·advisory lock·cursor, 파일 업로드(presigned)·`.eml`/`.zip` 처리, 메일 설정 화면(작업 목록·진행률·취소) | 수백 통 `.zip`을 가져와 보낸/받은 분류·중복 건너뜀·Next 재기동 후 이어서 처리 확인 |
| **I-2 `.mbox`** | 범위 읽기 스트리밍 분리, 지메일 라벨 매핑, 2GB 업로드 | Takeout `.mbox`(1GB 이상) 1건 완주 |
| **I-3 IMAP** | `imapflow` 도입, 프리셋·연결 확인·폴더 선택·기간, 비밀번호 임시 보관·자동 삭제, 호스트 보안 검사, 증분 재실행 | 네이버·아마란스(허용 시) 각 1계정 완주, 비밀번호 삭제 확인, 원 메일함 읽음 상태 무변화 |
| **I-4 운영** | 관리자 현황, 아마란스 2단계 전환 시 전원 마지막 증분 안내, 처리량 실측값 문구 반영 | 전환 체크리스트에 포함 |

배포는 단계마다 마이그 적용 → Next 배포 순서. 새 표만 추가하므로 ADT·intel 배치와 무관하다.

## 9. 결정 사항 — 2026-10-16 확정(권장안대로)

| # | 질문 | 확정 |
|---|---|---|
| D-1 | IMAP 비밀번호를 **처리 기간 동안만 암호화 보관**(최대 7일, 끝나면 삭제)해도 되는가 | **허용** — 완료·실패·취소·7일 경과 시 즉시 삭제, 앱 비밀번호 사용 권장 |
| D-2 | 새 의존성 `imapflow` 도입 | **도입** |
| D-3 | 가져온 받은 메일의 기본 위치 | **별도 폴더** "가져온 메일(원본)", 받은편지함 배치는 옵션 |
| D-4 | 한 사람당 가져오기 용량 상한 | **별도 상한 없음** — 메일함 용량 배분을 따름 |

## 10. 위험

| 위험 | 대응 |
|---|---|
| 아마란스가 IMAP 로그인을 막아 둠 | I-0에서 먼저 확인. 막혀 있고 풀 수 없으면 아마란스 메일은 **파일 경로**(직원이 메일을 `.eml`로 저장)만 가능 — 대량이면 비현실적이므로 더존 문의가 우선 |
| 대용량 계정(수만 통)으로 Next 서버 부하 | 전체 동시 1건·틱 40초 예산·야간 정지 시 자동 중단 후 재개 |
| 원 서버 계정 잠김(비밀번호 오류 반복) | 인증 실패는 재시도하지 않고 즉시 실패 처리 |
| 사적 메일 유입 | 폴더·기간 선택 기본값을 좁게(받은·보낸편지함만), 안내 문구 |
| 원문 저장 비용 | S3 표준 요금 수준(1만 통 ≈ 수 GB). 실측 후 필요하면 Intelligent-Tiering |
