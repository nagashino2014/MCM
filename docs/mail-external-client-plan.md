# 외부 메일 프로그램(IMAP/SMTP) 연동 — A안 구현 (배포 대기)

- 2026-10-21 오전 사용자 결정(F-13 잔여): 이번에는 구축하지 않음 → 같은 날 오후 사용자 지시로 **A안 착수·구현**.
- 게이트웨이 런타임: 쓸 만한 독립 Node IMAP 서버 라이브러리가 없어(wildduck imap-core 는 EUPL·MongoDB 결합) **Node+TS 로 IMAP4rev1 부분집합을 직접 구현**(사용자 선택). SMTP 제출은 `smtp-server`(MIT-0, 3.19.17 고정).
- POP3 는 만들지 않는다(IMAP 으로 충분, 메일함 동기화가 안 되는 방식이라 혼란만 늘어남).

## 1. 구조

```
아웃룩·휴대폰 메일 앱
   │ TLS 993(IMAPS) / 465(SMTPS)
   ▼
NLB(인터넷, ACM 인증서로 TLS 종료, 대상 그룹 proxy_protocol_v2)
   │ 평문 TCP 1143 / 1465 + PROXY v2 헤더(원 IP)
   ▼
Fargate 1태스크 = next 이미지, 명령만 `node .next/mail-gateway.cjs`
   ├─ IMAP 세션 → DB(mail_folders·mail_message_state·mail_messages) + S3(app_data)
   └─ SMTP 제출 → SES(SendEmail Raw) + 보낸편지함 사본
```

- 메일함 원본은 그대로 DB 다. 웹·모바일과 같은 메일함이라 읽음(\Seen=is_read)·별표(\Flagged=is_starred)·이동·삭제가 서로 맞춰진다.
- 다른 연결(웹·다른 PC)의 변경은 NOOP·IDLE(10초 조회)·UID 명령 끝에서 EXISTS·EXPUNGE·FETCH FLAGS 로 알린다.

## 2. 데이터(306_mail_external_client.sql)

| 대상 | 내용 |
|---|---|
| `mail_app_passwords` | 계정별 앱 비밀번호(bcrypt 해시, 이름, 마지막 사용 시각·IP·프로토콜, 폐기 시각). 계정당 활성 5개 |
| `mail_folders.imap_uidvalidity·imap_uidnext` | 폴더별 UIDVALIDITY·다음 UID |
| `mail_message_state.imap_uid·imap_flags` | 배치(폴더 안 메일)별 UID, IMAP 전용 플래그(\Answered·\Deleted·\Draft·키워드) |
| 트리거 `mail_state_assign_imap_uid` | INSERT·`UPDATE OF folder_id` 때 폴더의 다음 UID 부여 — 웹의 이동(삭제 후 재삽입)·분류 삭제(UPDATE)·수신·발송·가져오기 모든 경로 공통 |
| `mail_messages.imap_raw_key·imap_raw_size·imap_header·imap_structure` | 원문 확정 캐시(아래 §3) |

- 기존 배치 UID 백필은 표 잠금 아래 한 트랜잭션(BEGIN…COMMIT)으로 한다. 멱등(재적용 시 변경 없음).
- 연결 설정(사용 여부·서버 주소·포트)은 `mail_settings` key `external_client`(JSON). 기본 꺼짐.

## 3. 원문 확정(같은 UID = 같은 바이트)

IMAP 은 한 UID 의 내용이 바뀌면 안 된다. 처음 FETCH 할 때 원문을 정하고 고정한다.
1. 가져오기·외부 프로그램 APPEND 원문(app_data `mail-import/`·`mail-client/`) → 그 키를 그대로 쓴다.
2. 수신 원문(수신 버킷 `inbound/`, 90일 수명주기) → 읽어서 app_data `mail-imap/{메일함}/{id}-{해시}.eml` 로 복사.
3. 원문이 없으면(웹 발송 사본·90일 지난 수신) DB 내용(본문·첨부)으로 MIME 재구성 → 같은 위치에 저장.
4. 크기·헤더 블록·BODYSTRUCTURE 요약을 `mail_messages.imap_*` 에 기록(먼저 쓴 쪽이 이김 — 동시 확정 경합 시 진 쪽은 이긴 값을 씀).

첫 동기화 때 메일 수만큼 확정이 일어나 오래 걸릴 수 있다(동시 6건).

## 4. IMAP 범위

