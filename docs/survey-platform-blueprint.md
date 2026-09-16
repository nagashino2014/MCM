# 설문 플랫폼 블루프린트 (사내 설문 · 외부 설문 · QR 배포 이미지)

작성: 2026-09-16 · 브랜치 `claude/survey-platform` · 마이그레이션 `infra/aws/246_survey_platform.sql`

메뉴 **설문**(협업 그룹 맨 아래) 아래 **사내 설문**과 **외부 설문** 두 갈래를 둔다.

| 구분 | 용도 | 응답을 받는 곳 | 모바일 |
|---|---|---|---|
| 사내 설문 | 직원 의견 수렴(송년회 장소, 안전장구 치수 등) | **앱 자체**(로그인 기반, 1인 1회) | 탑재 |
| 외부 설문 | ESG 중대성평가·공급망평가·지속가능경영보고서 | **구글 폼**(앱은 초안·링크·QR 배포 이미지 관리) | 미탑재 |

외부 설문에 구글 폼을 쓰는 이유는 사용자 결정이다 — 피싱·악성코드 우려가 큰 요즘 낯선 도메인
링크보다 구글 폼 링크가 수신자에게 훨씬 잘 열린다.

## 1. 데이터 모델 (마이그 246)

- `surveys` — kind(internal/external) · status(draft/open/closed) · 기간 · 익명 여부 · 대상(`audience`)
  · 구글 폼 연결(`google_form_url` 등)
- `survey_questions` — seq 순서, qtype = single / multi / scale / text / longtext / section,
  보기는 `options` jsonb, 척도·기타입력 설정은 `config` jsonb
- `survey_responses` / `survey_answers` — 사내 응답. `(survey_id, user_id)` 유니크로 1인 1회를 DB 가 보장한다.
  **익명 설문도 user_id 는 저장**하되(중복 응답 차단) 집계 API 가 응답자 노출을 차단한다.
- `survey_notices` — QR 배포 이미지. layout(phone/mail) + `fields` jsonb(문구·로고·QR) + `theme` jsonb(CI 띠 색)

권한키는 `survey.view`(열람·집계) / `survey.manage`(작성·배포·삭제). 응답 API 만 로그인(`requireAuthenticated`)으로
열어 두어 전 직원이 참여한다 — 대신 대상·기간 검사는 서버가 한다.

## 2. 화면

| 경로 | 내용 |
|---|---|
| `/survey/internal` | 위: 내가 참여할 설문(카드) / 아래: 설문 관리 표(권한 있을 때만) |
| `/survey/internal/[surveyId]` | 편집 — 탭: 설정 · 문항 · 집계 |
| `/survey/internal/[surveyId]/respond` | 응답 화면(전 직원) |
| `/survey/external` · `/survey/external/[surveyId]` | 외부 설문 목록·편집(탭: 설정 · 문항 · 구글 폼·배포) |
| `/survey/notices` · `/survey/notices/[noticeId]` | QR 배포 이미지 목록·편집기 |

모바일(Expo): `surveys`(참여 목록) · `survey/[surveyId]`(응답). 더보기 탭 "협업" 묶음에 진입점.

관리 권한 판정은 별도 API 없이 `GET /api/survey/surveys` 의 403 으로 한다 — 일반 직원에게는
"참여할 설문"만 보이고 관리 영역은 렌더되지 않는다.

**문항 잠금**: 응답이 1건이라도 들어오면 문항 수정은 409 로 막는다(기존 답과 문항 대응이 깨진다).
바꾸려면 설문을 복제해 새로 연다.

## 3. 구글 폼 연동

`lib/survey/gas.ts` 가 설문 정의를 **Apps Script 소스**로 만든다(문항 유형 → `addMultipleChoiceItem`
/`addCheckboxItem`/`addScaleItem`/`addTextItem`/`addParagraphTextItem`/`addSectionHeaderItem`).

- **1단계(구현 완료)**: 편집 화면에서 `.gs` 를 내려받아 script.google.com 에 붙여넣고 `createSurveyForm`
  실행 → 로그의 응답 URL 을 앱에 붙여 넣으면 이후(QR·배포 이미지)는 자동.
