# 연차사용촉진제도 관리 블루프린트 (계획 — 확인 대기)

작성 2026-07-23. 근로기준법 연차사용촉진제도(1·2차 고지)를 전자결재 위에 얹는다.
직원별 휴가 관리(LM)의 후속. 첨부 양식 실측: `연차휴가 사용 촉구(이재영 부장).hwpx`.

## 1. 요구사항 (사용자)

### LM-P5(선행·독립)
- 영업 화면 아바타 중복(ProjectDetail `Avatar`·SalesFacilityInfoCard `HistAvatar`·
  EmployeeRegistryPanel 인라인)을 공용 `EmployeeAvatar`로 통일.

### 직원별 휴가 관리 화면 변경
- 우상단 '연차 일괄 등록' 버튼 제거 → **'연차촉진제 관리'** 버튼 신설(별도 메뉴 진입).

### 연차촉진제도 관리 화면(신규, 메뉴명 '연차촉진제도 관리')
- 직원 리스트: 사진+성명+직함, 하단 소진율 바(기존 재사용).
- 직원 열↔부서 열 사이에 **소진율 열** 추가(현재 연차 소진율).
- '규정 발생'·'연차 외' 열 제거. 대신 **'1차 고지'·'2차 고지' 열**: 고지일자 + 하단
  작은 태그로 제출 여부(제출/미제출). 1차 제출 시 2차는 공란.
- 상단 KPI(좌→우): **평균 고지 제출율**(1·2차 포함)·**평균 연차 소진율**·**평균 연차
  사용일수**·**평균 연차 잔여일수**.
- KPI 우상단: **'연차 고지 양식 관리'** 버튼 + **'연차 고지 발송'** 버튼.

### 양식 관리
- 첨부 hwpx 1차 고지 양식 마이그레이션 후 **웹 편집으로 문구 수정** 가능.
- 양식 구조(실측): 제목「연차휴가 사용 촉구(1차)」 / [성명·발생연차·사용연차·잔여연차 표] /
  촉구 본문(발생 N·사용 M·잔여 K 치환) / 「연차휴가 사용예정일 기재요망(총 K일)」 / 고지일자.

### 발송 워크플로
- **1차 고지**: 대상 전원에게 일괄 생성·발송. 기간 매년 **7/1~7/20**, 발송은 **7/1**
  (7/1 전 버튼 비활성). 수신 고지에 **사용계획 입력(사용 날짜)** + **전자서명**.
- 발송 알림 → (추후) 모바일 앱 알림 + **홈 '수신 문서함'(신설)**.
- **2차 고지**: 1차 기간 종료 후 발송 버튼 → **미제출자 명단 모달**(열: 성명/직함·부서·
  소진율·잔여·사용·부여). 인원 클릭 → 하단에 **회사 지정일 입력(8자리 YYYYMMDD) 다수** +
  우측 태그. 상단 '미사용일수', 하단 '잔여일수'(미사용 − 지정일수, 날짜 입력마다 −1).
  2차 문구는 1차 참고 + **회사 지정 사용 촉구** 취지 반영. 명단 우하단 발송 버튼 —
  대상들의 '잔여일수'가 0이면 2차 고지서 생성·발송.

## 2. 재사용 자산
- EmployeeAvatar(LM-P3)·소진율 바·KPI 카드·AutoDateInput(8자리)·전자결재 문서/수신 개념.
- 직원 집계(listLeaveSummary: granted/usedAnnual/remaining/rate)·leave_types.

## 3. 데이터 모델 초안 (088~)
- `leave_notice_templates(round int PK{1,2}, title, body jsonb(문단·치환 토큰), updated_at)` —
  양식 문구 템플릿(웹 편집). 치환 토큰: {name}{granted}{used}{remaining}{deadline}{noticeDate}.
- `leave_notices(notice_id PK, year, round, employee_id, granted/used/remaining(스냅샷),
  notice_date, deadline, status(sent|submitted|assigned), sent_by, sent_at,
  plan jsonb(직원 사용예정일 배열), assigned jsonb(2차 회사 지정일 배열),
  signature text(전자서명), submitted_at)` — 고지 1건.
  UNIQUE(year, round, employee_id).
- 수신 문서함 = leave_notices 를 수신자(employee_id) 기준 조회(별도 테이블 불필요).

## 4. 구현 단계 (안)
- **LP-P1 (완료)**: LM-P5 아바타 통일 + 직원별 휴가 관리 버튼 교체 + 088 스키마 +
  연차촉진제도 관리 화면(리스트·소진율 열·1/2차 고지 열·KPI 4종·양식/발송 버튼 골격).
- **LP-P2 (완료)**: 양식 관리(웹 문구 편집·치환 토큰·미리보기) + 1차 발송(7/1~7/20 게이팅·
  잔여>0 미발송 전원 일괄 생성) + 홈 수신 문서함 위젯 + 회신(사용예정일 다건·클릭 전자서명).
  - lib: `leave-promotion-tokens.ts`(순수 치환), `leave-promotion.ts` 확장(템플릿 CRUD·
    sendFirstNotices·listMyNotices·submitNoticePlan). API: `leave-promotion/templates`(GET/PUT)·
    `leave-promotion/send`(POST)·`home/leave-notices`(GET)·`leave-notices/[id]/submit`(POST).
  - UI: `LeavePromotionBoard` 버튼 활성화 + `TemplateEditor` 오버레이,
    `LeaveNoticeInboxCard`(홈, 수신 고지 없으면 위젯 숨김).
- **LP-P3**: 2차 고지(미제출 모달·회사 지정일·잔여 0 검증·발송).
- **LP-P4**: 알림 연동(수신 문서함 배지, 모바일 앱은 추후).

## 5. 확정 결정 (2026-07-23)
1. **수신 문서함 = 메인 홈(/home)** 위젯 신설.
2. **전자서명 = 클릭 동의**(성명+사번+타임스탬프 기록, 법적 전자적 동의). 캔버스 불용.
3. **양식 편집 = 문구 템플릿 편집**(치환 토큰 {name}{granted}{used}{remaining}{deadline}
   {noticeDate}{planTotal}, 표·구조 고정).
4. **발송 알림 = 수신 문서함(화면)만**(v1). 모바일 앱 알림은 추후.
5. **고지 대상 = 잔여 연차 > 0 전원**(법상). 2차 = 1차 미제출자.
6. **기간 = 7/1~7/20 고정**(상수). 발송 버튼 7/1 전 비활성, 2차는 7/21+.