CAPABILITY `IMAP4rev1 LITERAL+ SASL-IR AUTH=PLAIN AUTH=LOGIN ID IDLE NAMESPACE UIDPLUS MOVE UNSELECT SPECIAL-USE CHILDREN`.
- 폴더: 받은편지함=`INBOX`, 나머지는 DB 이름(한글, 변형 UTF-7). 시스템 폴더에 SPECIAL-USE(\Sent·\Drafts·\Trash·\Junk·\Archive). 분류(카테고리) 폴더는 일반 폴더로 보이고 CREATE·RENAME·DELETE 가능(DELETE 는 웹과 같이 안의 메일을 휴지통으로).
- FETCH: FLAGS·UID·INTERNALDATE(=created_at)·RFC822.SIZE·ENVELOPE·BODY·BODYSTRUCTURE·BODY[섹션](HEADER·HEADER.FIELDS(.NOT)·TEXT·MIME·파트 번호·부분 범위)·RFC822(.HEADER/.TEXT). 헤더만 필요한 요청은 S3 를 읽지 않는다.
- SEARCH: 플래그·날짜·크기·주소·제목·UID·시퀀스·NOT/OR/괄호, BODY·TEXT 는 DB ILIKE. 저장 열에 없는 HEADER 검색은 근사.
- STORE·COPY(COPYUID)·MOVE·EXPUNGE·UID EXPUNGE·CLOSE·APPEND(APPENDUID, 같은 Message-ID 는 한 통으로 합침).
- EXPUNGE 로 어느 폴더에도 남지 않은 메일은 웹 [영구 삭제]처럼 지운다.
- 하지 않는 것: CONDSTORE/QRESYNC, \Recent(항상 0), 받은편지함 안 분류 라벨 노출, NOTIFY.

## 5. 인증·보안

- 사용자 이름 = 내 메일 주소(원장의 어느 주소든), 비밀번호 = 앱 비밀번호(공백 무시). 앱 로그인 비밀번호는 쓰지 않는다.
- 로그인마다: 기능 켜짐·메일함 active·계정(users.status) active 확인. 실패 잠금은 `login_attempts`(키 `mailgw:<주소>`, 웹 로그인과 분리 — IMAP 실패로 웹 로그인이 잠기지 않게), 실패 응답 1초 지연.
- 세션 유지 중 1분마다 재확인 — 앱 비밀번호 폐기·퇴사(계정 비활성)·기능 끔이면 `* BYE` 로 끊는다.
- 접속기록: `access_log`(action login, target_kind `mail_client`) — 같은 비밀번호·IP·프로토콜은 30분에 한 번. 앱 비밀번호 발급·폐기·연결 설정 변경은 `admin_change`.
- SMTP: 봉투 MAIL FROM·헤더 From 모두 내 발신 가능 주소여야(위조 553). Bcc 헤더는 바깥 원문에서 제거, 보낸 사본에는 숨은 수신자를 Bcc 로 남김. Message-ID·Date 없으면 보충. 같은 Message-ID 재제출은 한 번만(`mail_send_log` dedup `smtp:…`). 메일함당 시간당 200건, 수신자 100명, 원문 36MB. 사내 수신자 단락(280)은 웹 발송과 같다. 수신 확인 픽셀은 붙이지 않는다(원문을 고치지 않음).
- 연결 제한: IP 당 40, 전체 1000.

## 6. 화면·매뉴얼

- 메일 설정 → [외부 메일 프로그램]: 서버 정보 표, 앱 비밀번호 목록(마지막 사용)·[앱 비밀번호 만들기]·[폐기]. 관리자는 같은 칸에서 연결 허용·서버 주소를 정한다. 꺼져 있으면 직원에게 칸이 보이지 않는다.
- 매뉴얼 `mail.box` 절 `external-client`, 도움말 `mail.external-client`, 변경 기록 1줄.

## 7. 코드 위치

