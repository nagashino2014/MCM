# IEPS UI 라운드 2B — 지역 드릴다운 지도 + 컨셉 대시보드 카드

## 결정 사항 (사용자 확정)

- **지도 라이브러리**: `d3-geo` + `topojson-client` 로 SVG 정적 렌더링. 외부 API 키 / 결제 계정 불필요.
- **드릴다운 단계**: 전국(시도 17개) → 시도 클릭 시 시군구 zoom-in → 시군구 클릭 시 모달.
- **모달 4종 파이 차트**:
  - (1) 대기 종(1~5종) — `permit_scales.air_class` 집계 (실측)
  - (2) 수질 종(1~5종) — `permit_scales.water_class` 집계 (실측)
  - (3) 화관법 — 컨셉 더미
  - (4) ESG — 컨셉 더미
- **컨셉 요약 카드 5개**: 통합허가(실측) / 화관법(컨셉) / HAPs(컨셉) / ESG(컨셉) / 계약 진행(컨셉). "CONCEPT" 배지로 구분.
- **배치**: 모두 `/data/status`. 헤더 → 컨셉 카드 → KpiPanel → RegionMap → Recent + CollectionOptions.
- **권한**: 모든 신규 화면 read-only — viewer 도 동일 접근.

## 1. 의존성 / 정적 자원

- `d3-geo`, `d3-shape`, `topojson-client` (^3.x)
- `frontend/public/geo/sido.topojson.json` (광역 17), `frontend/public/geo/sigungu.topojson.json` (시군구 250+)
- 출처: vuski/southkorea-maps (MIT) — `frontend/public/geo/README.md` 에 라이선스 표기

## 2. 서버 측 집계 (`frontend/lib/ieps/queries.ts` 보강)

- `getRegionDistribution()` — `bySido[]`, `bySigungu[]`
- `getRegionStats(sido, sigungu)` — `total`, `airClass[1~5]`, `waterClass[1~5]`, `facilities[]` (limit 30)

## 3. API 라우트

- `GET /api/dashboard/regions` (viewer+)
- `GET /api/dashboard/region-stats?sido=&sigungu=` (viewer+)

## 4. 신규 컴포넌트

- `ConceptSummaryCards.tsx` — 5장 KPI/컨셉 카드 그리드.
- `RegionMap.tsx` — SVG choropleth + 시도→시군구 zoom-in + breadcrumb.
- `RegionDrillModal.tsx` — 2x2 파이 차트 + 사업장 30건 리스트 + `/facilities?focus=<id>` 링크.

## 5. `/data/status` 통합

순서: 헤더 → 컨셉 카드 → KpiPanel → RegionMap (+모달) → RecentResults + CollectionOptions → ProgressDrawer.

## 6. `/facilities` 보강

URL `?focus=<facilityId>` 를 selectedId 초기값으로 적용.

## 7. 디자인 가드레일

- `--primary` 단일 hue choropleth, 보라/무지개 색상 금지
- 컨셉 카드/차트는 hatched 배경 + "CONCEPT" 배지로 구분
- 글래스모피즘 톤은 라운드 2A 와 동일 유지

## 8. 검증 시나리오

1. 빌드 통과 + dev 서버 기동.
2. admin → `/data/status` → 컨셉 카드 5장 + 지도 + 기존 섹션 모두 렌더.
3. 라운드 2A 에 등록한 manual 사업장 위치 색이 진해짐 (choropleth).
4. 경기도 클릭 → 시군구 zoom-in, breadcrumb 갱신.
5. 시군구 클릭 → 모달 → 대기/수질 실측, 화관법/ESG CONCEPT 배지.
6. 사업장 리스트 클릭 → `/facilities?focus=` 진입, 자동 선택.
7. viewer → `/data/status` 동일하게 보이고 편집 버튼 비활성.

## 9. 명시적 비범위

- 화관법/HAPs/ESG 실측 데이터 연동 → 계약 모듈 라운드 이후
- cli-collect Playwright fallback → 라운드 2C
- 지도 자유 줌/팬, 읍면동 3단계 드릴다운, 모바일 정밀 튜닝 → 미포함
