# Claude 작업 인계서 — MCM RAG · 영업 발굴 확장

작성일: **2026-10-31, Asia/Seoul**  
작성 목적: 사용자가 이후의 수정·검증·운영 적용 작업을 Claude에서 이어가기 위한 전체 작업 인계.  
현재 결론: **1차 기능 구현과 로컬 실데이터·실제 AI API 검증을 완료했다. 운영 배포와 운영 데이터 정정은 아직 하지 않았다.**

## 1. 먼저 확인할 사항

1. **실제 작업본은 아래 worktree다.** 상위 MCM 폴더나 `C:/CodingProject/MCM`에서 구현을 이어가면 다른 코드를 수정할 수 있다.
   - 작업본: `C:/Users/nagas/Documents/MCM/worktrees/sales-intelligence-phase1`
   - 프론트엔드: 위 작업본의 `frontend`
   - 브랜치: `codex/sales-intelligence-phase1`
   - 현재 HEAD: `32d7a5c5088efeef65f1d4a24006512566f80fb7`
   - **구현 내용은 대규모 미커밋 변경과 미추적 파일에 있다.** 인계서 작성 전 `git status --porcelain` 항목은 213개였다. 이 숫자는 개별 파일 총수가 아니며 디렉터리 단위 표시도 포함한다.
   - 이번 작업에서는 커밋·푸시·병합·배포하지 않았다. 원격 브랜치에 구현이 올라가 있다고 가정하면 안 된다.
2. 작업본의 `CLAUDE.md`를 먼저 읽는다. 모바일 수정 시 `apps/mobile/AGENTS.md`, `apps/mobile/CLAUDE.md`도 읽는다. 인계서 작성 중 원격 fetch/pull은 하지 않았으므로 통합 전 원격 상태를 별도로 확인한다.
3. `git reset --hard`, `git clean`, `.next` 전체 삭제, 임시 PostgreSQL 폴더 삭제를 하지 않는다. 미커밋 구현과 실증 증거·DB가 사라질 수 있다.
4. 현재 localhost 화면은 **실제 공개 수집 자료와 실제 AI를 사용하는 별도 실증 서버**다. 계정은 로컬 시험 사용자 `u1/u2`이며, 운영 로그인·실제 조직 권한 검증을 완료한 환경은 아니다.
5. 최신 통과 보고서는 아래 **v5**다. 이전 실증 보고서들은 내용 검토 중 발견된 오류를 포함할 수 있으며 이력 보존을 위해 남겨 두었다. 과거 발행본을 수동으로 덮어쓰지 않았다.

### 바로 열어볼 최종 보고서

