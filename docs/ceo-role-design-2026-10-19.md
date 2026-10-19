# 임원(tpl-exec) 권한 목록표와 대표이사(tpl-ceo) 권한 신설 설계

작성 2026-10-19. 기준 = 스테이징 next 688(main 3f4f6e6, 일원화 PR #11 + 부서 분리 PR #12 배포 후). 권한의 근거는 템플릿 grant뿐이며 `users.role`은 admin|member 부트스트랩 플래그다.

배경: 오너인 대표이사와 피고용 임원에게 같은 템플릿(tpl-exec)이 붙어 있다(직급 `ceo` → tpl-exec, 026 시드). 대표이사에게는 **관리자 설정 메뉴는 막되 대부분의 업무 메뉴를 열람·조작**할 수 있는 별도 템플릿이 필요하다. 아래 §1·§2가 현재 임원의 전수 목록, §3이 설계안이다.

---

## 1. 임원(tpl-exec)이 가진 권한키 — 20개, 전부 전사(all) 범위

| 영역 | 키 | 성격 |
|---|---|---|
| 전자결재 | approval.view · approval.act | 기안·열람 / 결재 승인·반려 |
| 게시판 | board.view · board.write | 조회 / 부서 게시글 작성·수정 |
| 계약·수금 | contract.view · billing.view | 조회 |
| 영업 | sales.view · contact.view | 조회 |
| 사업장 | facility.view | 조회 |
| 업무추진계획 | work_plan.view · work_plan.directive · work_plan.lock_release | 조회 / 임원 검토·지시 작성 / 잠금 해제 |
| 성과급·인사 | bonus.view · staffing.view · staffing.evaluation.read · staffing.record.view | 조회(평점 저장 불가) |
| 급여·재무 | payroll.view · finance.view | 조회(10-19 §6-1 결정으로 추가) |
| 일정·할 일 | calendar.meeting.manage · todo.admin | 회의 일정 등록·편집 / 공유·부서·프로젝트 보드 목록·멤버 관리 |

보유하지 않은 키 중 눈에 띄는 것: 모든 `*.edit`(계약·수주·영업·사업장·인사·급여·업무계획 작성), 모든 `*.delete`·`trash.*`·`facility.merge`, `certificate.issue`, `approval.manage`, `board.manage`, `bonus.calculate/confirm/send`, `payroll.edit/close/export`, `finance.manage`, `filing.*`, `survey.*`, `rules.manage`, `files.manage`, `data.*`, 관리 영역 키 전부.

## 2. 메뉴별 열람 범위와 조작 가능 기능 (임원 기준, 실측 + 코드)

범례: **열람** = 메뉴 노출·화면 조회 / **조작** = 그 화면에서 실제로 저장·실행되는 기능 / ✕ = 메뉴 숨김 또는 403.

| 메뉴 | 열람 | 조작 가능 | 조작 불가(키 없음) |
|---|---|---|---|
| 홈 | 전 위젯(참여 용역·수금·결재 대기·내 급여 등) | 위젯 배치 편집, 할 일 빠른 추가 | – |
| 메일 | 본인 메일함 | 작성·발송·첨부 | 메일 관리(mail.manage) |
| 전자결재 > 홈·공문 작성·내부고시·양식별 조회·데이터 분석·결재 인사이트 | 본인 기안·결재선·참조 문서 + 승인된 전사 문서, 양식별 조회·분석은 본인 관련 범위 | **기안(공문·내부고시·휴가·출장 등 전 양식), 결재 승인·반려**, 공문 발송 | 타인 문서 임의 열람, 관리자 문서 삭제(approval.manage) |
| 파일·문서함 > 파일함·문서함·개인문서함 | 본인 관련 문서 | 개인문서함 업로드·삭제 | 전사 파일 통합 조회·삭제(files.manage) |
| 주소록·조직도 | 전 직원 연락처·사진 | – | 조직·직급 편집(org.edit) |
| 공지·게시판 | 전사·부서 게시글 | 부서 게시글 작성·본인 글 수정 | 전사 공지 작성·타인 글 관리(board.manage) |
| 사규·내규 > 사규 열람·내부 규정 일람 | 전 규정 | – | 원문 임포트·개정·내부 규정 작성(rules.manage — 메뉴 숨김) |
| 일정 | 전사 일정(본인·영업·부서·차량·회의·면접) | 개인 일정, **회의 일정 등록·편집·정기 회의 규칙** | 면접 일정(calendar.interview.manage) |
| 할 일 | 개인 보드 + 공유·부서·프로젝트 보드 목록 | 개인 할 일, **공유·부서·프로젝트 보드 생성·멤버 관리**(todo.admin, 타인 개인 작업 본문은 불가) | – |
| 자산 예약 > 이용 현황·자산 관리 | 전 자산·예약 | 본인 예약 | 자산 등록·변경·삭제(asset.manage) |
| 설문 > 사내 설문 | 배포된 설문 | 응답 | 설문 작성·집계(survey.manage, 외부 설문 메뉴 숨김) |
| 업무추진계획 > 보고 작성/목록 | 전사 보고서 | – | **보고서 작성·수정(work_plan.edit 없음 → 작성 버튼 403)** |
| 업무추진계획 > 부서장 감독 | 전 부서 감독 화면(lock_release로 메뉴 노출) | **잠금 해제** | 1차보고 병합(work_plan.merge) |
| 업무추진계획 > 임원 검토·지시·발표 모드 | 전 부서 통합 보고 | **검토 의견·지시 작성**, 발표 모드 | – |
| 성과급 산정 > 지급 대상 LIST·참여도·평점·지급 명세서 생성 | 전사 용역·평점·명세·배분 보드 | – | 평점 저장(staffing.evaluation.write), 산정·배분·비용 입력(bonus.calculate), 요율·절대평가 설정(bonus.confirm), 명세서 PDF·발송(bonus.send) |
| 수행인력 실적 | 전 직원 | 증빙 다운로드 | – |
| 급여·근로계약 > 내 급여명세서·내 연말정산 | 본인 | 명세서 수신 확인 | – |
| 급여·근로계약 > 급여대장·직원별 연봉·연말정산·급여 설정 | **전사 급여 금액 조회** | – | 대장 생성·항목·규칙 수정(payroll.edit), 확정·EDI·연말정산 확정(payroll.close), 명세서·근로계약서 파일 다운로드(payroll.export) |
| 근태·휴가 > 내 휴가·근태 | 본인 | 휴가·초과근무 신청(결재 기안) | 직원별 휴가·근태·증명서·연차촉진·휴무일·휴가 종류 관리(staffing.edit — 메뉴 숨김) |
| 사업장 | 전 사업장 2,036건 | – | 등록·수정(facility.edit), 병합·삭제 |
| 계약 > 계약 관리·Dashboard·수주/수금/발행 현황 | 전 계약 1,252건·금액·수금 | 발행 요청 자격은 billing.edit 필요 → 불가 | 계약 등록·수정·삭제, 수주·수금 입력(billing.edit), 내보내기(billing.export) |
| 계약 > 계약서 작성·착수계·준공계 작성 | 전 문서 열람·PDF/HWPX 다운로드 | – | 문서 작성·수정·발송(contract.edit) |
| 계약 > 다운로드/증명서 생성 | 증빙 묶음 다운로드 | 묶음 다운로드 | 실적·거래 증명서 발급(certificate.issue) |
| 계약 > 대외 신고 대기열 | ✕(filing.view 없음, 메뉴 숨김) | – | – |
| 재무(8탭) | 연결 현황·계좌·카드 원장·계산서·수금·부가세·전표·손익·자산·경비 정산 **전부 조회** | – | 연결 등록/해지·수집 실행·분류 확정(finance.manage), 수금 대조 확정(recon.confirm), 세금계산서 발행(taxinvoice.issue) |
| 영업/마케팅 > Salesboard·담당자 정보·API & 스크래핑·RAG·공공입찰 | 전 영업건·활동·담당자·입찰·시그널·브리핑 | RAG 질의·브리핑 생성(세션+sales.view), 입찰 패키지 조회 | 영업건·활동 등록·수정(sales.edit), 담당자 등록·출력(contact.edit/export) |
| 영업/마케팅 > 견적서 작성 | 견적 목록 | **견적서 작성·발송** — `lib/quote/perm.ts`가 직책명(대표이사·총괄·본부장 등) 문자열로 허용 | – |
| 데이터 | ✕(data.view 없음) | – | – |
| 관리 메뉴(사용자 관리·회사 프로필·홍보·채용공고·결재 운영 설정) | ✕ | – | – |
| 휴지통 | ✕(trash.view 없음) | – | – |

**삭제 권한**: 임원은 어떤 삭제·병합·영구삭제 키도 없다(본인 기안 문서 회수·개인 할 일 삭제 같은 본인 데이터 제외).

### 2.1 설계와 어긋나 보이는 점(대표이사 템플릿 설계 전에 정리 권장)

| # | 내용 | 영향 |
|---|---|---|
| E-1 | **임원의 `staffing.view`가 전사(all)라 계좌·인사 서류·인사이력에도 닿는다** — 10-19에 "계좌·인사 서류는 관리자·인사담당만"으로 좁혔지만 판정 기준이 `staffing.view` scope=all 보유 여부라 임원도 통과한다(조직도 상세 → 계좌 탭, 인사 서류 다운로드). | 피고용 임원이 전 직원 계좌를 볼 수 있음. 계좌·서류·이력 쓰기는 `staffing.edit`/`staffing.changes.record`가 없어 불가 |
| E-2 | 견적서 작성 허용이 직책 **문자열 매칭**이라 권한 템플릿과 무관하게 열린다(대표이사·총괄·본부장·부서장·실장·소장, 영업관리본부). | tpl-ceo 설계 시 `sales.edit`로 옮기고 문자열 분기는 제거 후보 |
| E-3 | 업무추진계획 "보고 작성/목록" 메뉴는 보이지만 작성은 403(work_plan.edit 없음). | 임원이 직접 보고를 쓰지 않는 설계면 정상. 대표이사는 작성 가능하게 할지 결정 |

---

## 3. 대표이사 템플릿(tpl-ceo) 설계안

원칙(사용자 지시 2026-10-19): **관리자 설정 메뉴는 제한, 대부분의 업무 메뉴는 접근·조작 허용, 서툰 조작으로 인한 오작동·DB 삭제 방지.**

세 묶음으로 나눈다. ① 임원 20키 그대로 + ② 업무 조작 키 추가 + ③ 제외(관리 설정·삭제·되돌리기 어려운 실행). 위험 플래그(`is_dangerous=1`) 키 중 되돌릴 수 있는 것은 부여, 외부 전송·과금·영구 삭제는 제외했다.

### 3.1 부여 — 임원 20키 + 아래 추가(전부 scope=all)

| 영역 | 추가 키 | 열리는 조작 |
|---|---|---|
| 계약·수금 | contract.edit · billing.edit · billing.export · certificate.issue | 계약 등록·수정, 수주·수금 입력, 청구/수금 내보내기, 실적·거래 증명서 발급, 계약서·착수계 작성·발송 |
| 영업 | sales.edit · contact.edit · contact.export | 영업건·활동 등록·수정, 담당자 등록·출력, 견적서(문자열 분기 대신 키로) |
| 사업장 | facility.edit | 사업장 등록·수정 |
| 업무추진계획 | work_plan.edit · work_plan.merge · work_plan.edit.locked | 보고서 작성·수정, 1차보고 병합, 잠금된 보고 수정 |
| 성과급·인사 | staffing.evaluation.write · bonus.calculate · staffing.changes.record | 참여도·평점 저장, 성과급 산정·배분·비용 입력·초안, 인력 변동 기록 |
| 급여 | payroll.edit · payroll.export | 대장 생성·항목·규칙·근로계약·상여 계획 수정, 명세서·근로계약서 파일 다운로드 |
| 전자결재·게시판 | approval.manage(※) · board.manage | 전 결재 문서 열람·관리자 삭제, 전사 공지 작성·타인 글 관리 |
| 일정·설문·사규·자산 | calendar.interview.manage · survey.view · survey.manage · rules.manage · asset.manage | 면접 일정, 설문 작성·집계, 사규 개정·판 발행, 자산 등록·변경 |
| 대외 신고 | filing.view · filing.manage | 대외 신고 대기열 열람·제출·제외 처리 |
| 데이터·휴지통 | data.view · data.review · trash.view · trash.restore | 수집 현황·검수 대기열 조회·검수, 휴지통 조회·**복원** |
| 조회·분석 | org.view · reports.nlq · audit.read · ai.usage.view | 조직도·직급 조회, 자연어 데이터 질의(LLM 비용), 감사 로그 조회, AI 사용량 조회 |

※ `approval.manage` 한 키가 "전 결재 문서 열람"과 "결재 운영 설정(양식·정책·알림) 메뉴"를 함께 연다. 대표이사에게 전 문서 열람만 주려면 키를 둘로 나눠야 한다(`approval.read_all` 신설, 아래 §3.4).

### 3.2 제외 — 관리자 설정·삭제·되돌리기 어려운 실행

| 묶음 | 키 | 이유 |
|---|---|---|
| 계정·권한·조직 | account.manage · rbac.template.manage · rbac.assignment.manage · org.edit | 관리자 설정. 계정 발급·권한 부여·조직 편집은 관리자·인사담당만 |
| 보안·시스템 설정 | security.access_log · security.attachment_policy · ai.usage.manage · mail.manage · files.manage · data.collect · recruit.manage | 관리 메뉴·전사 정책·수집 실행·전사 파일 삭제 |
| 삭제·병합·영구삭제 | contract.delete · sales.delete · facility.delete · facility.merge · trash.purge · staffing.edit(※) · staffing.documents.manage | DB 삭제·되돌리기 어려운 변경 방지. 인사 정보 등록·수정(`staffing.edit`)은 근태·휴가 관리 6화면까지 열기 때문에 제외(필요 시 별도 결정) |
| 외부 전송·과금·확정 | payroll.close · bonus.confirm · bonus.send · finance.manage · recon.confirm · taxinvoice.issue | 급여 확정·EDI 등록·연말정산 확정, 성과급 요율 확정·명세서 발송, 계좌 연결/해지·수집, 수금 대조 확정, 세금계산서 국세청 전송 — 실무자가 실행하고 대표는 결재로 승인 |
| 관리 메뉴 노출 키 | recruit.view(채용공고 열람) | `/admin/recruit` 메뉴가 열림. 공고 열람이 필요하면 부여해도 무방(결정) |

결과: 대표이사는 관리 메뉴(사용자 관리·회사 프로필·홍보·채용공고·결재 운영 설정)가 숨겨지고 `/admin/*`은 "권한 없음" 안내. 나머지 메뉴는 전부 보이며 조회·작성·수정이 되고, 삭제·확정·발송·외부 전송만 막힌다.

### 3.3 결정이 필요한 항목

| # | 사안 | 제안 |
|---|---|---|
| C-1 | 전 결재 문서 열람(approval.manage) — 결재 운영 설정 메뉴까지 열림 | `approval.read_all` 키 신설(전 문서 열람만) 후 tpl-ceo·tpl-system-admin에 부여. 신설 전엔 approval.manage 미부여 |
| C-2 | 급여 확정(payroll.close)·성과급 확정/발송(bonus.confirm/send) | 제외 유지(실무자 실행, 대표는 결재 승인). 대표가 직접 확정해야 하는 운영이면 부여 |
| C-3 | 인사 정보 수정(staffing.edit)·근태 관리 6화면 | 제외 유지. 필요하면 근태 관리 전용 키 신설 |
| C-4 | 계좌·인사 서류 열람 — 현재 `staffing.view` all 보유자(임원 포함) 전원 가능(E-1) | 전용 키 `staffing.sensitive.view`(계좌·서류·이력) 신설해 관리자·인사담당만. 대표이사는 부여 여부 결정 |
| C-5 | 접속기록·AI 사용량 조회(security.access_log·ai.usage.view) | 관리 메뉴에 노출되므로 미부여 제안. 감사 로그(audit.read)는 메뉴 없이 API만이라 부여 |
| C-6 | 견적서 작성 직책 문자열 분기(E-2) | `sales.edit` 판정으로 교체, 문자열 분기 제거 |
| C-7 | 대표이사 외 임원(부사장·전무·상무·총괄본부장·경영이사) 범위 | 그대로 tpl-exec(조회 + 검토·지시). 총괄본부장에게 실무 조작이 필요하면 별도 템플릿 |

### 3.4 구현 계획(마이그 1개 + 코드 소폭)

1. **마이그 `29x_ceo_template.sql`** — `permission_templates`에 `tpl-ceo`(대표이사) 신설, §3.1 키 grant(결정적 grant_id), `position_default_templates`의 `ceo` → `tpl-ceo`, 현재 대표이사(이유억) assignment를 tpl-exec 회수 + tpl-ceo 부여(멱등). C-1·C-4 신설 키가 있으면 카탈로그 시드 + tpl-system-admin 보충 + 배분을 같은 파일에.
2. **코드** — C-1: 결재 문서 열람 판정(`lib/approval/access.ts`)에 `approval.read_all` 추가. C-4: 계좌·서류·이력 라우트의 `requireGlobalScope("staffing.view")`를 `staffing.sensitive.view`로. C-6: `lib/quote/perm.ts` 문자열 분기 제거. 메뉴·미들웨어는 키 기반이라 변경 없음(`AccessDenied` 라벨 표에 새 키 이름만 추가).
3. **검증** — 대표이사 계정으로 §2 표를 다시 측정(관리 메뉴 숨김, 삭제·확정·발송 403, 작성·수정 200). 테스트 계정으로는 `ceo` 직급 신규 발급으로 재현 가능.
4. 번호는 원격 전 브랜치 확인 후(현재 main 최대 297), 배포는 마이그 적용 → next 배포 순.

---

## 4. 확정·구현 기록 (2026-10-19)

- §3.3 C-1~C-7 **제안값 확정**(사용자). 구현 = 브랜치 `claude/ceo-role`, 마이그 `298_ceo_template.sql`.
  - 새 키 `approval.read_all`(전 결재 문서 열람, tpl-system-admin·tpl-ceo), `staffing.sensitive.view`(계좌·인사 서류·승진/전보/퇴사 이력, tpl-system-admin·tpl-hr).
  - `tpl-ceo` 53키, 직급 `ceo` 기본 템플릿 → tpl-ceo, 현 대표이사 tpl-exec 회수·tpl-ceo 부여.
  - 코드: 결재 열람 판정에 read_all, 계좌·서류·이력 라우트를 sensitive.view 전용으로, 견적 작성은 `sales.edit` 보유로(직책 문자열 분기 삭제), 권한 없음 라벨 추가.
- **추가 지시(같은 날): 계약 Dashboard·수주/수금/발행 현황·재무·급여대장 열람 = 관리자·인사/회계·대표이사만.**
  - `billing.view`·`billing.export`를 사원·부서장·임원·영업관리·검수용 템플릿에서 회수, `payroll.view`·`finance.view`를 임원·검수용에서 회수, 인사/회계(tpl-hr)에 `billing.view`·`finance.view` 추가.
  - 메뉴·URL: `/contracts/dashboard`·`/contracts/billing`을 `billing.view`로 가드(그 외 계약 화면은 `contract.view` 유지). 홈 "수금/발행 요약"·"재무 알림" 위젯도 같은 키라 함께 숨겨짐.
  - 영향: 임원(부사장·총괄본부장·경영이사)은 급여대장·재무·현황 화면을 더 이상 보지 않는다(10-19 §6-1 결정을 이 지시로 대체). 영업관리 템플릿 보유자 3명은 모두 시스템 관리자라 실제 변화 없음.

### 4.1 영업/마케팅 메뉴 — 현재 상태(사용자 질문 2026-10-19)

"영업 담당자만 진입"이 **아니다.** 메뉴 키 `sales.view`를 아래 템플릿이 모두 보유해 활성 직원 전원(약 37명)에게 메뉴가 보인다.

| 템플릿 | 범위 | 활성 보유자 |
|---|---|---|
| 일반 직원 | participant(본인이 관계자인 영업건) | 25 |
| 부서장 | self_dept | 7 |
| 임원 | all | 7 |
| 시스템 관리자 | all | 4 |
| 영업관리 | all | 3(이도희·이재영·관리자) |

영업건 목록·단건은 범위로 걸러지지만(현재 영업건 1건, 관계자 3명: 영업관리본부 2·울산지사 1), **공공입찰·API&스크래핑·RAG·인텔 시그널은 전사 공용 데이터라 메뉴가 보이는 사람은 전부 본다.** 담당자 정보(`contact.view`)는 주소록·모바일 담당자 화면도 같은 API를 써서 전 직원 유지가 필요하다.

### 4.2 결정·구현: 영업/마케팅 메뉴 = 지정된 영업 담당자 + 대표이사 + 관리자 (2026-10-19)

사용자 정의: "영업 담당자"는 템플릿이 아니라 **영업/마케팅 메인 화면에서 조직도로 지정한 인원**이다. 지정된 사람에게만 메뉴를 연다.

| 구분 | 내용 |
|---|---|
| 지정 UI | Salesboard 하단 **"영업 제설정" 카드** → **"영업 담당자 설정"** 버튼 → 조직도 체크 모달(추가·해제, 변경 인원 수 표시). 카드에 공공입찰 수집 소스·API & 스크래핑 소스 이동 버튼도 함께 둔다. |
| 지정 권한 | 새 키 `sales.staff.manage` — 대표이사·관리자만. 프로젝트 상세의 "영업 담당 추가" 버튼도 같은 키로만 보인다. |
| 저장 | `sales_assignees`(150)가 지정 목록. `PUT /api/sales/assignees`가 목록 전체를 저장하고 감사 로그를 남긴다. |
| 권한 연동 | 새 템플릿 `tpl-sales-staff`(영업 담당: sales.view·sales.edit·contact.view·contact.edit, 전사). 지정·해제·계정 발급 때마다 `lib/sales/staff-access.ts`가 부여·회수(assignment_id `sales-staff-<user_id>`). 메뉴는 대상자가 다시 로그인하면 반영, API는 즉시. |
| 회수 | 사원·부서장·임원·검수용 템플릿의 `sales.view` 회수. 영업건 관계자로 등록됐어도 지정되지 않으면 메뉴·영업 API 403(관계자 기록은 유지). |
| 담당 풀 | Salesboard "담당" 필터와 프로젝트 담당자 선택 조직도 = 지정 인원만(직급 규칙 차장 이상 자동 포함 폐지). 일정·브리핑의 참석자 선택은 기존 직급 규칙 유지. |
| 담당자 정보 | 데이터 API `/api/sales/contacts`를 `contact.view`(전 직원)로 옮겨 주소록·모바일 담당자 화면 유지. 메뉴 화면 `/sales/contacts`와 견적서 작성 `/approval/quote`는 `sales.view`. |
| 모바일 웹 | `/m` 홈·일정이 영업 API 403을 오류 대신 "영업 일정 없음/권한 안내"로 표시. 네이티브 앱 편집 버튼은 WP7(OTA)에서 정리. |
| 백필 | 현재 지정자 3명(권오종·이재영·이홍길)에게 298이 tpl-sales-staff 부여. 대표이사·관리자는 지정 없이 메뉴 보유. |

검증: 메뉴 라우트 테스트 8/8(영업 메뉴 노출 규칙·재무/급여 임원 숨김·계약 현황 2메뉴 billing.view 포함), 수정 파일 타입 에러 0, 298 전 문장 스테이징 스키마 EXPLAIN 리허설 오류 0.

### 4.3 배포 후 검증 (2026-10-19 21:30, next 695 = main bac417d, 마이그 298 적용)

| 항목 | 결과 |
|---|---|
| DB | 새 키 3개·tpl-ceo 54키·tpl-sales-staff 4키 생성, 직급 ceo → tpl-ceo, 이유억 tpl-exec 회수·tpl-ceo 부여, 영업 담당 3명(권오종·이재영·이홍길) 백필. billing.view = 관리자·인사/회계·대표이사, payroll/finance.view 동일, sales.view = 대표이사·영업관리·영업 담당·관리자, staffing.sensitive.view = 관리자·인사/회계. 고아 키 0·관리자 누락 0·lock-out 0 |
| 임원 API(재로그인 전에도 즉시) | 계약 목록·사업장·업무계획·성과급 200 / 계약 현황·홈 수금 요약·급여대장·재무·영업 403 / 주소록 담당자 데이터 200 |
| 임원 메뉴(재로그인 후, 권한 요약 16키) | 영업/마케팅·재무·급여 관리·계약 Dashboard·수주/수금/발행 현황 숨김. 계약은 관리·계약서·착수계·다운로드 4개, 사업장·수행인력 실적·임원 검토는 유지 |
| 영업 제설정(관리자) | 카드·도움말·"영업 담당자 설정(3명)"·수집 소스 2버튼 표시. 테스트사원 체크→저장 시 영업 담당 등록 + tpl-sales-staff 부여(부여자 기록)·카드 4명·담당 필터 즉시 반영. 해제→저장 시 목록 삭제 + 템플릿 회수, 감사 로그 2건 |
| 발견 | 홈 상단 요약의 "경과 미입력" 칸이 권한을 보지 않아 영업 권한이 없어도 0으로 표시되고 누르면 권한 없음 화면으로 이동 → 403이면 칸을 빼도록 수정(브랜치 `claude/sales-kpi-gate`, 다음 배포 묶음) |
