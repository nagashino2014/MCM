# 외부 연동 상태 감시(쉐도우 모니터링) 블루프린트 — 초안 2026-10-30

## 0. 배경
2026-10-01 ADT·intel 스케줄의 고정 이미지(next:627)가 ECR 수명주기 규칙으로 만료돼 10-02부터 야간 intel
배치가 매일 `CannotPullContainerError`로 실패했다. EventBridge `FailedInvocations`는 0이었고(RunTask
호출 자체는 성공) 앱 안에도 "수집이 멈췄다"를 알리는 장치가 없어 **약 한 달 뒤 사람이 화면을 보고서야**
알았다. 수집 경로마다 실패 모양이 달라 "에러 로그 감시"로는 못 잡는다. 대신 **각 연동의 마지막 성공
시각(신선도)** 을 기대 주기와 비교해, 이상일 때만 알린다.

## 1. 원칙
- **결과 기준 감시**: 프로세스·로그가 아니라 "마지막 성공이 언제였나"를 본다. 이미지 만료·자격증명 만료·
  사내 PC 꺼짐·API 차단 등 원인이 무엇이든 신선도가 끊기면 잡힌다.
- **조용함**: 정상일 때는 아무것도 보내지 않는다. 이상 발생 1회 알림 → 지속 시 24시간마다 재알림 →
  복구 시 1회 복구 알림.
- **기존 부품 재사용**: 알림은 `alerts`(운영 알람 벨) + `sendPush` + 메일. `lib/ai/budget.ts`의
  `dispatch()`(alerts → push → 메일, 고유 색인으로 중복 방지)를 본뜬다.
- **Aurora auto-pause 보존**: 감시 틱이 야간에 DB를 깨우지 않도록 실행 시각을 제한한다(§4).

## 2. 감시 대상과 판정 기준(안)

| 키 | 대상 | 신선도 출처 | 기대 주기 → 이상 판정 |
|---|---|---|---|
| `intel.dart` 외 `intel.eiass`·`intel.news`·`intel.press`·`intel.gosi_me` | 야간 intel 배치(03시) | `intel_collect_state.last_run_at`(수집기 성공 시에만 갱신) | 매일 → 마지막 성공 > 28시간 |
| `intel.custom:<slug>` | 범용 스크래퍼 intel 소스 | 같은 표 `custom:<slug>` + `scraper_run_logs` 연속 오류 | 매일 → > 28시간 또는 3회 연속 error |
| `intel.gosi_eum` | 토지이음(사내 PC 08:30) | **신규**: gosi-eum-ingest 호출 시 `intel_collect_state('gosi_eum')` 갱신(0건이어도) | 매일 → > 30시간 |
| `adt.collector` | 캡스 근태 사내 수집기(매시 35분) | **신규**: 수집기가 보낼 파일이 없어도 심장박동 POST → 상태 기록 | 매시 → > 3시간 |
| `adt.events` | 근태 태그 자체 | `max(adt_event_raw.event_at)` | 평일 10~18시에 > 4시간 무태그(휴일 제외) |
| `bid.<slug>` | 나라장터 등 공공입찰 소스 | `scraper_sources.last_batch_date` + `scraper_run_logs` | 매일 batch_hour+2시간 지나도 오늘 미수집 |
| `barobill.bank` / `barobill.card` | 바로빌 계좌·카드 | `finance_sync_logs` 마지막 ok(KST 텍스트) | 매일 → > 30시간 또는 마지막이 error |
| `barobill.hometax` | 홈택스 세금계산서 | `finance_sync_logs kind='hometax'` | 수동 경로라 **오류만** 감시(§5 결정 3) |

- 같은 원인으로 intel 소스 5개가 한꺼번에 끊기면 알림은 **1건으로 묶는다**(대상 목록을 본문에).
- 바로빌은 지금 타이머가 없고 재무 화면을 열 때만 따라잡기 동기화가 돈다. 그대로 감시하면 주말마다
  오탐이 난다 → 감시 틱이 매일 06시 이후 첫 실행에서 `isSyncStale()`이면 `runFinanceSync()`를 먼저
  돌리고 판정한다(§5 결정 3).

## 3. 상태 기록·알림 흐름
- 신규 마이그레이션(번호는 착수 시 원격 전 브랜치 확인 후 확정, 현재 최고 314):
  `integration_health`(check_key PK, status ok|failing, failing_since, last_ok_at, last_checked_at,
  last_alert_at, detail jsonb). 판정 결과로 upsert.
- 전이별 동작:
  - ok → failing: `alerts`(severity error, source `integration`, code = check_key) + push + 메일
  - failing 지속: `last_alert_at`이 24시간 지났을 때만 재알림
  - failing → ok: 복구 알림 1회(push + 메일, alerts는 info)
