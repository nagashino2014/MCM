# 회사소개서 스톡 일러스트 매처

회사가 가진 Adobe Stock·자체 제작 일러스트(.ai·.eps·.svg·.pdf)를 대지·그림 단위로 나눠 변환합니다.
그다음 인포그래픽 16유형으로 판정하고, 회사소개서 쪽(`catalog_items.json`)마다 맞는 후보를 추천하는 독립 파이프라인입니다.
필요한 것은 Python 3.11+ 표준 라이브러리, poppler 24(`AM_POPPLER_BIN`, 기본 `C:\poppler\poppler-24.08.0\Library\bin`),
PDF 호환이 꺼진 AI 를 위한 Illustrator 2026(COM)입니다.

```powershell
$W = "<작업 폴더>"
python -I scripts\catalog_assets\asset_matcher.py all --src "V:\업무자료\홈페이지&브로슈어 관리\디자인, 아이콘 파일" --recursive --work $W --stock $W\stock_candidates.json
# 단계별: ingest → convert → analyze → match → report. 새로 산 에셋(하위 폴더 포함)은 바뀐 파일만 복사하고, analyze --only <slug…> 로 그것만 분석한다
python -I scripts\catalog_assets\asset_matcher.py recolor $W\assets\<slug>\ab01\r1\region.svg --palette area --strip-text --out out.svg
```

## 단계
| 단계 | 하는 일 | 산출 |
|---|---|---|
| ingest | 파일마다 `_inputs/<slug>/src.<ext>` 로 따로 복사(신뢰하지 않는 데이터 격리), 머리 바이트로 형식 판정 | `manifest.json` |
| convert | PDF 호환 AI 는 그대로, EPS 형식 AI·SVG 는 Illustrator COM(`ai_to_pdf.ps1`→`ai_to_pdf.jsx`)으로 대지별 쪽 PDF 저장 → poppler 로 쪽 SVG·썸네일·글자 bbox | `pdf/`, `assets/<slug>/abNN/page.svg` |
| analyze | 저해상 래스터로 배경을 걷고 그림 영역을 나눔(글자만 있는 조각은 가까운 그림에 합침) → 영역마다 벡터 도형·래스터 색 덩어리로 반복·배치·중심·화살표·글자 자리·색·평면성 특징 → 16유형 점수 | `analysis.json`, `abNN/rK/region.svg·print.png·thumb.png·slots.json` |
| match | `review.json`(시각 판정)으로 덮어쓴 뒤 항목별 적합도 | `matches.json` |
| report | 항목별 상위 후보 + 재채색 미리보기 + 구매 후보 + 전체 접촉 시트 | `report.html`, `report_artifact.html`, `recolor/` |

## 시각 판정(review.json)
자동 판정은 휴리스틱이라 틀릴 수 있습니다. 썸네일을 보고 `<작업>/review.json` 에 덮어씁니다.
```json
{"as-123/ab01/r1": {"type": "Hub", "count": 5, "center": true, "quality": 4, "note": "중심 원 + 5갈래"},
 "kesi-logo-ai-8b8b49": {"exclude": true, "note": "로고"}}
```
키는 영역 id 또는 slug(파일 전체)입니다. `quality`는 1~5, `exclude`는 인포그래픽이 아님을 뜻합니다. `alt`·`loop`도 덮어쓸 수 있습니다.

## 재채색
유채색을 색상별로 묶어 팔레트(`ci` 네이비·블루·그린…, `area` 분야 6색, `mono` 네이비)에 배정하고 명암 차이는 유지합니다.
무채색은 흰색이면 그대로 두고, 아주 어두우면 네이비, 그 밖은 CI 회색 단계로 바꿉니다. `--map "#e94e3c=area-2"` 로 직접 지정할 수 있습니다.
필터·클립 안은 건드리지 않습니다. cairo 마스크는 알파만 쓰므로 색을 바꿔도 투명도는 그대로입니다. 그림자·흐림이 이미지로 굳은 부분은 바뀌지 않습니다.
`--strip-text` 는 살아 있는 글자(글리프)만 지웁니다. 윤곽선으로 바뀐 글자는 도형이라 Illustrator 에서 지웁니다. 숫자·글자는 HTML 로 덧씌우고, 자리 좌표는 `slots.json` 에 있습니다.
`report` 는 항목별 상위 후보를 재채색하고 Edge 헤드리스(`AM_EDGE`)로 PNG 미리보기를 굽습니다(`recolor/index.json` 캐시, `--force-recolor` 로 다시).

