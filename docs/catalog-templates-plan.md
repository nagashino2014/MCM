# 회사소개서 템플릿 4종 추가 — 조사·구현 계획

작성 2026-10-29. 모체 계획서 [company-catalog-blueprint.md](company-catalog-blueprint.md)(P1~P7 배포 완료, next:742 기준)의 후속.
사용자 결정(10-29): **템플릿 = 테마 + 쪽 변형 묶음**(완전 별개 디자인 4벌은 아님), 4종은 **디자인 스타일별 + 용도별 조합**.

## 1. 현재 구조 — "템플릿"은 무엇의 묶음인가

조사 결과(코드 기준 1016f220) 회사소개서 템플릿은 다음 다섯 가지의 묶음이며, 지금은 이 묶음이 **한 벌**뿐이다.

| # | 구성 | 위치 | 비고 |
|---|---|---|---|
| 1 | 쪽 계획(쪽 키·유형·순서·섹션·편집 수준·흐름) | `frontend/lib/catalog/render/components/plan.tsx` `buildPagePlan` | 쪽 유형 22종(C01~C19·A01~A03), 실제 쪽 키 약 30개 |
| 2 | 쪽 유형별 React 컴포넌트 + 부품 | `render/components/pages-*.tsx`(약 2,165줄)·`parts.tsx`·`infographics.tsx`·`render/infographic/*` | 훅 없는 순수 함수, `variant` prop 은 C05(`visual`)·C09(`hero`) 두 곳만 |
| 3 | 마스터 문안 | `render/master-content.ts` | 톤을 바꿀 때만 |
| 4 | 지면 키트 | `public/catalog-kit/kesi-catalog.css`(731줄, 디자인 시스템 bundle.css **사본 — 손수정 금지**)·`render/tokens.json`(840줄)·`print-overrides.ts`·키트 이미지 | 공용 `print-kit/sheet.css`·`paginate.js` 위에 올라감 |
| 5 | 문서 수준 선택지 `DocumentTheme` | `lib/catalog/document-theme.ts` → `catalog_documents.theme` jsonb | 표지 4안(A·D 확정, B·C 대기)·사진 유무·서체 세트·색 컨셉 3종 |

**템플릿 밖에 있는 것**: 데이터(`CatalogRenderData`, `render/data.ts`)와 편집층(`PageEdits`, `catalog_pages.tree`). 둘 다 쪽 키에 묶인다.

### 1-1. 이미 있는 "변형 축"과 빈 구멍

| 축 | 선택지 | 실제 구현 | 상태 |
|---|---|---|---|
| 색 컨셉 | navy·green·charcoal(+검토용 dark) | `.kc-concept--{id}` 가 CSS 변수를 갈아 끼움. `tokens.json` 에 **navy·dark 값만** 있음 | **B 그린·C 차콜은 선택지만 있고 색 값이 없다** → 고르면 navy 와 같게 그려짐 |
| 표지 | leaf·strips·center·band | `CoverPage` 분기 + CSS | B·C 확정 대기 |
| 모티프 | drop·ring·contour | CSS 는 세 가지 다 있음(`.kc-motif--*`) | **코드가 `kc-motif--drop` 을 하드코딩**(parts.tsx:112·infographics.tsx:178·PanelDesign.tsx:366·PanelIllustration.tsx:83) → 선택지 없음 |
| 서체 세트 | noto·pretendard·plex·serif + 사용자 세트 | 완성 | serif 세트의 PDF 포함은 TrueType 변환 필요(§9-1 함정) |
| 판 | print/draft · masked/real · full/summary | 완성 | summary 는 부록 제외뿐 |
| 쪽 변형 | `PageEdits.variant` | C05·C09 만 해석 | 템플릿별 기본 variant 를 줄 자리가 없음 |
| 문서 | `catalog_documents.kind master/custom`, `?doc=` docId 체계 | 표·API 는 있으나 **첫 화면·theme route 가 `MASTER_DOC_ID` 고정** | 문서 복수화의 반은 되어 있음 |

### 1-2. 편집층 호환 — 설계의 핵심 제약

