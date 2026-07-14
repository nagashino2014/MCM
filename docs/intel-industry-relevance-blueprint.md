# 업종 상관관계 로직 블루프린트 (확정 v2)

> 2026-07-13 작성, 2026-07-14 결정 논점 확정. 수집 신호(intel_signals)와 **통합환경허가 대상 업종** 간
> 상관관계를 판단하는 로직의 확정 설계 + 상세 구현 계획(§8).
>
> **확정된 결정(2026-07-14)**: ①관련성은 등급과 별도 축 ②리스트 전체 노출 + RAG만 none 기본 제외
> ③업종 키 = 기존 20종 재사용 + **수집 설정 카드에서 업종 추가/삭제**(연말~내년 초 신규 편입 예정
> ~8개 업종 대응) ④백필 전량(~3,700건) ⑤supply_chain 은 발굴 후보 포함 + 유발 경로 표시.

## 1. 문제 정의

현재 신호의 "통합허가 관련성" 판단은 소스별 분류 프롬프트에 암묵적으로 흩어져 있다.

| 소스 | 현재 판단 방식 | 한계 |
|---|---|---|
| 뉴스 | Haiku가 "공장·생산시설 신·증설" 여부만 판별 | 업종을 안 봄 — 휴머노이드 부품·의료기기처럼 통합허가와 거리가 있는 제조업도 confirmed |
| EIASS | Haiku가 "대기 1~2종 대상 업종으로 이어질 사업" 판별 | 업종 판단이 프롬프트 문장에만 존재, 결과가 boolean(isTarget) |
| DART | 공시 유형(유형자산 취득 등) 기반 | 업종 무관 — 매칭 사업장 여부로만 필터 |
| 고시/보도자료 | 키워드 | 업종 개념 없음 |

결과: **관련성이 낮은 신호와 높은 신호가 같은 등급으로 섞이고**, "얼마나 우리 영업과 상관있는가"를
정렬·필터할 축이 없다. 반대로 **무조건 배제하면 유용한 간접 신호(밸류체인 유발 수요)를 소거**할 위험
— 사용자 지침: 조심스럽게 접근.

## 2. 설계 원칙

1. **배제가 아니라 축 추가**: 관련성은 삭제/강등 기준이 아니라 **별도 점수 축**. 기존 signal_grade
   (신뢰도)와 직교 — "확실한 신호인데 관련성 낮음"과 "불확실한데 관련성 높음"을 구분한다.
2. **직접/간접 구분 보존**: 간접 신호(EV 공장 증설 → 배터리·부품 후속 수요)는 관련성 '중간'으로
   남기고 유발 경로를 기록한다. 소거하지 않는다.
3. **기준 체계는 법정 업종**: 환경오염시설법 별표(대기·수질 1~2종) 기반 **통합허가 21개 업종(기존 19종 + 시멘트·이차전지 편입)**을
   1차 태깅 체계로 쓴다(KSIC 는 세분화가 과함 — 필요 시 2차).
4. **점진 적용**: 신규 수집분부터 태깅 → 기존 데이터 백필 배치(전량 ~3,700건 Haiku ≈ $1 미만) →
   화면·RAG 반영. 각 단계에서 실측 검증 후 다음 단계.

## 3. 제안 데이터 모델

```sql
-- intel_signals 확장(068 예정)
industry            text,     -- 통합허가 21업종 키(예: power/incineration/chemical/steel/…) 또는 'other'
industry_relevance  text,     -- direct | supply_chain | low | none
relevance_note      text      -- 간접일 때 유발 경로 한 줄(예: "EV 완성차 증설 → 배터리·부품 공장 후속 수요")
```

- `industry_relevance` 4단계:
  - **direct**: 신호 주체/사업 자체가 대상 업종(발전·소각·화학·제철·정유·제지·반도체 등) 또는 그 입주
    기반(산단·농공단지 조성)
  - **supply_chain**: 주체는 비대상이지만 밸류체인상 대상 업종의 후속 투자·입주를 유발
    (완성차 EV·데이터센터 전력 수요·대형 산단 인프라)
  - **low**: 제조업이지만 통합허가 규모·업종과 거리(소규모 근린 제조·의료기기·부품 조립 등)
  - **none**: 비제조(서비스·유통·건설 시공만) — 단, 분류 신뢰가 낮으면 low 로 보수 판정

## 4. 판단 로직 (하이브리드 3층)