## 앱으로 내보내기(export) — 회사소개서 일러스트 라이브러리
판정을 마친 영역을 회사소개서 앱의 **일러스트 라이브러리**(관리 화면 `/sales/catalog/illustrations`)에 올릴 묶음으로 만듭니다.
```powershell
python -I scripts\catalog_assets\asset_matcher.py export --work $W --out $W\bundle                       # review.json 품질 3 이상 전부
python -I scripts\catalog_assets\asset_matcher.py export --work $W --out $W\bundle --only as-1998385985/ab01/r2
```
- 벡터는 **Illustrator SVG**(`ai_to_svg.jsx`, 대지별)에서 다시 만듭니다. pdftocairo SVG 는 투명·혼합을 필터 합성 체인으로 그려 PDF 에서 래스터로 굳기 때문입니다.
- 글자 레이어(Text·Title…)를 지우기 전에 글자 덩어리마다 상자·줄 수·크기·정렬·색을 재서 `slots`(역할 title·sub·desc·number·center·heading + 항목 순번)를 만듭니다.
  회색 막대로 그린 설명 자리 표시(lorem 대신)도 설명 자리로 바꾸고 지웁니다. 배경·템플릿 이름 레이어(Background·Name·Logo)·판 배경도 지웁니다.
- 평면화: 래스터 이미지와 필터·마스크를 쓰는 요소(그림자·흐림)를 지웁니다(`--keep-effects` 로 남김). 디자인 시스템은 그림자를 쓰지 않습니다.
- 색 값마다 `var(--il-cN, #원래색)` 으로 바꾸고 팔레트(쓰임 순, 색상 무리, 무리 안 밝기 차)를 meta.json 에 남깁니다. 앱은 변수만 바꿔 KESI 토큰·분야 색으로 칠합니다.
- 글자 그룹은 깊이에 관계없이 찾습니다(`Text`·`Title` 등, 그리고 `Place_for_Number`·`Number` 는 번호 자리로 고정). 스톡은 글자가 항목 그룹 안에 들어 있는 경우가 많습니다.
  같은 칸의 제목·설명이 다른 그룹에 있으면 세로로 붙은 덩어리를 한 항목으로 합칩니다. 번호 그룹에서는 숫자 글자만 지우고 탭·원 같은 바탕은 그림으로 남깁니다.
- 항목별 색(`tints`): 유채색 도형마다 가장 가까운 항목 글자 자리에 배정해 `var(--il-i{항목}{밝기}, …)` 로 감쌉니다(둘째 후보와 확실히 구분될 때만).
  방사형(허브·순환·협력)은 그림 중심 기준 각도로 잽니다. `AM_DEBUG=1` 로 영역마다 배정 요약, `AM_DEBUG=2` 로 도형별 각도를 봅니다.
- `review.json` 에 더 쓸 수 있는 키: `title`(이름), `crop`(영역 안 비율 상자 [x0,y0,x1,y1] — 장식만 있는 가장자리 덜기),
  `drop_boxes`(원래 영역 비율 상자 목록 — 중심이 그 안에 있는 도형을 지움), `text_layers`·`drop_layers`·`keep_layers`(레이어 이름), `keep_effects`.
  영역 밖으로 절반 넘게 나간 도형(옆 슬라이드·배경 장식의 잘린 조각)은 자동으로 지웁니다. 중심 없이 네 귀퉁이에 놓인 4항목은 읽기 순서로 번호를 매깁니다.
- 산출: `<out>/<영역 키>/illust.svg·thumb.png·meta.json`, `<out>/index.json`. 관리 화면 [묶음 폴더 가져오기]에서 `<out>` 폴더를 고릅니다.
  구입한 스톡 원본·묶음은 저작물이라 저장소에 넣지 않습니다(앱 저장소에는 정리한 SVG 만 올라가고 라이선스를 함께 기록합니다).

## 한계
- 윤곽선으로 바뀐 글자는 내용을 읽지 못해(줄 단위 자리만) 연도·번호 단서는 살아 있는 글자에만 쓰입니다.
- 한 대지에 여러 그림이 붙어 있으면 한 영역으로 묶일 수 있습니다. 반대로 멀리 떨어진 요소는 나뉠 수 있습니다.
- Illustrator 효과(그림자·흐림·투명 그룹)는 PDF 에서 이미지·필터로 굳어 벡터 분석과 재채색이 제한됩니다.