노드 id 는 **마크업 구조의 해시**(`studio/convert.ts` + `nodes.ts` cyrb53)다. 같은 쪽 키라도 마크업이 달라지면 id 가 달라져 L1~L3 노드 편집(글 고정·스타일·숨김·인포그래픽 유형·일러스트)은 **고아**가 된다(`orphanEdits`, html.ts:137 경고). 쪽 순서·숨김·`added`(자유 요소)·`variant` 는 살아남는다.

→ 따라서 "마스터 문서의 템플릿을 바꾼다"는 모델은 편집을 잃는다. **템플릿은 '새 문서를 만들 때 고르는 출발점'**으로 두고, 문서마다 템플릿이 고정되는 모델을 택한다(§3-1). 기존 마스터 문서는 `standard` 템플릿으로 그대로 남는다.

### 1-3. 계획과 다른 점(정정)

블루프린트 §8-1 은 "쪽 유형 템플릿을 Claude Design 핸드오프(.dc.html) 파서로 코드 수정 없이 등록"이라 했지만, P5 실제 구현은 React 컴포넌트에서 트리를 매번 다시 만드는 방식이다. 채용공고 파서(`lib/recruit/parse.ts`)를 회사소개서는 쓰지 않는다. 이번에도 **.dc.html 등록 경로는 만들지 않는다** — 변형은 React 컴포넌트 + CSS 로 구현하고, claude.ai/design 은 목업·디자인 시스템 산출에만 쓴다.

## 2. 템플릿 4종 제안

기본 = **T0 스탠다드**(지금 모습: 네이비·A 잎 창·물방울 모티프·프리텐다드·풀버전). 아래 4종을 더한다.

| ID | 이름 | 성격 | 테마 | 쪽 변형·구성 | 주 용도 |
|---|---|---|---|---|---|
| **T1 `photo`** | 포토 에디토리얼 | 스타일: 사진 중심 | 네이비 · 표지 **E 전면 사진**(신규) · 모티프 drop · 프리텐다드 | 간지 = 전면 사진 + 반투명 판, C04 = 사진 배경 위 KPI 띠, C09 = 큰 히어로 사진(`hero: photo-wide`), C13 = 인물 카드 3:4 큰 사진 | 민간 사업장·홈페이지 다운로드용. **사진이 없는 쪽은 자동으로 T2 변형으로 폴백** |
| **T2 `graphic`** | 인포그래픽형 | 스타일: 사진 없음 | **B 그린** · 표지 **F 그래픽**(C 중앙 정렬 기반, 모티프 패턴 면) · 모티프 **ring** · 프리텐다드 | 간지 = 분야색 면 + 패턴, C04 = 아이콘+큰 숫자 카드 8개, C09 = 인포그래픽 확대(사진 자리 없음), C06 = 가로 타임라인, C10 = 역량 카드 아이콘 큰 변형 | 사진 부족 시 기본·화면 발표용. 벤치마크 "사진 없는 변형 필수" 요구의 본체 |
| **T3 `formal`** | 격조·공공형 | 스타일: 세리프 + 용도: PQ 심사 | **C 차콜 + 그린 강조** · 표지 **B 세 기둥**(확정 필요) 또는 여백 흰 표지 · 모티프 **contour** · 서체 세트 **serif**(세리프 제목 + 고딕 본문) | 섹션 순서 변경: 신뢰 근거(인증·등록·특허, 실적 총괄)를 사업 분야 앞으로, C06 연혁 세로 4단, 부록 A 를 본편에, 밀도 ↑(본문 10pt) | 공공 발주처 PQ 심사·입찰 증빙 패키지 첨부 |
| **T4 `brief`** | 요약·분야 브리프 | 용도: 요약본 + 분야 맞춤 | 네이비 · 표지 D 사진 띠 · drop · 프리텐다드 | **쪽 계획이 다름**: 표지 → 숫자 → 분야 개관 → **분야 1장 요약(C20 신규, 선택 분야만)** → 핵심 역량 → 인증 → 연락처(8~12쪽). 부록 없음. 선택 분야 = 문서 설정(`areas[]`) | 제안서·견적 첨부, 분야 맞춤판(블루프린트 P8 "capability sheet" 흡수) |

색 컨셉 B·C 의 실제 색 값과 모티프 ring·contour 의 모양은 디자인 단계(TP1)에서 정한다 — CI 전용색 #102543·#72AF2D·#0093B8 기준.