- **2단계(예정)**: Apps Script API(`script.projects.create` → `updateContent` → `scripts.run`)로 앱이 직접
  프로젝트를 만들고 실행한다. **Apps Script API 는 서비스 계정을 지원하지 않아 사용자 OAuth 가 필수**다
  (관리자가 회사 구글 계정을 1회 연결 → refresh token 보관). 스코프는
  `script.projects` + `forms`(+ 실행용 `script.external_request` 는 불필요).
  생성 로직은 1·2단계가 **같은 `buildFormScript` 를 공유**해야 결과가 어긋나지 않는다.
  저장 자리는 이미 있다 — `surveys.google_script_id` / `google_form_id` / `google_synced_at`.

척도는 Apps Script 제약(하한 0~1, 상한 3~10)에 맞춰 범위를 자동으로 조정한다.

## 4. QR 배포 이미지

핸드오프 시안(`design_handoff_survey_qr_notice`)의 확정 수치를 그대로 옮긴 **고정 레이아웃 2종**이다.
채용공고처럼 임의 노드트리를 편집하는 대신 **필드 폼**으로 간 이유: QR·로고·CI 색상 자동화와 맞물리고
캔버스가 깨지지 않는다.

- 스마트폰 배포용 1080×1920 / 메일 첨부용 1600×900 — 실제 크기로 렌더하고 미리보기만 `scale()` 로 축소
- 편집 필드: 대상 기관명 · 배지(문구·색) · 제목 · 설명 · 조사 기간 · 소요 시간 · 주관(주/부/부기) · QR 캡션
- QR: 설문 링크를 서버(`qrcode` 패키지, 오류정정 Q)에서 PNG data URI 로 생성 → 캔버스에 `pixelated` 렌더
- **로고 CI 색상 자동 검출**(`lib/survey/logo-colors.ts`): 업로드한 로고를 캔버스로 축소해 픽셀을 훑고,
  무채색·투명 픽셀을 제외한 뒤 12° 색상 버킷으로 모아 인접 색을 병합한다. 점유율 6% 미만은 버리고
  최대 4색까지 점유율 순으로 낸다. **대표색 평균은 채도 0.45 이상인 선명한 픽셀만** 쓴다 — 경계의
  안티에일리어싱 픽셀까지 섞으면 원색보다 흐린 색이 나온다.
  띠는 검출된 색 개수만큼 가로를 등분한다(1색=단색, 2색=2등분, 3색=3등분…). 편집기에서 색·순서 수정 가능.

### 실측 근거 (경상북도개발공사 CI, 288×198 PNG)

| 항목 | 값 |
|---|---|
| 로고 원색(픽셀 직접 집계) | `#0BAFEC` 파랑 · `#8FC544` 연두 · `#EBE829` 노랑 |
| 검출 결과 | `#10B0E6` (61.3%) · `#91C747` (19.3%) · `#E3E62E` (19.1%), 18ms |
| 개선 전(전체 평균) | `#15AEE2` · `#91C748` · `#DCDF31` — 노랑이 연두빛으로 흐려졌다 |

## 5. 내보내기에서 겪은 함정

`html-to-image` **1.11.13 은 캡처 때 문서의 웹폰트 CSS 를 통째로 수집·인라인하려다 극단적으로 느려진다.**
같은 캔버스(1080×1920, data URI 로고·QR 포함) 실측:

| 조건 | 소요 | 결과 PNG 길이 |
|---|---|---|
| 1.11.13 기본 | 25,382ms | 390,458 |
| 1.11.13 + `skipFonts: true` | 51ms | 390,458 |
| 1.11.11 기본 | 42ms | 390,458 |

→ `lib/survey/export.ts` 는 `skipFonts: true` 로 캡처한다(결과 이미지는 동일). 캡처는 폰트가 이미 로드된
같은 브라우저에서 이뤄지므로 임베딩이 필요 없다.
**채용공고(`lib/recruit/export.ts`)도 같은 경로를 쓰므로 같은 지연이 있을 것** — 별도 확인 과제로 남긴다.