[최종 v5 브리핑 열기](http://127.0.0.1:4174/sales/rag?tab=scheduled&runId=ibr_3b8e3f259e9e47698ea24646a236ff9f)

| 항목 | 값 |
|---|---|
| 관심 분야 | 반도체 실제 수집 브리핑 · SK하이닉스 |
| 프로필 ID | `ibp_00839097a3824e21bbff85408d094321` |
| 실행 ID | `ibr_3b8e3f259e9e47698ea24646a236ff9f` |
| 보고서 ID | `irag_b7d2a0af0c9e4d87adb6da5836564835` |
| 결과 | 고정 근거 25개 → 인용 출처 10개 |
| 최종 분량 | 핵심 동향 5개 · 투자계획 4개 · 영업 시사점 6개 |
| 실제 모델 | `claude-sonnet-5` |
| 호출 기록 | 4시도: 성공 3, 연결 실패 1. 최초 초안 성공 후 검수 연결 실패, 재시도 초안·검수 성공 |
| 기록 비용 | $0.238259. 같은 회차의 실패 전 성공 초안까지 포함한 앱 기록이며, 최종 성공 2호출만의 비용이나 공급사 청구명세서가 아님 |
| PDF | 최종 검증 시 83,332바이트 |
| 정기 실행 | 해당 실증 프로필은 **중지 상태**로 보존 |

## 2. 사용자가 승인·요청한 범위

기존 수동 AI 브리핑을 유지하면서 관심 조건과 주기에 따라 보고서를 생성하고, 영업 실행으로 연결하는 기능을 구현했다.

| 구분 | 요청과 구현 내용 |
|---|---|
| B01 관심 분야 | 업종·지역·기업·정보 유형·금액·서비스·수신자·보고 수준·필수 소스 설정, 미리보기 |
| B02 정기 실행 | 매일·3일·매주·매월 KST, 월말 보정, 중복 방지, 실행권 선점·회수·재시도, 고정 근거 스냅샷 |
| B03 보고서 | 전체 조건 집계, 신규·변경·늦게 수집한 과거 자료 구분, 공식 산업동향·출처, 무변경 회차의 AI 호출 절약 |
| B04 전달·이력 | 사내 메일함·이메일·앱 알림, 채널별 성공·실패·불명 및 재시도, PDF·발행 이력 |
| B05 운영 관리 | 소스 신선도·실행 오류·전달 결과·비용 기록, 기존 AI 사용량 화면 재사용 |
| F01 중요 변화 | 확인된 단계·금액·취소 등의 중요 사건, 프로필 간 중복 방지, 야간 보류·일일 상한·익일 묶음 |
| F02 투자 프로젝트 | 복수 신호 연결, 공개 사실·사건 이력·원문 개정, 중복 병합·근거 분리 |
| F03 신규 사업장 | 미매칭 후보와 필드별 근거, 기존 사업장 연결·검토 등록·보류·제외 |
| F04 서비스 가설 | 통합허가·화학물질·HAPs·ESG·기타의 공개 근거와 확인 질문. 법적 의무 자동 확정 아님 |
| F05 우선순위 | 공개 근거 최대 85점, 권한 있는 내부 관계 최대 15점 별도 계산, 사유·규칙 버전·본인 전용 수동 조정 |
| F06 영업 연결 | 기존 영업·계약 연결, 신규 영업건 생성, 서비스·범위 등 기준의 중복 방지, 연결 해제 |
| F07 후속 활동 | 담당자·기한·행동 제안, 검토 후 채택·보류·제외, 기존 영업 예정 활동 생성·기한 경과 표시 |
| 추가 공식 정보원 | 통계·법령·KDI·기업 공식 발표 연결 및 권리 관리 |
| 추가 권한·공유 | 관리자·임원·영업담당자의 브리핑 생성·열람, 소유자 공유, RAG 공유 목록·앱 메일·모바일 푸시·1:1 메신저 옵션 |
| 추가 품질 개선 | 중복 기사 통합·충실한 대표 근거 선별, 동향 최대 15개·투자계획 최대 15개·시사점 최대 8개, 우선 검토 → 확인 필요 → 참고 정렬 |

공유는 동일 상대의 기존 DM을 재사용하고 없으면 생성하는 경로를 구현했다. 구조화된 브리핑 링크 카드와 모바일 딥링크를 연결했다. 보고서 소유자만 관리·공유하며, 전사 역할이 타인의 비공개 보고서를 자동 열람하게 만들지는 않았다.

`intel.briefing.view/create/share` 권한을 분리했다. 명시적 거부를 기존 영업 권한으로 우회하지 않는다. 정기 수신자 자동 공유와 소유자의 명시적 개별 공유를 구분한다. 열람·PDF·추가 분석·발송 시 현재 계정 권한과 정보원 이용 권리를 다시 검사한다.

**1차 범위 밖:** F08 이후의 방문 전용 브리핑·지도·경쟁 분석·고객별 규제 자동 판정·전사 성과/인력/수익 예측, 유료 시장 DB, 전체 업종·기업 전수 수집, 고객 대상 외부 영업메일 자동 발송. 첨부 PDF·이미지 OCR과 유료 기사 수집도 이번 완료 범위가 아니다.

## 3. 반드시 유지할 디자인 기준

사용자가 제공한 파일이 최종 기준이다.

- 원본: `C:/CodingProject/MCM/KESI_Frosted_디자인시스템_GPT공유용.md`
- 작업본 참조 사본: `docs/kesi-frosted-design-system-reference.md`
- 원래 공유한 링크: `https://claude.ai/artifact/2sXw65n2vBfVuaoGaS592n`
- **KESI Frosted가 이전 Precision 문서보다 우선**하며, 정본 토큰은 `frontend/components/cdash`다.
- Pretendard, 반경 10px, 400/500/600 굵기, 공통 글자·간격 스케일, 불투명 콘텐츠 면을 유지한다.
- 글라스는 사이드바·상단바, 그라데이션은 데스크톱 셸 바탕에만 사용한다. 카드 안 카드·KPI 타일·임의 전역 토큰 재정의를 추가하지 않는다.
- `CdPageHeader`, `CdTabs`, `CdTable`, `CdButton`, 입력·날짜·모달·드로어 등 기존 공통 컴포넌트를 재사용한다.
- 화면/흐름 변경 시 `frontend/content/manual/articles/sales.ts`, `help-topics/sales.ts`, `changelog.ts`를 함께 갱신한다.

## 4. 구현 위치 지도

아래 경로는 별도 표시가 없으면 **작업본 루트 기준**이다. 한 파일만 옮겨서 작동하는 변경이 아니므로 관련 API·스키마·모바일·테스트를 함께 검토한다.

| 영역 | 주요 위치 |
|---|---|
| 진입 화면 | `frontend/app/(app)/sales/rag/page.tsx`, `frontend/components/sales/intel/SalesIntelligenceBoard.tsx`, `RagBoard.tsx` |
| 새 화면 | 같은 컴포넌트 폴더의 `ScheduledBriefingPanel.tsx`, `ScheduledBriefingReport.tsx`, `BriefingReportView.tsx`, `BriefingShareModal.tsx`, `ProjectIntelligencePanel.tsx`, `FacilityCandidatesPanel.tsx`, `OfficialSourcesPanel.tsx`, `intelligence.css` |
| 정기 브리핑 | `frontend/lib/intel/briefing-{types,schedule,scheduler,store,runner,evidence,original-text,curation,report-policy,delivery,important,notification-policy}.ts` |
| 브리핑 권한·공유 | `frontend/lib/intel/briefing-access.ts`, `briefing-api-access.ts`, `briefing-share.ts`, `briefing-share-types.ts`, `briefing-share-mail.ts`, `frontend/config/menu-permissions.ts` |
| RAG·분류·수집 | `frontend/lib/intel/rag-queries.ts`, `rag-indexer.ts`, `intel-queries.ts`, `news-classifier.ts`, `news-content-quality.ts`, `collect-news.ts`, `collect-press.ts` |
| 투자 프로젝트 | `frontend/lib/intel/project-intelligence.ts`, `project-intelligence-{api,rules,types}.ts`, 기존 `frontend/lib/sales/{queries,types}.ts` |
| 공식 소스 | `frontend/lib/intel/official-sources*.ts`, 기존 `frontend/lib/scraper/sources-store.ts` |
| API | `frontend/app/api/sales/rag/{profiles,runs,briefings}/`, `frontend/app/api/sales/intel/{actions,candidates,official-sources,projects}/`, `frontend/app/api/internal/intel-briefing-tick/` |
| 채널 연계 | `frontend/lib/chat/queries.ts`, `lib/mail/messages.ts`, `lib/notify/{email-ses,push-expo}.ts`, `frontend/components/mail/MailViewerPane.tsx` |
| 모바일 | `apps/mobile/src/app/briefings/`, `app/chat/[roomId].tsx`, `app/mail/[messageId].tsx`, `app/_layout.tsx`, `lib/deeplink.ts`, 웹 내보내기 `frontend/public/m-app/` |
| AI·기동 | `frontend/lib/ai/{claude-client,features}.ts`, `frontend/instrumentation.ts`, `frontend/scripts/intel-briefing-batch.ts`, `frontend/scripts/build-batch.mjs` |
| 로컬 서버 | `scripts/start-local-intelligence-demo.ps1`, `stop-local-intelligence-demo.ps1`, `start-intelligence-source-tunnel.ps1`, `frontend/scripts/local-intelligence-*` |
| 원자료 감사·정정 | `frontend/scripts/audit-local-intelligence-content.mjs`, `repair-local-intelligence-content.mjs`, `test-local-intelligence-content-quality.mjs` |
| 매뉴얼 | `frontend/content/manual/articles/sales.ts`, `help-topics/sales.ts`, `changelog.ts` |

### DB・배치 파일

순서는 다음과 같다. **운영 DB에는 미적용**이다. 번호 충돌과 실제 스키마는 운영 적용 전에 다시 확인한다.

1. `infra/aws/319_official_intelligence_sources.sql`
2. `infra/aws/320_project_intelligence.sql`
3. `infra/aws/321_scheduled_intelligence_briefings.sql`
4. `infra/aws/322_briefing_access_permissions.sql`
5. `infra/aws/323_briefing_share_deliveries.sql`

전용 작업 정의 생성 도구는 `infra/aws/ops/prepare-intel-briefing-task.mjs`, 실행 권한 구성은 `infra/aws/intel-briefing-worker.tf`다. 기존 메일·메신저 기반 스키마가 선행되어야 한다. 작업 정의 생성기는 검토용 JSON을 만들며 AWS에 자동 등록하지 않는다.

319~323만 빈 DB에 적용하는 절차가 아니다. 기존 users/권한·사업장/영업·intel/RAG·공유 테이블이 필요하며, 323은 `145_chat_core.sql`의 채팅 테이블을 전제로 한다. 322는 관리자·대표·임원·영업 템플릿에 권한을 추가하지만 실제 사용자별 할당을 일괄 변경하지 않는다. 로컬 축약 초기화가 운영 전체 마이그레이션을 대신하지 않는다.

## 5. 원자료 제목·요약 불일치의 원인과 수정

### 확인된 원인

- 초기 뉴스 30건의 원본 DB와 로컬 제목·요약·URL 대조에서 가져오기 불일치는 0건이었다.
- 기존 분류기가 네이버 검색 발췌를 충분한 기사 본문처럼 다루고 투자 중심으로 자유 요약했다. 인사·주가·주택·안전 기사에 배경으로 등장한 공장 이야기가 신규 투자로 승격됐다.
- 정부의 촉구·전망과 기업의 실제 투자 결정을 혼동했다. 여러 기업이 나오는 기사에서 행위 주체를 추정하거나 줄임표 뒤의 빠진 문장을 보완했다.
- 같은 URL의 기존 자료는 수집 시 건너뛰므로 수집기 수정만으로 과거 오분류가 고쳐지지 않았다.
- 보도자료 1건은 국가산단 LNG 발전소 3사와 별도 SK하이닉스 단지의 방류·가동 목표를 합쳐 주체·지역을 잘못 구성했다.

### 분류·자료 경로 수정

- `classifyNewsDetailed`가 `search_excerpt`와 `full_text`를 구분한다. 뉴스 검색 발췌와 보도자료 목록 요약은 본문 전체가 아니다.
- 모델은 서버가 제시한 근거 ID를 선택한다. 서버가 실제 원문 문자열로 복원하고 회사·지역·규모·기간 및 인용 일치를 검증한다.
- 직접 투자 채택에는 같은 완결 구간의 주체·시설·행위 근거가 필요하다. 줄임표를 넘어 생략된 행위를 추론하지 않는다.
- 검색 발췌는 최대 후보 등급으로 제한한다. 배경·촉구·협상·미완 문장은 근거 수준에 맞춰 배경 또는 확인 필요로 남긴다.
- 품질 표시는 **`raw_json.classification.contentQuality`**에 저장한다. 버전은 `news-grounded-v1`, 입력 해시는 제목·원문·입력 종류를 포함한다.
- 채택 요약은 검증된 원문 인용으로 구성하고, 비채택 요약은 기사 제목과 고정 분류 설명으로 주제를 보존한다.
- 품질 보류 자료와 그 파생 근거는 새 검색·인덱싱·발굴·브리핑에서 제외한다. 품질 표시가 없는 기존 전체 자료를 무조건 삭제·차단하는 방식은 아니다.
- 생성 직전과 발행 직전에 현재 품질을 다시 확인한다. 과거 스냅샷을 이용한 재시도·추가 분석에서 보류 자료가 다시 들어가는 것도 막는다.
- `BriefingEvidence`에 `originalText`, `qualityInputKind`를 추가해 원문과 파생 요약을 구분했다. 오래된 임베딩 본문이 현재 자료와 다르면 기존 본문을 다시 쓰지 않고 현재 자료 검색으로 전환한다. 전체 유료 재임베딩은 실행하지 않았다.
- 로컬 importer는 공개 발췌·보도자료 본문만 필요한 범위로 가져온다. 원본이 변하지 않은 재가져오기로 로컬 정정을 덮어쓰지 않으며, 입력 변경 시 재검토가 필요하다.

### 실제 정정 범위

**로컬 `intel_live`의 뉴스 30건 + 보도자료 1건만 정정했다.** 원본 운영 DB에는 쓰지 않았다.

| 결과 | 건수 | 의미 |
|---|---:|---|
| accepted | 4 | 공개 발췌를 후보 근거로 사용할 수 있음. 확정 투자 인증 아님 |
| background | 16 | 기사 중심 사건이 신규 투자 사실이 아니므로 투자 근거에서 제외 |
| needs_review | 11 | 주체·행위·기간 등 근거 부족으로 확인 필요 |
| 기술 처리 실패 | 0 | 의미상 보류와 API/처리 실패를 구분해 해결 |

정정 전 원장은 `local_intelligence_content_repairs`에 보존한다. 원본 31건의 제목·요약·발췌/본문·분류 불변, 과거 발행본 보존, 재가져오기 후 로컬 정정 보존을 확인했다. **운영 원본의 과거 오분류와 전체 수집 DB 소급 정정은 남은 작업이다.**

주요 양성 근거와 주의점:

| 로컬 신호 ID | 유지한 내용·범위 |
|---|---|
| `lives_656c96f6e1c8e9e37cfbe581` | Y2 35.2조원, M17 19.1조원은 서로 다른 시설. 2026-09-15 보도의 ‘지난달’은 8월. ‘지난해’는 매출 비교 연도 |
| `lives_eda4fac83574a5ca82f51f97` | P&T7 클린룸 일정 변경. 40조원 후반대는 개별 P&T7 배분액 아님. 투자 ‘규율’ 유지는 금액 유지와 다름 |
| `lives_85f15b91bac9c0e95e69685b` | 용인 ‘1기 팹’의 첫 클린룸 2027년 2월 완공 기대. 원문에 없는 Y1 별칭을 붙이지 않음 |
| `lives_c5b7651f070172d080b11590` | 공장명이 특정되지 않은 청주 생산시설 일정 보도. P&T7/M17으로 자동 귀속하거나 별도 확정 사업으로 중복 집계하지 않음 |

보도자료 `lives_f27f7a184532a4ac52e0625f`는 별도 본문 대조 후 background로 정정했다.

## 6. 브리핑 생성 품질 수정

`briefing-curation.ts`에서 초안·필요 시 병합 후 **원자료 대조 AI 검수 1회**를 수행한다. 정상 초안도 검수한다. 불합격을 숨기며 무한 재생성하지 않으며, 형식·근거·검증 조건 위반은 발행 보류로 남긴다. AI 사용량에는 `draft`, `merge`, `evidence_review` 단계를 기록한다.

현재 유지해야 할 규칙:

- 같은 회사라는 이유만으로 다른 시설을 합치지 않는다. 중복 사실은 충실한 대표 원문으로 통합하고 프로젝트 요약과 원신호의 이중 인용을 줄인다.
- 동향 최대 15, 투자계획 최대 15, 시사점 최대 8. 시사점은 **우선 검토 → 확인 필요 → 참고**, 같은 분류 안에서 중요도 순이다.
- 투자카드 본문에는 해당 시설의 사실과 확인된 개별 금액만 쓴다. 전사액·복수사업 합계·다른 시설의 비교 금액/일정은 카드에서 제외한다. 필요한 합계는 동향에서 정확한 범위로 설명한다.
- 같은 시설의 1·2단계 합계나 그 시설의 총투자액은 허용한다. ‘합계’ 단어 자체를 무조건 차단하지 않는다.
- 전사 투자 규율의 유지를 개별 계획이나 투자액 유지로 바꾸지 않는다. 유지·변경 없음·재확인은 별도의 직접 원문 근거가 필요하다.
- 발표일·수집일·투자 결정일·매출 비교 연도를 구분한다. 상대 날짜는 원문 발표일로 해석한다.
- 제목만 수집한 공시는 ‘세부 미확인’이며 ‘비공개’가 아니다. 공시 기간은 실제 인용한 발표일 범위와 맞춘다.
- 원문에 없는 시설 코드, 확정 상태, 계약, 지리적 귀속을 추가하지 않는다. ‘기대·예정·협의’ 수준을 유지한다.
- 별개 사업이 같은 자동 프로젝트에 연결되면 자동 업무 링크·상태·사실 표시를 보류하고 사업별 검토를 안내한다. 원문 인용은 보존한다.

독립 검토 과정에서 R01~R13(권고 R09 포함)을 기록했고 최종 v5에서 필수 오류 해결을 확인했다. 중간 발행본은 오류 추적을 위해 보존했다.

**남은 비차단 표현 권고 N01:** v5 `report.trends[3]`의 ‘거점별 클린룸 구축 일정이 순차적으로 진행 중’은 원문대로 **‘후속 시설이 순차적으로 구축될 예정’**이라고 쓰면 더 명확하다. 개별 인디애나 공장의 착공·완공·확정일을 단정한 문장은 아니며 투자카드도 기대 수준을 유지하므로 최종 필수 오류로 판정하지 않았다. 이후 생성·검수 지시에서 계획/진행 표현을 더 명료하게 다듬을 수 있다. 이미 발행된 본문을 직접 UPDATE하지 말고 새 발행본에서 확인한다.

## 7. 검증 완료 사항과 정확한 한계

### 최종 품질과 실제 업무 흐름

- 원자료 31건 독립 검토, 핵심 기대판정 14사례 통과. 보류 27건이 v5 스냅샷·인용에 재등장한 수는 0이다.
- 최종 인용 10개 모두 고정 근거 25개에 존재한다. 원문·입력 해시·원장·원본 불변을 검증했다.
- 최신 요약/브리핑 관련 단위 검사 **41개**, 최신 배치 번들 **4종**, 변경 파일 타입 오류 **0건**, 매뉴얼 **9개** 통과.
- 실제 AI 생성·원자료 검수·발행·중복 요청 방지·로컬 수신함·PDF를 확인했다. 라이트/다크 화면과 프로젝트 이동도 통과했다.
- 앞선 실제 보고서로 프로젝트 → `[로컬검증]` 영업건 생성 → 권장 활동 제안·채택 → 예정 활동 저장, 중복 생성 방지를 UI/API로 실증했다.
- 로컬 `u2` 공유 목록·사내 메일·기존 DM 재사용·문서 카드 열기·동일 요청 중복 방지를 실제 저장으로 확인했다. 기존 방이 없는 경우의 생성 경로는 별도 회귀 범위와 실제 운영 시험을 구분해서 확인한다.
- 모바일 타입 검사와 웹 내보내기 50개 경로 생성은 통과했다. 이것은 실제 휴대전화 푸시 수신 검증이 아니다.

### 이전 검증 기록의 해석

- 공식 소스 26, 프로젝트/영업 30, 정기 브리핑 33, 공유 11, 브리핑 권한/메뉴 16, 메일 링크 3, 메신저 답장 경계 4, AI 게이트웨이 6, 기존 영업 보드 5, 전용 작업 정의 1 등의 통과 기록이 있다. 이후 추가 검사와 일부 중복되므로 숫자를 합산하지 않는다. 실행 범위는 `docs/sales-intelligence-phase1-validation-rollout.md`를 따른다.
- 뉴스 품질 오프라인 23, 공개 importer 6, 원문/RAG 계약 15 등의 후속 검증도 수행했다. 어떤 검사는 단위와 DB 통합이 분리되므로 환경변수를 생략한 실행을 전체 통합 통과로 표시하지 않는다.
- Next 전체 빌드(정적 페이지 64개)는 **최종 금액 표시 정책 이전 시점**에 성공했다. 최신 정책의 타입·단위·배치 빌드·로컬 서버 번들은 검증했지만, 최신 전체 Next 재빌드와 동일하다고 쓰지 않는다.
- `next.config.mjs`는 타입·lint 오류를 빌드에서 생략한다. 전체 `tsc`에는 기존 오류 16개가 남아 있다: `app/api/internal/org-snapshot/route.ts`의 `employeeNo/hiredAt` 2개, scraper `facility-enrichment/browser.ts` 10개, `public-api.ts` 3개, `runner.ts` 1개(의존성 `playwright/undici/adm-zip` 및 파생 타입). 최신 환경에서 재확인하되 이번 변경 오류와 구분한다.

### 아직 검증하지 않은 것

- 뉴스 전체 기사 본문·진위, DART 공시 세부, KDI PDF/통계표 및 시장 전체의 사실 정확성. 이번 품질 판정은 뉴스 30건의 저장 공개 발췌·보도자료 1건의 저장 본문·허용 KDI HTML 범위다.
- 운영 로그인·실제 관리자/임원/영업 계정, SES 이메일, 실제 직원 메신저·휴대전화 푸시 도착/딥링크.
- 실제 AWS S3 → ECS 작업 기동, 운영 IAM/네트워크, 반복 실행의 장기 안정성. 예시 모드의 실시간 tick 예약 시험을 운영 예약 검증으로 표현하지 않는다.
- KOSIS 인증 응답, 법령 인증 응답, 기업 공식 발표의 실제 활성화. 일부 기존 소스의 수집 성공 기록도 로컬에서 미확인이라 상태 경고를 유지했다.

## 8. 로컬 환경과 재현

| 대상 | 위치·상태 |
|---|---|
| 화면 | `http://127.0.0.1:4174/sales/rag?tab=scheduled` |
| 실제 자료 DB | localhost PostgreSQL 17, 포트 `55439`, DB `intel_live` |
| 예시 DB | 같은 서버의 `intel_demo`. 실제 자료와 분리 |
| PostgreSQL 데이터 | `%TEMP%/mcm-intel-phase1-pg`. 임시 폴더 정리 전 반드시 보존 여부 확인 |
| 원본 읽기 연결 | 인증된 localhost `15432` SSM 터널. 원본 DB 연결은 READ ONLY |
| 기본 설정 참조 | `C:/CodingProject/MCM/frontend/.env.local`. 키·비밀번호는 이 문서에 포함하지 않음 |
| Playwright 모듈 | `C:/Users/nagas/Documents/MCM/implementation/scraper/node_modules/playwright/index.mjs` |
| 상태 | 마지막 검증 종료 시 실제 모드 서버 가동, 프로필 정기 실행 중지, 공개 AI 응답 진단 저장 OFF |

설정 파일을 통째로 실행하거나 출력하지 않는다. `local-intelligence-environment.mjs`가 필요한 값만 메모리로 읽는다. 다른 환경으로 옮길 때 비밀값을 코드·문서·로그에 복사하지 않는다.

### 보존된 실제 자료로 화면 시작 / 종료

```powershell
Set-Location 'C:/Users/nagas/Documents/MCM/worktrees/sales-intelligence-phase1'
.\scripts\start-local-intelligence-demo.ps1 -Real -UseStoredData
# 종료가 필요할 때만 실행. 화면 서버만 중지하며 DB·보고서·터널은 보존한다.
# .\scripts\stop-local-intelligence-demo.ps1
```

`-Real`만 사용하면 원본 읽기 연결을 준비하고 자료를 다시 가져온다. `-UseStoredData`는 원본 갱신을 생략하지만 AI 생성은 여전히 실제 유료 호출이다. 서버가 이미 켜져 있으면 시작 명령은 기존 주소를 반환하므로 코드 변경 반영에는 종료 후 재시작이 필요하다.

원본 연결이 멈췄을 때는 `source-tunnel-process.json`과 실제 15432 포트 소유자의 부모/자식 프로세스를 확인한다. 이번 작업에서 한 번 멈춘 연결을 복구했지만 PID는 재사용하지 않는다. 다른 AWS 프로세스를 일괄 종료하지 말고 이 작업에서 만든 연결인지 확인한다. `start-intelligence-source-tunnel.ps1`는 포트가 열려 있으면 재사용하므로, 리슨 중인 멈춘 연결을 자동 판별하는 도구는 아니다.

### 추가 AI 호출 없는 최종 보고서 재검증

```powershell
Set-Location 'C:/Users/nagas/Documents/MCM/worktrees/sales-intelligence-phase1/frontend'
$env:MCM_QUALITY_EXISTING_RUN_ID='ibr_3b8e3f259e9e47698ea24646a236ff9f'
node --use-system-ca scripts/test-local-intelligence-live-quality.mjs

$env:MCM_CONTENT_QUALITY_RUN_ID='ibr_3b8e3f259e9e47698ea24646a236ff9f'
node --use-system-ca scripts/test-local-intelligence-content-quality.mjs

$env:MCM_PLAYWRIGHT_PATH='C:/Users/nagas/Documents/MCM/implementation/scraper/node_modules/playwright/index.mjs'
$env:MCM_QUALITY_RUN_ID='ibr_3b8e3f259e9e47698ea24646a236ff9f'
node scripts/test-local-intelligence-live-ui.mjs
```

두 번째 검사는 원본 DB 읽기 터널이 필요하다. 위 스크립트는 검증 결과 파일을 갱신하지만 실제 AI나 외부 메시지를 호출하지 않는다. `test-local-intelligence-live-quality.mjs`는 과거 연결 실패도 시도/비용에 남기고 **마지막 원자료 대조 API 성공**을 확인한다.

### 수정 후 오프라인 검사

```powershell
node scripts/test-news-content-quality.mjs
node scripts/test-local-intelligence-import-payload.mjs
node --test tests/briefing-original-text.test.mjs tests/rag-curation.test.mjs
node scripts/test-briefing.mjs
npm run test:manual
```

실제 영업/공유 흐름 재시험은 `test-local-intelligence-live-workflow.mjs`, `test-local-intelligence-live-share.mjs`다. 이 둘은 로컬 시험 업무·공유 데이터를 저장하며 자동 삭제하지 않는다. 업무흐름 검사는 다른 AI 생성과 동시에 실행하지 않는다.

DB 통합 검사는 `OFFICIAL_SOURCES_TEST_DATABASE_URL`, `INTEL_TEST_DATABASE_URL`, `INTEL_BRIEFING_TEST_DATABASE_URL`, `INTEL_BRIEFING_SHARE_TEST_DATABASE_URL`, `INTEL_BRIEFING_ACCESS_TEST_DATABASE_URL`, `INTEL_CHAT_BOUNDARY_TEST_DATABASE_URL` 등의 **전용 시험 DB**를 사용한다. 일부 시험은 스키마를 초기화하므로 운영 DB나 보존 중인 `intel_live`를 연결하지 않는다.

| 실행기 | 전용 DB 이름 |
|---|---|
| `test-official-sources.mjs` | `intel_sources_test` |
| `test-project-intelligence.mjs` | `intel_projects_test` |
| `test-briefing.mjs` | `intel_briefing_test` |
| `test-briefing-share.mjs` | `intel_briefing_share_test` |
| `test-briefing-access.mjs` | `intel_briefing_access_test` |
| `test-chat-reply-boundary.mjs` | `intel_chat_boundary_test` |

**project/briefing/share/access/chat 통합 fixture는 public 스키마를 삭제하고 다시 만든다. `intel_live`/운영 DB를 지정하지 않으며 같은 시험 DB를 병렬 실행하지 않는다.** 공식 소스 시험은 전용 DB 안의 임시 스키마를 사용한다. `test-local-intelligence-live-schedule.mjs`는 별도 opt-in 후 실제 자료를 timestamp가 붙은 시험 DB로 복사하고 외부 네트워크·AI를 막는 방식이므로 실제 유료 예약 실행과 구분한다.

### 새 실제 브리핑 생성이 필요한 경우

현재 사용자 요청에는 실제 API 실증이 포함되어 있지만 이 인계서 작성 자체에서는 추가 호출하지 않았다. 이후 수정 검증에 필요한 호출만 실행하고 비용·실패 이력을 남긴다.

```powershell
Remove-Item Env:MCM_QUALITY_EXISTING_RUN_ID -ErrorAction SilentlyContinue
$env:MCM_RUN_PAID_AI_TEST='1'
$env:MCM_QUALITY_REQUEST_KEY='claude-source-quality-20261031-01' # 새 검증에는 새 키
node --use-system-ca scripts/test-local-intelligence-live-quality.mjs
```

같은 키는 같은 회차를 재사용한다. 실패한 미발행 회차의 재시도는 `/api/sales/rag/runs/{runId}/retry`를 사용하고, 발행본 수정은 새 회차로 검증한다. 생성·검수에 실패해도 성공한 초안 비용은 이미 발생할 수 있다. 로컬 초기 월간 예산 $5는 계정 전체 청구 한도가 아니다.

## 9. 증거·파일 보존

실증 증거는 대부분 Git에서 무시되는 `.next` 아래에 있다. **마크다운만 다른 Claude 환경에 전달하면 코드·DB·증거가 함께 전달되는 것이 아니다.** 다른 환경으로 이동하기 전 작업트리와 필요한 증거/로컬 DB를 별도로 보존한다. 비밀 설정 파일은 전달 자료에 무작정 포함하지 않는다.

주요 경로(작업본 기준):

- `frontend/.next/local-intelligence-demo/quality/result.json`, `report.json`, `report.pdf`: 최신 v5. 재실행 시 덮어써질 수 있음.
- `frontend/.next/local-intelligence-demo/screenshots/live-report-light.png`, `live-report-dark.png`, `live-preview-light.png`.
- `frontend/.next/local-intelligence-demo/source-quality/`:
  - `audit-before.json`: 최초 뉴스 30건 감사. **현재 정정 상태로 다시 생성해 덮어쓰지 않는다.**
  - `press-audit.json`: 보도자료 1건의 별도 원본 감사.
  - `review-expectations.json`: 독립 14사례 기대판정. 구현 통과를 위해 기대값을 바꾸지 않는다.
  - `repair-result.json`, `press-repair-result.json`: 실제 정정 결과.
  - `validation-result.json`: v5 원본 불변·로컬 정정·근거 검증 PASS.
  - `review-final.json`: 전체 원자료 및 최종 보고서 검토 연결.
  - `report-review-final.json`, `report-fifth-corrected-source-snapshot.json`, `v5-snapshot.json`: 최종 내용 판정과 고정 사본.
  - `report-review-first/second/third/fourth.json`: 중간 문제 발견 기록. `report-review-checklist.json`도 보존.
  - `ai-responses/`: 당시 진단을 위해 켠 공개 AI 응답 기록. 현재 `MCM_INTEL_CAPTURE_PUBLIC_AI`는 껐다. 요청·인증 헤더는 저장하지 않는다.
- `frontend/.next/local-intelligence-demo/workflows/20261031020915/`, `shares/20261031022821540/`, `shares/20261031024940582/`: 실제 자료를 이용한 로컬 업무/공유 증거.
- 최신 코드 빌드·타입 로그: `frontend/.next/news-quality-next-build.log`, `news-quality-batch-build.log`, `news-quality-final-types.log`. 이전 품질 실증 로그 이름과 구분한다.

보존 확인용 값:

| 대상 | SHA-256 / 지문 |
|---|---|
| 최초 뉴스 감사 | `7CB8992C692D047E5D89EFD70C630B36A1BD30007F3C2B67B9307B1C29F73FF6` |
| 독립 14사례 | `7DB560CDBF8B45DCE7B6B0D40C237942B8DB5BBF758BFBCEC698F63907AFAFA5` |
| 최종 보고서 보존 사본 | `CC5F12EBF02CB3C324B777D2EAC160276B56BB0F4976A95B1777216F09A9E508` |
| v5 고정 입력 | `BADB078EF3448CC0EE86D5C42F14CB3645211C51BCBC1DDC1C981005DDB92BB6` |
| 정정 자료 지문 | `47f2e68c6547d7e4a9bf6cb5b311b180dc6ede1b71c286ec669481369a29d1c7` |

정정 도구 `repair-local-intelligence-content.mjs`는 기본 미리보기, `--apply`는 실제 AI/로컬 쓰기이며 `MCM_RUN_PAID_AI_TEST=1`이 필요하다. `--press`, `--sync-inputs`, `--retry-failed`, `--only=...`, `--recheck=...`를 지원한다. 현재 도구는 감사한 소규모 로컬 자료용이다. **운영 전체 DB 정정 도구로 연결 주소만 바꿔 재사용하면 안 된다.** 별도 대상 선정·원장·복구·동시성·알림 억제 계획이 필요하다.

## 10. Claude가 이어서 할 작업 — 우선순위

### A. 작업 인수와 작은 품질 보완

1. 올바른 worktree와 미커밋 파일을 확인하고 코드·증거·DB 보존 범위를 정한다. 문서의 실행 결과와 현재 환경을 구분한다.
2. v5를 추가 AI 없이 열고 위 읽기 검증을 실행한다. 기존 보고서와 감사 기대값을 덮어쓰지 않는다.
3. N01의 ‘진행 중/구축 예정’ 표현을 필요 시 생성·검수 지시에서 더 명료하게 한다. 고정 금액·기사 내용을 프롬프트에 하드코딩하지 말고 근거의 확신 수준 보존으로 해결한다.
4. 다른 회사·업종·날짜 경계·복수 시설 기사에서도 대표 선별과 사실 보존이 유지되는지 표본을 넓힌다. 이번 SK하이닉스 31건 통과를 전체 자료 정확도로 일반화하지 않는다.
5. 최신 전체 Next 빌드와 변경 경로 타입을 확인한다. 빌드는 `NEXT_DIST_DIR=.next-quality-build`로 격리해 `.next/local-intelligence-demo`를 지우지 않는다. Next가 `tsconfig.json`에 추가한 임시 include만 원복하고 기존 사용자 변경은 유지한다.

### B. 원자료·프로젝트의 남은 실질 작업

1. 제목만 확보된 DART 공시의 원문 세부를 적법한 경로로 확보하고 사업·금액·일정을 검증한다. 제목으로 내용을 보완하지 않는다.
2. Y2/M17처럼 한 기사에 여러 사업이 연결된 자동 프로젝트를 사업별로 확인·분리한다. 원문·기존 영업 연결·활동을 보존하고 무조건 병합하지 않는다.
3. 공장명 미상의 청주 자료, 미완 문장·주체 불명 자료의 추가 원문을 확보할지 결정한다. 확인 전 자동 투자 근거로 복귀시키지 않는다.
4. 운영 과거 자료의 소급 정정 범위·미리보기·백업·원장·복구 방법을 준비한다. 이번 31건은 운영 원본에서 아직 고쳐지지 않았다. 전체 원자료 정리와 일반화된 정정 기능은 별도 작업이다.
5. 수집 보류·프로젝트 연결·본문 부족 표시가 실제 사용자에게 명료한지 확인한다. 이전 발행본의 잘못된 내용을 정정할 필요가 있으면 새 발행/정정 이력으로 처리한다.

### C. 공개 공식 정보원 활성화

| 정보원 | 현재 | 남은 일 |
|---|---|---|
| KDI | 허용 공식 HTML 3건 실제 수집·AI 반영·원문 대조 완료 | 대상 확대 시 각 문서 이용 범위와 실제 본문·발표일 재확인 |
| KOSIS | 제한된 통계표/시계열 JSON 수집 어댑터 구현 | 인증키·기관/표/항목/분류 코드·이용 권리·실제 인증 응답 확인 |
| 국가법령정보 | 법령 ID/행정규칙 LID 기반 공식 API 구현 | OC 값·대상 목록·권리·실응답 확인 |
| 기업 공식 발표 | 허용 도메인 HTML 수집 구현 | 도메인/URL·수집/보관/AI/사내보고 권리, 실제 응답 검증 |
| KIET·KEA | 참고 링크 | 자동 수집 완료로 표시하지 않음 |

기존 공식 소스의 `scraper_sources.enabled=0`은 호환상 의도다. 새 공식 설정의 활성값을 사용한다. 공식 기업 발표를 켜기 전에 **고정된 기존 intel 배치에도 legacy 임베딩 제외 변경을 반영**해야 한다. 앱만 먼저 갱신하고 공식 수집을 켜면 오래된 배치가 제목 메타데이터를 기존 경로로 임베딩할 수 있다.

### D. 실제 계정·채널·예약 검증과 운영 적용

1. 실제 관리자·임원·영업 계정에서 생성·열람·공유, 비공개 보고서, 명시적 거부, 수신자 해제·퇴사·권리 회수를 검증한다.
2. 승인된 시험 수신자/기기로 사내 메일·SES 이메일·모바일 푸시·기존/신규 DM·문서 링크·딥링크와 재시도 중복 방지를 확인한다. 로컬 u1/u2 성공을 실제 직원 수신 성공으로 표시하지 않는다.
3. 운영 DB 백업과 319→323 스키마 적용, 앱과 고정 수집 배치의 호환성을 검토한다. 변경을 리뷰·통합한 뒤 승인된 배포 절차로 진행한다. 이 문서는 운영 쓰기·배포·실제 발송을 이미 승인받았다는 뜻이 아니다.
4. `INTEL_BRIEFING_ENABLED=false`로 시작하여 기존 수동 브리핑·수집·영업/계약 경로를 먼저 확인한다.
5. 전용 ECS 작업 정의·최소 RunTask/PassRole 권한·S3 캐시·네트워크·예산·알림 설정을 적용하고 실제 예약 실행을 확인한다. 숫자 revision ARN과 고정 이미지 태그/digest를 사용한다.
6. 소수 프로필을 켜고 최소 7일간 누락·중복·배달 불명·비용·근거 오류·영업 전환을 관찰한다. 월간 프로필은 예약 계산 검사 외 실제 첫 월간 실행도 확인한다.

운영 주의사항은 작업본 `CLAUDE.md`와 `docs/sales-intelligence-phase1-validation-rollout.md`가 상세 기준이다. 작업 당시 ADT/intel은 revision 748에 고정되어 있었으나 배포 전 현재 상태를 다시 확인한다. 이번 스키마는 기존 수집 경로와 연결되므로 단순 Next 단독 배포로 처리하지 않는다. `schedule-pin-*` 이미지 보호도 검토한다. 전체 Terraform apply는 금지되어 있으며 MX·SES·Route53·bastion 등 무관 변경이 섞이지 않은 승인 범위만 다룬다.

실제 기동 구조는 `instrumentation.ts` → `/api/internal/intel-briefing-tick` → S3 다음 실행 힌트 → 전용 ECS 작업이다. 활성화 시 시작 90초 후, 이후 5분마다 확인하며 내부 API는 `AUTH_SECRET` 기반 `x-cron-key`를 검증한다. **새 EventBridge 스케줄을 추가한 구현으로 오해하지 않는다.** 중요 알림의 주간 변화 확인은 15분 기준이고, 실제 시작에는 tick/ECS 준비 지연이 있을 수 있다.

| 주요 실행 설정 | 용도 |
|---|---|
| `INTEL_BRIEFING_ENABLED` | 기본 false, 검증 후 시범 활성화 |
| `INTEL_BRIEFING_ECS_CLUSTER`, `INTEL_BRIEFING_TASK_DEFINITION` | 전용 클러스터와 숫자 revision ARN |
| `INTEL_BRIEFING_SUBNETS`, `INTEL_BRIEFING_SECURITY_GROUPS` | 쉼표 구분 네트워크 설정 |
| `INTEL_BRIEFING_ASSIGN_PUBLIC_IP` | ENABLED/DISABLED 명시. 작업 당시 staging 공개 subnet/IGW 구조는 ENABLED가 필요했으며 실제 배포망을 재확인 |
| `INTEL_BRIEFING_CONTAINER_NAME` | 기본 next |
| `INTEL_IMPORTANT_DAILY_LIMIT` | 수신자·채널·KST 날짜별 개별 중요 알림 상한, 기본 20 |
| 기존 서버 설정 | DB·AWS_REGION·MCM_STORAGE_BUCKET·AUTH_SECRET·ANTHROPIC_API_KEY·AI 예산·SES/Expo·AUTH_URL/NEXTAUTH_URL을 작업자에도 제공. 값 자체는 문서에 기록하지 않음 |

작업자는 공식 소스 수집·프로젝트 동기화·중요 사건 확인·브리핑(작업당 최대 2건)·전달·다음 실행 힌트 갱신을 수행한다. 4개 배치 번들 생성 성공은 이 실제 기동 경로의 운영 성공을 의미하지 않는다.

기존 참조 보호를 `RESTRICT`에서 `CASCADE`로 바꾸는 제안은 데이터 손실 위험으로 자동 승인 검토에서 거절되어 **적용하지 않았다**. 명시적 연결 해제·제외·취소 경로를 유지한다. 중단 시 기능 플래그와 프로필을 끄고 실행 작업을 확인하며, 이력 삭제나 스키마 역삭제로 복구하지 않는다.

## 11. 상세 문서와 인수 완료 기준

- 승인된 원본 계획: `docs/sales-intelligence-phase1-implementation-plan.md` — 일부 기준 커밋·운영 설명은 계획 당시 값이다.
- 구현·검증·운영 순서: `docs/sales-intelligence-phase1-validation-rollout.md` — 현재 구현과 미실증 범위 기준.
- 로컬 사용법·최신 보고서: `docs/local-intelligence-demo.md`.
- 사용자 디자인 원문 사본: `docs/kesi-frosted-design-system-reference.md`.
- 최종 독립 판정: `frontend/.next/local-intelligence-demo/source-quality/report-review-final.json`.

Claude가 작업을 인수한 뒤에는 **현재 실제 작업본·v5 보고서·보존 자료를 확인했다는 사실**, **어떤 남은 작업부터 진행하는지**, **운영 반영 여부를 별도로 구분**해 사용자에게 알려주면 된다. 이미 해결한 R01~R13을 처음부터 다시 수정하거나, 검증 편의를 위해 원자료·기대판정·발행본을 바꾸지 않는다.