## 3. 구조 설계

### 3-1. 템플릿 정의와 문서 모델

```ts
// lib/catalog/templates.ts (신규, 클라이언트 안전)
export interface CatalogTemplate {
  id: TemplateId;                       // "standard" | "photo" | "graphic" | "formal" | "brief"
  label: string; desc: string;
  theme: DocumentTheme;                 // 기본 테마(concept·cover·coverPhoto·fontSet·motif)
  plan: "full" | "formal" | "brief";    // 쪽 계획 종류(plan.tsx 분기 키)
  variants: Record<string, PageVariant>; // 쪽 키별 기본 변형 — PageEdits.variant 가 덮어쓴다
  fallback?: "graphic";                 // 사진 없는 쪽의 폴백(T1)
  requires?: { photos?: string[] };     // 미리보기·검사에서 "부족한 자산" 안내용
}
```

- `DocumentTheme` 에 `template: TemplateId`·`motif: "drop"|"ring"|"contour"`·`areas?: number[]`(T4) 추가. `sanitizeDocumentTheme`·`store.ts` 화이트리스트·`document-theme/route.ts` PUT 반영. `catalog_documents.theme` 가 jsonb 라 **마이그레이션 불필요**(컬럼 추가 없음). 저장값이 없으면 `standard`·`drop` 으로 읽어 기존 문서는 그대로.
- **문서 복수화**: 템플릿은 "새 문서 만들기"에서 고른다 → `catalog_documents` 행 추가(kind `custom`, doc_id = `tpl-{template}-{yymmdd}` 류). 마스터(`master`)는 `standard` 고정. 첫 화면에 문서 목록·[새 문서(템플릿 고르기)]·문서 전환을 두고 `MASTER_DOC_ID` 고정을 푼다(`document-theme` route·`CatalogCoverPicker`·스튜디오 `?doc=`). 발행·반영 대기·버전은 이미 docId 단위라 그대로 따라온다.
- 편집층은 문서(docId)별로 이미 분리돼 있으므로 §1-2 의 고아 문제가 생기지 않는다. 같은 문서 안에서 **템플릿 변경은 허용하지 않는다**(테마의 색·서체·표지·모티프는 바꿀 수 있음 — 마크업이 안 바뀌므로).

### 3-2. 렌더 경로

- `RenderCtx` 에 `template`·`motif` 추가 → `Sheet` 루트에 `kc-tpl--{id} kc-motif--{motif}`(하드코딩 4곳 제거).
- `buildPagePlan(ctx, data, cover, variants, template)`: 쪽 키·유형·섹션 정의는 공유하고 `template.plan` 으로 순서·포함 쪽을 바꾼다(`full`/`formal`/`brief`). 쪽 컴포넌트는 `variant = {...template.variants[key], ...edits.variant}` 로 받는다.
- 쪽 변형은 **같은 컴포넌트 안의 분기**(CoverPage 방식)로 둔다 — 레지스트리로 컴포넌트를 통째 갈지 않는다. 변형이 큰 쪽(C07 간지·C20)은 파일을 나눈다.
- 색 컨셉 B·C: `tokens.json` `color.tokens.*` 에 `green`·`charcoal` 값 추가 → `tokensToCss` 가 `.kc-concept--green/charcoal` 을 자동 생성(변환기 수정 없음). 스튜디오 `design-system.ts` 팔레트도 같은 파일을 읽으므로 따라온다.
- 템플릿 전용 CSS 는 **디자인 시스템(bundle.css) 경유**가 원칙. 변형 클래스(`.kc-front--photo`, `.kc-divider--photo`, `.kc-kpi--band`, `.kc-sheet--brief` …)를 디자인 시스템 아티팩트에 추가하고 `kesi-catalog.css` 를 재export 한다. 급한 보정만 `print-overrides.ts` 에 `.kc-tpl--{id}` 범위로.
- 스튜디오 지면 키트 캐시(`studio/kit.ts` 모듈 전역 1회)는 CSS 파일이 하나라 그대로 둬도 되지만, 템플릿별 CSS 파일로 갈라지면 키별 캐시로 바꾼다.
- 발행: `catalog_editions.options` 에 `template`·`motif`·`areas` 기록(`editions.ts:214-225`). `catalog_versions.snapshot` 은 theme 을 통째로 넣으므로 자동.
- 일러스트 쪽 적합도(`fits`)는 pageType 기준이라 템플릿과 무관. AI 윤곽 추출 규칙(`ai/patch.ts:158-166`)·스튜디오 선택 규칙(`select.ts:119`)은 새 클래스명이 생기면 추가.

