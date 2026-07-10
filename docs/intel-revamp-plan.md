# 발주 신호(intel) 개편 계획 — C·D단계 구현 스펙

> 2026-07-10 사용자와 확정한 4단계 개편 플랜의 잔여분(C·D) 상세 스펙.
> A(매칭 강화)·B(수집 설정 인프라)는 **완료·배포됨** (커밋 `465aa1b`, `628e8ff`, 태스크 정의 rev 173).
> 새 세션에서 이 문서만 읽고 착수할 수 있도록 배경·결정사항·구현 포인트를 모두 담는다.

## 배경 (사용자 요구 4방향)

1. ~~사업장 매칭 강화~~ → **A단계 완료** (`frontend/lib/intel/facility-matcher.ts`, EIASS 매칭 58→125, 뉴스 3→37)
2. ~~공시일 수집 하한 1년 6개월~~ → **B단계 완료** (`intel_settings.common.maxAgeMonths=18`, 기존 초과분 EIASS 1,094건 excluded 강등)
3. 뉴스는 일률 후보화하지 않는다: **사업장 매칭 + 시그널 확실(confirmed)만 후보 편입, 그 외는 벡터 DB 축적 → RAG 브리핑** — D단계
4. 후보 목록 클릭 시 **소스별 전용 원문 모달** (외부 링크 이동 대신 내용 자체 표시) — C단계

추가 배경: 신호 리스트가 `LIMIT 500` 하드코딩(`frontend/lib/intel/intel-queries.ts:110`)이라 총 1,880건 중 잘림. API와 RAG를 한 메뉴에 담기엔 한계 → **메뉴 분리** 결정.

## C단계: 화면 개편

### C-1. 메뉴 분리

- 기존 `frontend/app/(app)/sales/intel/page.tsx` (API&RAG) →
  - **"API&스크래핑"** 메뉴: 수집·선별 화면 (아래 C-2 컨셉)
  - **"RAG&영업 발굴"** 메뉴: 신규 (D단계에서 채움 — RAG 분석 + 정제된 후보군 결합 영업 발굴. C단계에서는 라우트/빈 화면 스켈레톤만)
- UI는 cdash 디자인 시스템 (`CLAUDE.md`·`.cursor/rules/ui-modernize.mdc` 준수).

### C-2. "API&스크래핑" 화면 컨셉 (사용자 제공 스샷 — 텍스트化)

**좌측 (2/3 폭):**
- 상단 소스 탭 6개: `DART | EIASS | 보도자료 | NAVER | 토지이음 | 유역청`
- 필터 행: 회사명/공시명 검색 입력 + 드롭다운 4개 (신호유형 전체 / 매칭 전체 / 상태 전체 / 등급 전체)
- 신호 리스트 (선택 체크박스 포함)
- **페이지네이션** (`이전 1 2 3 … 204 다음` — LIMIT 500 하드코딩 제거가 전제)
- 리스트 하단 일괄 작업 버튼 4개: `제외 일괄 삭제 | 매칭 일괄 편입 | 선택 일괄 삭제 | 관찰 일괄 삭제`
- **좌측 하단 = 수집 설정 패널** (스샷에서 비어 있던 영역, 아래 C-3)

**우측 (1/3 폭): "발주 정보 분석용 데이터 수집현황" 패널**
- 기간 선택 (예: 26.06.01 ~ 26.06.30)
- 수집 총계 카드 (큰 숫자) + 소스별 6칸 (DART 55 / EIASS 311 / 보도자료 72 / NAVER 648 / 토지이음 105 / 유역청 64 식)
- **수집현황 추이 차트** (월별): 막대 2종(수집 총계·채택 건수) + 라인(채택률, 보조축) — ApexCharts
- **소스별 채택 현황**: 소스별 도넛 6개 (채택률 %, `채택/수집` 병기)
- **소스별 세부 유형**: 소스 탭 + 파이 차트 (신호유형별 건수: 투자 15/증설 10/신설 3/기타 2 식) + 필터 버튼(신호유형/매칭/상태/등급)
- "채택"의 정의: 사용자가 후보로 확정(converted)한 건 또는 등급 confirmed — 구현 시 사용자에게 1회 확인 권장

### C-3. 수집 설정 패널 (B단계 API `/api/sales/intel/settings` 사용)

3단 구성:
1. **공통**: 소스 6종 ON/OFF 토글, 공시일 하한(개월, 기본 18), (추후) 후보 편입 기준·알림 등급
2. **소스별 탭** (탭 선택 시 해당 소스 옵션):
   - DART: 소급 일수 / 2차 원문(발주처 대조) 분석 ON·OFF
   - EIASS: 스캔 페이지 수 / 포함·제외 키워드 편집기 (칩 입력)
   - NAVER 뉴스: 검색 키워드 목록 편집(기본 8개) / 키워드당 건수 / 일일 AI 분류 상한
   - 보도자료: 지자체 어댑터 8종 개별 ON/OFF (ulsan·jeonnam·gyeongbuk·chungnam·gyeonggi·gyeongnam·jeonbuk·mcee) / 제목·부서 키워드
   - 토지이음·유역청: 검색 키워드(산업단지·농공단지 중 선택) / RSS ON·OFF / **토지이음은 "AWS IP 차단 — 로컬 수집 필요" 상태 뱃지 표시** (아래 '미해결' 참조)