| 파일 | 역할 |
|---|---|
| `frontend/lib/mail/gateway/imap-wire.ts` | 명령 읽기(리터럴·LITERAL+)·토큰화·응답 인코딩·시퀀스 집합 |
| `…/imap-session.ts` | IMAP 상태기계(저장소 인터페이스만 사용) |
| `…/mime-tree.ts` | 원문 MIME 트리(바이트 위치)·BODYSTRUCTURE·ENVELOPE·섹션 |
| `…/imap-search.ts`·`mutf7.ts`·`proxy-protocol.ts` | 검색·폴더 이름 인코딩·PROXY v2 |
| `…/pg-store.ts` | 저장소 구현(DB·S3·인증·원문 확정) |
| `…/smtp-prepare.ts`·`smtp-submit.ts` | SMTP 원문 점검(순수)·제출(SES·사본) |
| `…/server.ts`, `frontend/scripts/mail-gateway.ts` | 소켓 서버·헬스 체크(8025, DB 미조회)·엔트리(esbuild 번들, `build-batch.mjs`) |
| `frontend/lib/mail/app-passwords.ts`, `app/api/mail/external-client/route.ts`, `components/mail/MailExternalClientSection.tsx` | 앱 비밀번호·연결 설정·화면 |
| `infra/aws/mail-gateway.tf`, `infra/aws/ops/staging-deploy-mail-gateway.ps1` | NLB·ACM·Route53·SG·ECS(기본 꺼짐), 배포 |

## 8. 검증(2026-10-21)

- `npm run test:mail-gateway` 15건: 파서·토큰·시퀀스·mUTF-7(RFC 3501 예시)·MIME/BODYSTRUCTURE/섹션·ENVELOPE(그룹·한글)·SEARCH·PROXY v2·SMTP 보정·세션 종단(인증 3종·LIST/STATUS/SELECT/FETCH/STORE/SEARCH·COPY/MOVE/EXPUNGE/APPEND·IDLE·폐기 BYE).
- 실제 소켓: PROXY v2 원 IP 전달, IMAP 로그인·LIST, SMTP EHLO·AUTH PLAIN·위조 발신 553.
- 일회용 PostgreSQL 17(기존 메일 마이그레이션 041·095~098·102·103·280·305 + 306 두 번)에서 실제 저장소 통합 시나리오: 백필 UID·재적용 멱등, 퇴사 계정 거절, 접속기록·마지막 사용, 원문 재구성 확정·크기 불변, 웹 휴지통 이동 → NOOP EXPUNGE, MOVE(UPDATE 경로 새 UID·분류 라벨), APPEND 중복 합침, EXPUNGE 영구 삭제, 폴더 생성·이름 변경·삭제, 웹 분류 삭제 후 UID 중복 없음, SES 실패 시 발송 로그 선점 해제, 폐기 후 BYE.
- ⚠ **실제 스테이징 스키마 덤프에서의 설치 리허설은 하지 않았다** — 적용 전 스테이징 스키마 복제본에서 306 설치·재적용을 먼저 돌린다(`mail_message_state` 행 수만큼 백필 UPDATE, 적용 중 표 잠금).
- 화면은 DB 가 없어 실제 렌더 확인을 못 했다(타입 체크만). 306 적용·배포 후 라이트/다크·좁은 화면·키보드 확인 필요.

## 9. 켜는 순서(스테이징)

1. 스테이징 스키마 복제본에서 306 리허설 → `staging-apply-migrations.ps1 -Files 306_mail_external_client.sql`.
2. next 배포(`staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`) — 화면·API·게이트웨이 번들 포함.
3. 비용 확인 후 `terraform plan -var enable_mail_gateway=true -target=…`(mail-gateway.tf 머리말의 주소만) 검토 → 메일 MX·SES·bastion 변경이 섞이지 않았을 때만 같은 -target 으로 apply. 로컬 `infra/aws/staging.tfvars`(git 제외)에 `enable_mail_gateway = true` 를 남겨야 이후 plan 에서 지우려 들지 않는다.
4. `ops/staging-deploy-mail-gateway.ps1 -Wait` — next 태스크 정의(이미지·DB 시크릿)를 복제해 게이트웨이에 적용. 이후 next 를 배포할 때마다 이 스크립트도 실행한다.
5. 메일 설정 → 외부 메일 프로그램(관리자)에서 연결 허용 → 앱 비밀번호 발급 → 아웃룩 실기 확인(첫 동기화·보내기·보낸편지함 중복 없음·웹과 읽음 동기).

## 10. 남은 일·주의

- 비용: NLB 1 + Fargate 0.5vCPU/1GB 상시. 아웃룩을 켜 둔 PC 가 있으면 IDLE 조회로 Aurora 자동 일시정지가 일어나지 않는다. next 야간 정지 스케줄과 맞출지 결정 필요.
- 게이트웨이 1태스크라 배포·재시작 때 연결이 한 번 끊긴다(클라이언트가 재접속).
- IDLE 은 10초 DB 조회 — 사용자가 많아지면 LISTEN/NOTIFY 로 바꾼다.
- 관련: [메일 가져오기](mail-import-blueprint.md)는 바깥 서버에서 **가져오는** 기능으로 별개다.