```
① 규칙 층(무비용): EIASS bizCategory·DART 업종코드·산단 키워드 → direct 자명 케이스 즉시 태깅
② LLM 층(Haiku): 기존 소스별 분류 호출에 industry/relevance 필드 추가(신규 API 호출 없음 — 프롬프트 확장)
③ 임베딩 층(보조): "대상 업종 기술문" 임베딩과 신호 임베딩 코사인 → LLM 판정과 크게 어긋나는 건 재검토 큐
```

- ②가 본체. ①은 비용 절약+일관성, ③은 검증·이상치 탐지용(선택 적용).
- facilities 매칭이 이미 된 신호(matched)는 **facilities 의 실제 업종을 우선**(마스터가 정답).

## 5. 활용 (판단 결과를 어디에 쓰나)

| 지점 | 적용 |
|---|---|
| API&스크래핑 리스트 | 관련성 pill + 필터(직접/공급망/낮음) — 기본 전체 노출(배제 없음) |
| RAG 검색·브리핑 | 기본 none 제외(excluded 처럼 옵션으로 포함 가능), 검색 랭킹에 relevance 가중 |
| 영업 발굴 후보 | direct 우선 정렬, supply_chain 은 유발 경로와 함께 표시 |
| 야간 배치 알림 | direct+confirmed 만 alerts (현재 무차별 → 정밀화) |
| 향후(학습 루프) | 사용자 전환/무시 행동으로 업종별 관련성 보정(P4, 데이터 축적 후) |

## 6. 단계별 로드맵 (안)

- **P1 — 태깅 기반**: 068 마이그레이션, 소스별 분류 프롬프트 확장(뉴스·EIASS), 규칙 층, 백필 배치.
  검증: 샘플 200건 수동 대조.
- **P2 — 화면·RAG 반영**: 리스트 pill·필터, RAG 기본 필터·랭킹 가중, 발굴 후보 정렬.
- **P3 — 공급망 사전 고도화**: 업종별 유발 관계 사전(EV→배터리→양극재, 데이터센터→발전·냉각,
  반도체→소부장·특수가스 등)을 프롬프트 컨텍스트로 주입해 supply_chain 판정 일관성 확보.
- **P4 — 피드백 루프**: 전환(converted)/무시(dismissed) 이력 기반 관련성 보정(충분한 데이터 축적 후).

## 7. 결정 사항 (2026-07-14 확정)

| 논점 | 결정 |
|---|---|
| 관련성 축 | **grade 와 별도 축으로 분리** — 리스트에 관련성 pill·필터 추가 |
| 기본 노출 | **리스트 전체 노출(pill 구분) + RAG 검색·브리핑만 none 기본 제외**(옵션으로 포함 가능) |
| 업종 키 체계 | **기존 `INTEGRATED_PERMIT_INDUSTRIES` 상수 재사용** + 수집 설정 카드에서 **업종 추가/삭제**(신규 편입 예정 ~8개 업종 대응). 특수 키 2개 추가: `industrial-complex`(산단·농공단지 = 입주 기반), `other` |
| 법정 21종 대조 | 법정 = 기존 19종 + 시멘트·이차전지 편입 = **21종**. 코드 상수는 시멘트·이차전지 포함 **20항목**이라 1종 차이(묶음 방식 차이 또는 누락 가능성) — **구현 1단계에서 기본 업종 목록을 사용자에게 제시해 대조·확정**(설정 UI 로 사후 보정도 가능) |
| 백필 범위 | **전량**(~3,700건, excluded 포함 — Haiku 비용 $1 미만) |
| supply_chain | **발굴 후보 포함** — direct 우선 정렬 + 유발 경로(relevance_note) 표시 |

## 8. 상세 구현 계획 (확정)

### 8-1. 데이터·설정 기반

- **068 마이그레이션** (`infra/aws/068_intel_industry.sql`, 멱등):
  ```sql
  ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS industry           text;  -- 업종 id(20종+industrial-complex+other+사용자 추가)
  ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS industry_relevance text;  -- direct|supply_chain|low|none
  ALTER TABLE intel_signals ADD COLUMN IF NOT EXISTS relevance_note     text;  -- 간접일 때 유발 경로 한 줄
  -- CHECK(industry_relevance) + ix_intel_signals_relevance 인덱스
  ```