3. **수동 실행**: 소스별 "지금 수집(소량 테스트)" 버튼 (`POST /api/sales/intel/collect` — 뉴스 배선 완료됨) + `intel_collect_state.last_run_at` 표시 + 마지막 배치 결과
- 스로틀·타임아웃 등 저수준 값은 노출하지 않음 (소스 차단 위험).

### C-4. 신호 리스트 페이지네이션

- `intel-queries.ts` `listIntelSignals`: `LIMIT 500` → `limit/offset` 파라미터 + `total` 반환 (facilities 패턴과 동일)
- `/api/sales/intel/signals` 라우트에 limit/offset 파싱 추가, 화면에 `PaginationControls`(`frontend/components/ui/PaginationControls.tsx`) 재사용
- 리스트에 "수집일(created_at)" 병기 — 공시일만 보여서 "오늘 수집분이 안 보인다"는 오해가 있었음 (2026-07-10 실사: 배치는 65건 삽입했는데 공시일 표기 때문에 1건으로 보임)

### C-5. 소스별 원문 모달 (방향 4)

외부 링크 이동 대신 자체 모달로 내용 표시. **포털 모달은 `.cdash` 밖이므로 루트에 `cdash-vars`+`data-theme` 필요** (CLAUDE.md).

| 소스 | 구현 포인트 |
|---|---|
| DART | `getDocumentText(receiptNo)`(`dart-client.ts`, document.xml ZIP→텍스트)를 서버 라우트로 노출해 모달에 원문 텍스트 표시. 원본 링크는 보조로 유지. **주의: DART는 IP 제한 — 서버(ECS, DART_HTTPS_PROXY 경유)에서만 호출 가능** |
| EIASS | **원문 링크가 리스트 셸 페이지뿐이라 게시판 재검색이 필요했던 문제** → 상세 데이터가 이미 `raw_json.detail`(bizCategory·operator·region·scaleText·costEokwon 등)에 저장돼 있으므로 **추가 fetch 없이 모달에 구조화 표시** (`collect-eiass.ts:193-196` 근방 참조) |
| 보도자료 | 본문이 `raw_json.body`에 저장됨(최대 3000자) → 모달에 표시. 원문 직링크도 있음 |
| NAVER 뉴스 | 원문 링크 유지 + `raw_json.classification.summary`(Haiku 요약) 팝업 추가 |
| 고시 | 직링크 있음(토지이음 상세/RSS read) — 모달 불필요, 링크 유지 |

## D단계: 벡터 DB + RAG (별도 설계 필요)

- pgvector (영업·마케팅 블루프린트에서 기채택 결정)
- 뉴스: 매칭+confirmed만 후보 편입, 그 외 전량 벡터 DB 축적. DART/EIASS/토지이음/보도자료의 자동분류·사용자 선별 데이터도 임베딩 대상
- "RAG&영업 발굴" 메뉴: 질의형 브리핑 (예: "반도체 업종 최근 1년 투자·공장 신설 동향") — 검색→Claude 생성 보고서
- 설계 논점: 임베딩 모델(비용), 청크 단위, 후보 편입 기준 변경이 기존 화면에 주는 영향

## 기술 참고 (새 세션용)

- 수집기: `frontend/lib/intel/collect*.ts` 5종, 설정 `intel-settings.ts`(DEFAULTS=운영값), 매처 `facility-matcher.ts`, 배치 `frontend/scripts/intel-batch.ts`(ECS RunTask, KST 03:00, next 이미지 최신 리비전 사용)
- 신호 테이블 `intel_signals`(059), 설정 `intel_settings`(065). 등급: confirmed/candidate/monitoring/excluded, 기본 리스트는 confirmed+candidate
- 수동 수집 테스트: `POST /api/sales/intel/collect` `{source: "eiass"|"press"|"gosi"|"news"|없음(DART)}`
- **미해결**: 토지이음(eum.go.kr)이 AWS IP 대역 차단(ECS·bastion 모두 connect timeout, 2026-07-10 실측) → 로컬 수집 스크립트 분리 또는 대체 소스 재실사 필요. 야간 배치에서 해당 채널만 실패하고 나머지는 정상
- 수집기 파라미터 전수 인벤토리(설정 UI 항목의 근거)는 B단계 커밋 `628e8ff`의 `intel-settings.ts` DEFAULTS 참조