캔버스에는 `box-sizing: border-box` 를 명시한다. 기본값(content-box)에서는 패딩 96px 이 높이에 더해져
1920px 캔버스가 2016px 로 커지고 하단 정보 바가 잘린다(실측).

## 6. 다음 단계 — 설문 통계 화면 (SV-P2)

1단계의 집계(`SurveyResultsPanel`)는 **문항별 단순 분포**까지다 — 막대·척도 평균·자유응답 나열.
다음 단계에서 이것을 **사내·외부 공통의 통계 화면**으로 키운다. 외부 설문은 응답이 구글 폼에 있으므로
**응답 동기화가 선행 조건**이고, 사내 설문은 이미 DB에 있어 화면만 올리면 된다.

화면은 기존 편집 화면의 "집계" 탭을 확장한다(새 메뉴를 만들지 않는다). 차트는 앱 표준인
**ApexCharts**(`react-apexcharts`)를 쓰고, 색은 `--cd-*` 토큰을 따른다. 인쇄·보고서 첨부를 위해
화면 전체 PDF 내보내기를 붙인다(`lib/recruit/export.ts` 의 `exportElementPdf` 경로 재사용 —
단, §5 의 `skipFonts` 확인 후).

### 6.1 단계 구분

| 단계 | 내용 | 선행 조건 |
|---|---|---|
| **SV-P2a** | 사내 설문 통계 고도화 | 없음(현 DB로 가능) |
| **SV-P2b** | 외부 설문 응답 동기화 | 구글 OAuth(SV-P3) |
| **SV-P2c** | ESG 중대성 매트릭스 | P2a + P2b |

### 6.2 SV-P2a — 사내 설문 통계

현 `getResults()` 는 문항별 집계만 낸다. 다음을 더한다.

- **요약 카드**: 응답 수 / 대상 인원 / 응답률 / 평균 소요(첫 응답~제출 간격은 현재 미기록 → 아래 DB 변경)
  / 일자별 응답 추이(라인 차트) — 접수 기간 중 독려 시점 판단에 쓴다.
- **부서별 응답률 표**: `employee_profiles.dept_id` 기준. **익명 설문에서도 부서 단위 집계는 허용하되,
  한 부서의 응답이 3건 미만이면 수치를 가린다**(작은 부서에서 역추적되는 것을 막는 k-익명 최소 기준).
- **교차 분석(크로스탭)**: 문항 A의 보기별로 문항 B의 분포를 보는 2차원 표 + 100% 누적 막대.
  ESG·만족도 설문에서 "부서별로 중요 이슈가 다른가"를 보는 핵심 기능. 축은 화면에서 고르게 한다
  (기준 축 = single/scale 문항 또는 부서, 값 축 = 아무 문항).
- **척도 문항 랭킹**: 평균 내림차순 가로 막대 + 표준편차(의견이 갈린 항목 표시). 중대성평가에서
  "합의된 이슈"와 "이견이 큰 이슈"를 가르는 근거.
- **자유응답 보조**: 길이순·가나다순 정렬, 키워드 검색, 형태소 없이 **공백 단위 빈출어 상위 20개**
  (불용어 목록은 상수로). AI 요약은 붙이지 않는다 — 비용·환각 위험 대비 이득이 적다.
- **내보내기**: 현 CSV 에 더해 **엑셀(xlsx, `exceljs` 기존 의존성)** — 시트 3장(요약 / 문항별 / 원자료)과
  화면 PDF.

**DB 변경(마이그 247 예정)**
```sql
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS started_at text;   -- 소요 시간 산출
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS dept_id   text;    -- 응답 시점 부서 스냅샷
```
부서는 **응답 시점 값을 복사해 둔다** — 인사이동 뒤 과거 설문을 열면 부서별 집계가 달라지기 때문이다.

### 6.3 SV-P2b — 외부 설문 응답 동기화

구글 폼 응답을 앱으로 끌어와야 외부 설문도 같은 화면에서 본다. 두 경로 중 **A안**을 기본으로 한다.