- **intel_settings 확장**: `industries` 섹션 신설 — DEFAULTS = 코드 상수
  `INTEGRATED_PERMIT_INDUSTRIES`(현재 20항목, 시멘트·이차전지 포함)에서 `{id, label}` 자동 파생.
  DB 오버라이드는 목록 전체 교체 방식(뉴스 keywords 와 동일 패턴). 신규 업종 항목 =
  `{id: slug 자동, label, note?: 프롬프트 힌트}`. 삭제는 기본 항목도 가능(편입 제외 대응).
  **⚠ 1단계에서 기본 목록을 법정 21종과 대조해 사용자 확정** — 차이 1종은 상수 보정 또는 설정 추가.
- **설정 UI**: `IntelCollectSettingsPanel` 공통 탭에 "통합허가 대상 업종" 칩 편집기(KeywordChips
  패턴 재사용, 라벨+선택 힌트 입력). 여기 목록이 곧 LLM 태깅 후보군이 된다.

### 8-2. 판단 로직 배선

- **news-classifier / eiass-classifier 확장**: 프롬프트에 설정의 업종 목록을 동적 주입,
  출력 JSON 에 `industry`(목록의 label → 서버에서 id 매핑, 목록 밖이면 other),
  `industryRelevance`(direct/supply_chain/low/none), `relevanceNote`(supply_chain 일 때 한 줄) 추가.
  기존 호출 횟수 그대로(비용 증가 없음).
- **규칙 층(무비용, LLM 판정보다 우선 적용)**:
  - EIASS `bizCategory` 가 산단·농공단지 조성 → `industrial-complex`/direct,
    폐기물처리시설 → `waste-incineration`/direct, 에너지개발 → `power`/direct.
  - facilities `matched` 신호 → facilities 의 KSIC → 20종 매핑(`industryCodeMatchesCategory`
    재사용)으로 industry 확정, relevance=direct (마스터가 정답 — LLM 판정 덮어씀).
  - DART: 매칭 전제 소스이므로 위 규칙으로 전건 direct 처리(LLM 불필요).
- **수집기 적재**: collect-news/eiass/press 의 INSERT 에 3컬럼 추가. gosi(산단 고시)는
  규칙으로 `industrial-complex`/direct 고정.

### 8-3. 백필 배치 (일회성, 재분류 전례와 동일 패턴)

- 전 신호 대상. 우선순위: ①규칙 층으로 자명 케이스 일괄 UPDATE(무비용, matched·EIASS·gosi·DART
  — 전체의 ~70% 예상) → ②나머지만 Haiku 태깅(뉴스·press 미매칭분 위주).
- `raw_json.industryTagged` 에 시각·방법(rule|llm) 기록. 검증: 관련성 분포 + 샘플 30건 수동 대조.

### 8-4. 화면·RAG 반영

- **intel-shared**: RELEVANCE_LABEL/PILL(직접=success, 공급망=info, 낮음=idle, 무관=outline),
  IntelSignal 에 3필드.
- **IntelBoard**: 리스트에 관련성 pill(등급 옆), 필터 select(전체/직접/공급망/낮음/무관).
  상세 모달에 업종·유발 경로 표시.
- **RAG**: `buildRagWhere` 기본 `(industry_relevance IS NULL OR industry_relevance <> 'none')`
  — 태깅 전(NULL) 신호는 포함(안전). 필터 파라미터 `relevance` 추가. 랭킹 가중은 1차 범위 밖
  (분포 확인 후 2차 검토).
- **발굴 후보**: direct 우선 정렬(CASE), supply_chain 카드에 유발 경로 병기.
- **야간 알림 정밀화**: 수집기 alerts 발행 조건을 confirmed+matched → confirmed+matched+**direct** 로.
- **브리핑 컨텍스트**: `buildSignalContent` 에 업종·관련성 라인 추가 — 기존 임베딩은 재생성하지
  않음(신규 적재분부터 새 포맷, 검색 정확도 영향 미미).

### 8-5. 작업 순서·검증

1. 068 + intel-settings + 설정 UI (업종 관리 기능이 태깅의 전제)
2. 분류기·수집기·규칙 층 배선 → tsc + 로컬 소량 수집 테스트
3. 백필 실행(규칙 → LLM) → 분포·샘플 검증 → 사용자 확인
4. 화면·RAG 반영 → 로컬 검증 → 사용자 확인 → 커밋·배포
5. (2차 후보) supply_chain 사전 고도화(P3), 랭킹 가중, 피드백 루프(P4)