### 3-3. 쪽 변형 목록(구현 대상)

| 쪽 | 변형 키 | 값 | 쓰는 템플릿 |
|---|---|---|---|
| C01 표지 | `cover` | 기존 4 + `photo`(E 전면 사진) + `graphic`(F 그래픽) | T1·T2 |
| C04 숫자 | `layout` | `grid`(기본) · `band`(사진 배경 띠) · `cards8`(아이콘+큰 숫자 8) | T1·T2 |
| C06 연혁 | `axis` | `vertical`(기본) · `horizontal` · `columns4`(연대별 4단) | T2·T3 |
| C07 간지 | `style` | `leaf`(기본) · `photo-full`(전면 사진+판) · `color-pattern`(분야색 면+패턴) · `plain`(단색) | T1·T2·T3 |
| C09 분야 상세 | `hero` | 기존 + `photo-wide` · `none`(인포그래픽 확대) | T1·T2 |
| C10 핵심 역량 | `cards` | `compact`(기본) · `icon-large` | T2 |
| C13 임원진 | `card` | `square`(기본) · `portrait-large` · `list`(사진 없음, 격조) | T1·T3 |
| C16 인증 | `view` | `gallery`(기본) · `table`(목록형, 격조) | T3 |
| **C20 분야 1장 요약** | 신규 쪽 유형 | 핵심 서비스·강점·분야 KPI·대표 실적 3건·담당 연락처를 한 장에(AECOM 방식) | T4 |

사진이 필요한 변형(`photo-full`·`band`·`photo-wide`·`portrait-large`)은 자산이 없으면 템플릿 `fallback` 변형으로 그리고, 쪽 검사에 "사진 없음 — 그래픽 변형으로 그림" 안내를 남긴다.

## 4. 준비 단계와 필요한 자료

### 4-1. "템플릿 학습"에 대하여

생성 모델 학습(fine-tuning)은 **불필요하고 권하지 않는다**(10-22 결론과 같음: 표본 수십 점·래스터 출력·스톡 약관의 AI 학습 제한). 필요한 것은 학습이 아니라 **참고 자료를 보고 사람이(또는 Claude 가 디자인 세션에서) 변형을 설계하는 것**이다. 그 참고 자료 목록이 아래 4-2.

### 4-2. 자료 목록(사용자 준비·확인)