- **A안(권장) — Forms API 폴링**: OAuth 토큰으로 `forms.responses.list` 를 호출해 증분 수집
  (마지막 동기화 시각 이후만). 편집 화면의 "지금 동기화" 버튼 + 접수 중 설문 하루 1회 배치.
  구글 쪽 설정이 필요 없고, 실패해도 다시 당기면 된다.
- **B안 — Apps Script `onFormSubmit` 트리거가 앱으로 POST**: 실시간이지만 스크립트에 외부 요청
  권한과 공유 시크릿이 필요하고, 앱이 잠시 죽으면 그 응답이 유실된다. 실시간이 필요할 때만.

**저장 구조**: 문항 매핑은 `survey_questions.question_id` ↔ 구글 `itemId` 대응표가 필요하다.
`.gs` 생성 시 각 문항 제목 앞에 보이지 않는 키를 넣는 식의 꼼수는 쓰지 않고,
**폼 생성 결과(`createSurveyForm` 반환값)에 itemId 목록을 담아 받아 저장**한다.

```sql
ALTER TABLE survey_questions ADD COLUMN IF NOT EXISTS google_item_id text;
ALTER TABLE survey_responses DROP CONSTRAINT IF EXISTS survey_responses_source_check;
ALTER TABLE survey_responses ADD CONSTRAINT survey_responses_source_check
  CHECK (source IN ('web', 'mobile', 'google'));
ALTER TABLE survey_responses ADD COLUMN IF NOT EXISTS external_response_id text; -- 구글 응답 id(증분·중복 방지)
CREATE UNIQUE INDEX IF NOT EXISTS uq_survey_responses_external
  ON survey_responses(survey_id, external_response_id) WHERE external_response_id IS NOT NULL;
```
외부 응답은 `user_id` 가 없다 — 기존 `uq_survey_responses_user` 는 `user_id IS NOT NULL` 부분 인덱스라
그대로 공존한다. 집계 코드는 사내/외부 구분 없이 같은 테이블을 읽으면 된다.

### 6.4 SV-P2c — ESG 중대성 매트릭스

중대성평가의 산출물은 **이슈별 (내부 중요도 × 외부 중요도) 산포도**다. 지속가능경영보고서에
그대로 들어가는 그림이라 별도 화면으로 만든다.

- 같은 이슈 목록을 **내부 설문(임직원)과 외부 설문(이해관계자)** 두 건으로 받고, 편집 화면에서
  두 설문을 **짝지어 지정**한다(`surveys` 에 `paired_survey_id` 컬럼 추가).
- 이슈 대응은 **척도 문항의 제목 문자열**로 맞추지 말고, 문항에 `issue_code` 를 달아 잇는다
  (`survey_questions.issue_code` — 두 설문에서 같은 코드면 같은 이슈).
- 산포도: X=외부 평균, Y=내부 평균, 점 크기=응답 수, 사분면 경계는 전체 평균(또는 수동 지정).
  우상단이 "중대 이슈". 라벨 겹침은 ApexCharts `dataLabels` 로 두고 표로 함께 낸다.
- 이해관계자 그룹별 비교가 필요하므로 **외부 설문 첫 문항에 응답자 구분(single)** 을 두고,
  그 문항을 "그룹 축"으로 지정하는 설정을 둔다(고객·협력사·지역주민·주주 등).
- 산출: 매트릭스 PNG/PDF + 이슈별 점수 표 xlsx.

**작업량 감(대략)**: P2a 2~3일, P2b 2일(OAuth 완료 후), P2c 2~3일.

## 7. 남은 일

1. 마이그 246 적용 후 스테이징 실증(설문 작성 → 접수 → 응답 → 집계, 배포 이미지 생성 → PNG)
2. 구글 폼 자동 생성(SV-P3) — OAuth 연결 화면 + Apps Script API 호출
3. 통계 화면(SV-P2a~c, §6)
4. 모바일 OTA 발행(사내 설문 참여) — `eas update --branch <b> --environment production`
5. 알림 연계(설문 개시 시 푸시·메일) — 현재는 링크·QR 공유만