- push: `PushEventKey`에 `ops.integration` 추가(EVENT_DEFAULT·PUSH_EVENTS 카탈로그 포함). 앱 설정 화면은
  서버 카탈로그 기반이라 앱 OTA 불필요.
- 메일: §5 결정 2.

## 4. 실행 위치·시각
- next 서비스 `instrumentation.ts`에 `integration-watch-tick` 추가(`callTick` 패턴, AUTH_SECRET 가드).
- 실행: **KST 08:10~20:10 매시 10분**(업무 시간엔 DB가 어차피 깨어 있음). 야간에는 돌지 않는다 —
  03시 배치 실패는 08:10 첫 실행에서 잡힌다(발견 지연 최대 5시간, 지금은 30일).
- 감시자 자신이 죽는 경우(next 서비스 정지)는 이 장치로 못 잡는다. ALB 헬스체크 경보 또는 CloudWatch
  경보(SNS 메일)는 범위 밖 후속으로 둔다.

## 5. 결정(2026-10-30 사용자 확정)
1. **수신자**: 시스템 관리자(`tpl-system-admin`) 전원 — ai-budget과 같은 해석, 설정 화면 없음
2. **메일 경로**: SES 발송(`sendNotifyEmail`, 발신 `no-reply@koensain.app`) → 수신자 등록 메일
3. **바로빌**: 감시 틱이 매일 06시 이후 첫 실행에서 `isSyncStale()`이면 `runFinanceSync()`까지 돌린 뒤 판정
4. **모바일 push 방해금지 시간**: 미결 — 실행이 08~20시라 기본(따름)으로 두고 필요 시 조정
5. **화면**: 관리 메뉴에 "연동 상태" 표(대상·마지막 성공·상태·최근 알림) 추가 — 사용 매뉴얼 기사 동반

### 착수 전 확인된 현행 결함(10-30 복구 실행에서 발견)
- 환경청 RSS 8곳(`gosi-client.ts:117` `https://www.me.go.kr/...`): `www.me.go.kr`이 `127.0.0.1`로 해석돼
  전부 ECONNREFUSED. 9월 말까지는 정상(10-01 배치 gosi scanned 100). 새 도메인 `www.mcee.go.kr` 응답 확인 —
  게시판 경로 이전 여부는 미확인. 이 감시가 있었다면 `intel.gosi_me`로 바로 잡혔을 결함이다.

## 6. 구현 현황(2026-10-30, 브랜치 `claude/integration-watchdog`, 미커밋·미배포)
- W0~W3 구현 완료: 316(심장박동·판정 상태·`ops.integration.view`), `lib/ops/integration-watch-core.ts`(순수 판정·전이,
  단위 테스트 8건 `npm run test:integration-watch`), `lib/ops/integration-watch.ts`(대상별 판정·저장·발송),
  `lib/ops/heartbeat.ts`, 틱 `/api/internal/integration-watch-tick`(10분 주기, KST 08~20시 시간당 1회, 메모리 판정),
  심장박동(intel-batch 소스별·gosi-eum-ingest·adt-events-ingest·캡스 수집기 빈 POST), push 이벤트 `ops.integration`,
  화면 `/admin/integrations`([지금 점검])·메뉴·권한·매뉴얼 기사 `admin.integrations`·도움말·변경 기록.
- 로컬 검증(일회용 PG 55432, AWS 자격증명 차단): 316 두 번 적용 멱등, 시나리오 4단계(신규 이상 5건 → 10분 뒤 재알림
  없음 → 25시간 뒤 지속 재알림·추가 이상 → DART 심장박동 성공 시 복구 알림), 화면 라이트·다크·375px, 운영 알람 벨 표시,
  자동 틱 1회(중복 알림 없음).
- 배포 시 주의: 야간 배치 심장박동은 **스케줄을 새 revision 으로 다시 고정해야** 쌓인다. 그 전에는 intel_collect_state·
  parse-empty 경보로 대신 판정한다(현 745 배치로도 환경청 RSS 0건이 잡힘). 캡스 수집기 심장박동은 이 PC 체크아웃이
  새 코드가 될 때부터.

## 7. 단계(원안)
- W0: 마이그레이션 + 판정기(`lib/ops/integration-watch.ts`, 순수 함수 판정 + 테스트) + 틱
- W1: 심장박동 2건(gosi-eum-ingest 기록, 캡스 수집기 빈 POST 허용)
- W2: 알림 발송(push 이벤트·메일·alerts) + 묶음·재알림·복구
- W3: (선택) 연동 상태 화면 + 매뉴얼
- 검증: 로컬 일회용 PG(⚠ 셸 AWS 자격증명 끊고 — 10-21 SES 실발송 사고)로 각 판정 경계값 시험,
  스테이징에서 의도적 신선도 조작 없이 실제 상태로 1회 dry-run(발송 없이 판정만 출력).