| 구분 | 자료 | 있음/필요 | 용도 |
|---|---|---|---|
| 벤치마크 | 공개 브로슈어 7종 211쪽(`C:\Users\nagas\Downloads\회사소개서_벤치마킹\`, 분석 `docs/catalog-benchmark-analysis.md`) | 있음 | T1(대우·교보 사진형)·T2(국가철도공단 색면·숫자)·T3(AECOM 세리프)·T4(AECOM 인허가 1장) 패턴 |
| 벤치마크 추가 | 공공 PQ 제출용 엔지니어링·컨설팅사 소개서 1~2종(한국환경공단·환경부 등록 대행사, 엔지니어링협회 회원사 공개본) | **필요(권장)** | T3 격조·공공형의 구성 근거. 없으면 AECOM + 국가철도공단으로 대체 |
| 자사 이전 판 | `V:\업무자료\홈페이지&브로슈어 관리\(주)한국환경안전연구원_회사팜플렛(24.01.25.).pptx`·`한국 환경안전 연구원 소개자료.pptx`·`KPCA 총회 회사 및 대표이사 소개자료.pptx`·`서부발전 제안서 그림.pptx` | 있음 | 용도별(제안서 첨부·대표 소개) 구성 참고, T4 분야 1장 요약의 문안 원천 |
| 사진 | `홈페이지 사진` 폴더·`회사 전경.jpg`·사옥 3장(키트) | 있음(양 미확인) | **T1 은 쪽당 사진 1장 이상 필요** — 현장·인물·사옥·장비 사진 목록화 + 300dpi 판정(기존 `chooseCover` DPI 판정 재사용). 부족분은 촬영 목록으로 |
| 그래픽 | 로고 원본(`회사 로고 원본 소스`)·구입 일러스트 30여 점·보유 AI 파일 | 있음 | T2 패턴 면·간지 모티프, 표지 F 그래픽 |
| CI | CI 가이드(전용색·전용서체) | **확인 필요** | 색 컨셉 B 그린·C 차콜의 실제 값, 세리프 허용 여부 |
| 서체 | 세리프 제목 후보(OFL): Noto Serif KR · 본명조(Source Han Serif) · 나눔명조 | **선택 필요** | T3. PDF 포함은 TrueType 변환(`scripts/catalog/pretendard_otf2ttf.py` 재사용) |
| 디자인 산출물 | 디자인 시스템 아티팩트 `claude.ai/artifact/AovTvRBgpnUv7r6CQvxp8B` · 쪽 유형 목업 `2bMEZ7oMfZbNUfCtswStMb` | 있음 | 테마 B·C·모티프 ring/contour·변형 클래스 추가 → bundle.css 재export. ⚠ 독립형 claude.ai/design 은 **2026-12-14 종료** → 그 전에 끝내거나 Design System 아티팩트로 이관 |

### 4-3. 결정이 필요한 사항

| # | 결정 | 권장 |
|---|---|---|
| T-1 | 4종 확정(§2) — 이름·성격 | 제안대로. 이름은 화면 표기용이라 뒤에 바꿀 수 있음 |
| T-2 | 색 컨셉 B 그린·C 차콜 값 | CI 그린 #72AF2D 바탕 + 네이비 글자(B), 차콜 #2b2f36 + 그린 강조(C). TP1 시안 2안씩 |
| T-3 | 모티프 ring·contour 모양 | 디자인 시스템 README 후보(순환 링·등고선) 그대로, 표지·간지·뒤표지에만(본문 절제 규칙 유지) |
| T-4 | 표지 B 세 기둥·C 중앙 정렬 확정 | T3 가 B, T2 가 C 파생 F 를 쓰므로 **이번에 확정** |
| T-5 | T3 섹션 순서(신뢰 근거 앞으로) | 권장. 목차·북마크는 자동이라 비용 없음 |
| T-6 | T4 선택 분야 수·쪽 수 상한 | 분야 1~3개, 본편 12쪽 이내 |
| T-7 | 문서 복수화 UI 위치 | 영업 > 회사소개서 첫 화면에 문서 카드 목록. 발행본 열람(전 직원)은 문서별 |
| T-8 | 서체 세리프 세트 | Noto Serif KR(OFL, TrueType 변환 검증 필요) |

## 5. 구현 로드맵

| 단계 | 내용 | 산출물 | 규모 | 선행 |
|---|---|---|---|---|
| **TP0 기반(코드)** | `templates.ts`·`DocumentTheme.template/motif/areas`·`RenderCtx`·`Sheet` 클래스·모티프 하드코딩 제거·`tokens.json` B·C 값(임시값, TP1 에서 교체)·문서 복수화(목록·새 문서·docId 고정 해제)·발행 options 기록·시험 | PR 1건 | M | 없음 — **바로 착수 가능** |
| **TP1 디자인(claude.ai)** | 템플릿별 대표 쪽 목업 6종×4(표지·간지·KPI·분야 상세·연혁·임원/C20) → 디자인 시스템에 테마 B·C·모티프 2·변형 클래스 추가 → bundle.css 재export → `kesi-catalog.css`·`tokens.json` 갱신 | 아티팩트 2건 갱신 + PR | M | T-1~T-4 결정 |
| **TP2 쪽 변형(코드)** | §3-3 변형 8종 + C20 신규 + 사진 폴백 + 쪽 검사 안내 + AI 윤곽·선택 규칙 보강 | PR 2~3건(front/business/people 단위) | L | TP0, TP1 CSS |
| **TP3 템플릿 프리셋·UI** | 4종 정의(`CATALOG_TEMPLATES`)·새 문서 화면 템플릿 고르기(썸네일 = 표지+간지 미니 렌더)·스튜디오 디자인 탭 모티프 선택·T4 분야 선택 | PR 1건 | M | TP2 |
| **TP4 검증·매뉴얼** | 4종 × 마스킹/실명 × print PDF 생성, 넘침·대비·북마크 검사, 세리프 TrueType 포함 확인, 편집층 호환(문서별) 시험, 매뉴얼 기사(`sales.catalog-*`)·changelog·계획서 기록 | 배포 | S | TP3 |

- TP0 와 TP1 은 병렬. TP0 는 디자인 결정 없이 진행할 수 있다(색 값은 임시).
- **TP0 구현 기록(2026-10-29, 브랜치 `claude/catalog-templates-tp0-b74acf`)**: `lib/catalog/templates.ts`(5종·`templateOf`·`templateVariant`), `DocumentTheme.template/motif/areas` + `sanitizeDocumentTheme`·`pickThemePatch`(template 은 패치에서 제외 = 문서별 고정, `saveDocumentTheme` 은 다른 template 을 보내면 400 `ThemeTemplateLockedError`, 스튜디오 자동 저장은 조용히 무시), `RenderCtx.template/motif` → `Sheet` 루트 `kc-tpl--{id} kc-motif--{motif}`(하드코딩 4곳 제거 — 지도·패널 미리보기는 상위 래퍼의 모티프를 따른다), `buildPagePlan(…, variants, template)` 변형 합치기(`{...템플릿[쪽 유형], ...템플릿[쪽 키], ...PageEdits.variant}`, plan 분기는 TODO), `tokens.json` green·charcoal 임시값(usage 에 표시, 본문 대비 4.5:1 시험), 문서 복수화(`createCatalogDocument`·`GET/POST /api/catalog/documents`, 첫 화면 `CatalogDocumentsPanel` 문서 카드·[새 문서] 모달·`?doc=` 전환, `document-theme`·`render/pdf`·`editions` route 와 `CatalogCoverPicker`·`CatalogRenderPanel`·`CatalogPublishModal`·스튜디오 `?doc=` 의 docId 파라미터), 발행 options 에 `template/motif/areas`, 스튜디오 디자인 탭 모티프 칩, 시험 `tests/catalog-templates.test.ts`(9건), 매뉴얼 `sales.catalog` "문서와 템플릿" 절·도움말 `catalog.documents`·`catalog.studio-motif`. 마이그레이션 없음(jsonb). 반영 대기·알림은 마스터만. 발견: `tokens.json` 에 B·C 값이 canvas·panel·brand·field·on-field 에는 이미 있었고 나머지(accent·ink·rule 등)가 비어 있어 채웠다.
- 배포는 모두 next 이미지만(`staging-deploy-next.ps1 -AcknowledgePinnedScheduleLag -Wait`, ADT·intel 은 618 고정). 세리프 서체 파일을 converter 이미지에 넣으면 converter 재배포(전체 apply 금지·java-common 필수 — 메모리 converter-service).
- 마이그레이션: TP0~TP3 모두 jsonb 안에서 해결되어 **신규 SQL 없음**이 목표. 문서 목록에 썸네일 키를 두려면 `catalog_documents` 컬럼 1개(그때 번호 확인, 10-29 기준 최대 314).

## 6. 리스크

| 리스크 | 대응 |
|---|---|
| 편집층 고아(§1-2) | 문서별 템플릿 고정, 템플릿 변경 금지, 테마만 변경 허용 |
| `kesi-catalog.css` 손수정 금지 규칙 vs 변형 CSS 양 | 디자인 시스템 경유를 원칙으로, TP1 을 TP2 보다 먼저. 임시 보정은 `print-overrides.ts` 의 `.kc-tpl--` 범위로 격리 |
| 사진 부족(T1) | 폴백 변형 + 쪽 검사 안내 + 촬영 목록 |
| claude.ai/design 12-14 종료 | TP1 을 11월 안에. 산출 CSS 는 저장소에 사본으로 남음 |
| 세리프 PDF(Type 3) | TrueType 변환 스크립트 재사용, converter 실측 |
| 쪽 수 증가로 스튜디오 성능 | 문서별 분리라 쪽 수는 문서당 같음 |
| 반영 대기·변경 감지가 문서 수만큼 증가 | 이미 docId 단위. 알림은 마스터만(옵션) |
