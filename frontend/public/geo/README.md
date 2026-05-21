# Korean Administrative Boundaries (TopoJSON)

라운드 2B 의 `RegionMap` 드릴다운 SVG 렌더링에 사용하는 정적 자원.

## 파일

| 파일 | 설명 | 단위 |
|------|------|------|
| `sido.topojson.json`     | 광역시도 17 | `code` (2자리), `name` (정식 명칭) |
| `sigungu.topojson.json`  | 시군구 250+ | `code` (5자리, 앞 2자리 = 시도 code), `name` |

## 출처 / 라이선스

- 출처: [southkorea-maps](https://github.com/southkorea/southkorea-maps) — kostat 2018 simplified topojson
- 원본 라이선스: 통계청(KOSIS) 데이터 + 저장소 공개 (퍼블릭/CC-BY)
- 본 프로젝트 사용 범위: 사내 대시보드 시각화 한정
- 좌표계: WGS84 (`d3.geoMercator`로 투영)

## 키 매칭

- DB `region_sido` 는 `extractRegion()` 정규화 결과 (예: `경기도`, `서울특별시`).
- 비교 시 `shortenSido()` 로 약식 키(`경기`, `서울`)로 변환 후 topojson `name` 도 동일 키로 정규화하여 매칭.
- `region_sigungu` 는 `OO시 / OO군 / OO구` 토큰 그대로 매칭.
