/**
 * 한국 행정구역 광역시도 추출 유틸.
 * - cli-collect 적재 / 수동 등록 / 검수 sync 모두에서 site_address 텍스트로부터
 *   region_sido / region_sigungu 컬럼을 채우기 위해 사용한다.
 * - 라운드 2B 의 구글 맵스 광역/시군구 드릴다운 지도가 이 컬럼을 기반으로 동작.
 *
 * 광역시도는 공식 명칭 + 약식 모두 매칭한다 (예: "서울특별시" / "서울").
 *
 * 매칭 정책:
 * - 주소 원본의 공백 유무에 영향받지 않도록 모든 비교는 공백 제거된(compact) 문자열에서 수행.
 * - 시군구는 KOSTAT 2018 시군구 목록(공식)을 기준으로 한 사전 매칭 — 사전에 등록된
 *   명칭만 매치되므로 "OO시" 토큰이 주소 끝에 다시 등장해 잘못 잡히는 등의 오탐도 회피.
 * - 일반시 + 하위 자치구 합성형(수원시장안구·고양시덕양구·포항시남구 등)은 별도 엔트리로
 *   등록하되 `primary` 는 시 단위(수원시·고양시·포항시)로 반환 — DB region_sigungu 정책 일치.
 */

export const SIDO_LIST: { full: string; short: string }[] = [
  { full: "서울특별시", short: "서울" },
  { full: "부산광역시", short: "부산" },
  { full: "대구광역시", short: "대구" },
  { full: "인천광역시", short: "인천" },
  { full: "광주광역시", short: "광주" },
  { full: "대전광역시", short: "대전" },
  { full: "울산광역시", short: "울산" },
  { full: "세종특별자치시", short: "세종" },
  { full: "경기도", short: "경기" },
  { full: "강원특별자치도", short: "강원" },
  { full: "강원도", short: "강원" },
  { full: "충청북도", short: "충북" },
  { full: "충청남도", short: "충남" },
  { full: "전북특별자치도", short: "전북" },
  { full: "전라북도", short: "전북" },
  { full: "전라남도", short: "전남" },
  { full: "경상북도", short: "경북" },
  { full: "경상남도", short: "경남" },
  { full: "제주특별자치도", short: "제주" },
];

export interface RegionParts {
  sido: string | null;
  sigungu: string | null;
}

/**
 * 시군구 entry — full 은 주소 검색에 쓰이는 풀 명칭(합성형 포함, 공백 제거 형태),
 * primary 는 DB region_sigungu 에 저장될 정규화 값(합성형은 시 단위).
 */
interface SigunguEntry {
  primary: string;
  full: string;
}

const _e = (name: string): SigunguEntry => ({ primary: name, full: name });

/**
 * 시도 short 키 기반 시군구 사전 (KOSTAT 2018 행정구역, 250+ 시군구).
 * - 강원/전북 의 경우 강원도·강원특별자치도, 전라북도·전북특별자치도 가 동일 short 로 통합되므로
 *   하나의 키만 유지하면 됨.
 * - 세종특별자치시는 단층 행정구역이지만 topojson 시군구 레이어의 `세종시` 단일 영역에
 *   매칭되도록 추출 단계에서 `세종시` 로 보정한다.
 */
export const SIGUNGU_BY_SIDO_SHORT: Record<string, SigunguEntry[]> = {
  서울: [
    _e("강남구"), _e("강동구"), _e("강북구"), _e("강서구"), _e("관악구"),
    _e("광진구"), _e("구로구"), _e("금천구"), _e("노원구"), _e("도봉구"),
    _e("동대문구"), _e("동작구"), _e("마포구"), _e("서대문구"), _e("서초구"),
    _e("성동구"), _e("성북구"), _e("송파구"), _e("양천구"), _e("영등포구"),
    _e("용산구"), _e("은평구"), _e("종로구"), _e("중구"), _e("중랑구"),
  ],
  부산: [
    _e("강서구"), _e("금정구"), _e("기장군"), _e("남구"), _e("동구"),
    _e("동래구"), _e("부산진구"), _e("북구"), _e("사상구"), _e("사하구"),
    _e("서구"), _e("수영구"), _e("연제구"), _e("영도구"), _e("중구"), _e("해운대구"),
  ],
  대구: [
    _e("남구"), _e("달서구"), _e("달성군"), _e("동구"),
    _e("북구"), _e("서구"), _e("수성구"), _e("중구"),
  ],
  인천: [
    _e("강화군"), _e("계양구"), _e("남구"), _e("남동구"), _e("동구"),
    _e("부평구"), _e("서구"), _e("연수구"), _e("옹진군"), _e("중구"),
  ],
  광주: [_e("광산구"), _e("남구"), _e("동구"), _e("북구"), _e("서구")],
  대전: [_e("대덕구"), _e("동구"), _e("서구"), _e("유성구"), _e("중구")],
  울산: [_e("남구"), _e("동구"), _e("북구"), _e("울주군"), _e("중구")],
  세종: [_e("세종시")],
  경기: [
    _e("가평군"),
    { primary: "고양시", full: "고양시덕양구" },
    { primary: "고양시", full: "고양시일산동구" },
    { primary: "고양시", full: "고양시일산서구" },
    _e("과천시"), _e("광명시"), _e("광주시"), _e("구리시"), _e("군포시"),
    _e("김포시"), _e("남양주시"), _e("동두천시"), _e("부천시"),
    { primary: "성남시", full: "성남시분당구" },
    { primary: "성남시", full: "성남시수정구" },
    { primary: "성남시", full: "성남시중원구" },
    { primary: "수원시", full: "수원시권선구" },
    { primary: "수원시", full: "수원시영통구" },
    { primary: "수원시", full: "수원시장안구" },
    { primary: "수원시", full: "수원시팔달구" },
    _e("시흥시"),
    { primary: "안산시", full: "안산시단원구" },
    { primary: "안산시", full: "안산시상록구" },
    _e("안성시"),
    { primary: "안양시", full: "안양시동안구" },
    { primary: "안양시", full: "안양시만안구" },
    _e("양주시"), _e("양평군"), _e("여주시"), _e("연천군"), _e("오산시"),
    { primary: "용인시", full: "용인시기흥구" },
    { primary: "용인시", full: "용인시수지구" },
    { primary: "용인시", full: "용인시처인구" },
    _e("의왕시"), _e("의정부시"), _e("이천시"), _e("파주시"),
    _e("평택시"), _e("포천시"), _e("하남시"), _e("화성시"),
  ],
  강원: [
    _e("강릉시"), _e("고성군"), _e("동해시"), _e("삼척시"), _e("속초시"),
    _e("양구군"), _e("양양군"), _e("영월군"), _e("원주시"), _e("인제군"),
    _e("정선군"), _e("철원군"), _e("춘천시"), _e("태백시"), _e("평창군"),
    _e("홍천군"), _e("화천군"), _e("횡성군"),
  ],
  충북: [
    _e("괴산군"), _e("단양군"), _e("보은군"), _e("영동군"), _e("옥천군"),
    _e("음성군"), _e("제천시"), _e("증평군"), _e("진천군"),
    { primary: "청주시", full: "청주시상당구" },
    { primary: "청주시", full: "청주시서원구" },
    { primary: "청주시", full: "청주시청원구" },
    { primary: "청주시", full: "청주시흥덕구" },
    _e("충주시"),
  ],
  충남: [
    _e("계룡시"), _e("공주시"), _e("금산군"), _e("논산시"), _e("당진시"),
    _e("보령시"), _e("부여군"), _e("서산시"), _e("서천군"), _e("아산시"),
    _e("예산군"),
    { primary: "천안시", full: "천안시동남구" },
    { primary: "천안시", full: "천안시서북구" },
    _e("청양군"), _e("태안군"), _e("홍성군"),
  ],
  전북: [
    _e("고창군"), _e("군산시"), _e("김제시"), _e("남원시"), _e("무주군"),
    _e("부안군"), _e("순창군"), _e("완주군"), _e("익산시"), _e("임실군"),
    _e("장수군"),
    { primary: "전주시", full: "전주시덕진구" },
    { primary: "전주시", full: "전주시완산구" },
    _e("정읍시"), _e("진안군"),
  ],
  전남: [
    _e("강진군"), _e("고흥군"), _e("곡성군"), _e("광양시"), _e("구례군"),
    _e("나주시"), _e("담양군"), _e("목포시"), _e("무안군"), _e("보성군"),
    _e("순천시"), _e("신안군"), _e("여수시"), _e("영광군"), _e("영암군"),
    _e("완도군"), _e("장성군"), _e("장흥군"), _e("진도군"), _e("함평군"),
    _e("해남군"), _e("화순군"),
  ],
  경북: [
    _e("경산시"), _e("경주시"), _e("고령군"), _e("구미시"), _e("군위군"),
    _e("김천시"), _e("문경시"), _e("봉화군"), _e("상주시"), _e("성주군"),
    _e("안동시"), _e("영덕군"), _e("영양군"), _e("영주시"), _e("영천시"),
    _e("예천군"), _e("울릉군"), _e("울진군"), _e("의성군"), _e("청도군"),
    _e("청송군"), _e("칠곡군"),
    { primary: "포항시", full: "포항시남구" },
    { primary: "포항시", full: "포항시북구" },
  ],
  경남: [
    _e("거제시"), _e("거창군"), _e("고성군"), _e("김해시"), _e("남해군"),
    _e("밀양시"), _e("사천시"), _e("산청군"), _e("양산시"), _e("의령군"),
    _e("진주시"), _e("창녕군"),
    { primary: "창원시", full: "창원시마산합포구" },
    { primary: "창원시", full: "창원시마산회원구" },
    { primary: "창원시", full: "창원시성산구" },
    { primary: "창원시", full: "창원시의창구" },
    { primary: "창원시", full: "창원시진해구" },
    _e("통영시"), _e("하동군"), _e("함안군"), _e("함양군"), _e("합천군"),
  ],
  제주: [_e("서귀포시"), _e("제주시")],
};

/**
 * 광역시도 약식 명칭으로 정규화 (예: "서울특별시" → "서울").
 * 지도 드릴다운 키 매칭용.
 */
export function shortenSido(sido: string | null | undefined): string | null {
  if (!sido) return null;
  for (const s of SIDO_LIST) {
    if (s.full === sido || s.short === sido) return s.short;
  }
  return sido;
}

/**
 * 주소 문자열에서 광역시도 / 시군구를 추출한다.
 * - 매칭이 실패하면 null 을 돌려준다.
 * - sido 는 정규화된 공식 명칭(서울특별시, 경기도 ...)으로 반환.
 * - sigungu 는 sido 다음에 등장하는 시군구 사전 매칭 결과를 primary 형식(시 단위)으로 반환.
 *
 * 매칭 절차:
 *   1) 입력 주소의 모든 공백을 제거한 compact 문자열을 만든다 (DB 일부 주소가 공백 압축 형태로
 *      저장되어 있어도 동일하게 처리하기 위함).
 *   2) compact 에서 SIDO_LIST 의 full → short 순으로 시도를 찾는다 (short 는 뒤에 한글이
 *      이어지지 않아야 — 예: "서울" 뒤에 "특별시"가 아니어야 — 해서 풀네임에 흡수되는 것 회피).
 *   3) 시도 매칭 위치 이후의 remainder 에서 해당 시도(short 기준)의 시군구 사전 항목을
 *      indexOf 매칭하여 가장 앞에 등장하는 항목을 채택. 동일 위치에서 여러 항목이 매치되면
 *      더 긴 명칭(합성형)을 우선 적용해 시 + 자치구 합성형이 단순 시명에 묻히지 않게 한다.
 */
export function extractRegion(address: string | null | undefined): RegionParts {
  if (!address) return { sido: null, sigungu: null };
  const compact = address.replace(/\s+/g, "");
  if (!compact) return { sido: null, sigungu: null };

  let matchedSido: { full: string; short: string } | null = null;
  let sidoEnd = -1;

  for (const s of SIDO_LIST) {
    const idx = compact.indexOf(s.full);
    if (idx >= 0) {
      matchedSido = s;
      sidoEnd = idx + s.full.length;
      break;
    }
  }
  if (!matchedSido) {
    for (const s of SIDO_LIST) {
      const idx = compact.indexOf(s.short);
      if (idx < 0) continue;
      // 풀네임("서울특별시")의 잔여 부분("특별시")이 직후에 그대로 이어지면 풀네임의 일부로
      // 보고 건너뛴다. 그렇지 않으면 약식("서울 강남구")으로 채택. 풀네임 매치가 위에서
      // 이미 시도되었으므로 이 단계까지 도달했다는 것은 그 풀네임 자체로는 매치 실패했다는 뜻.
      const tail = s.full.slice(s.short.length);
      if (tail && compact.startsWith(tail, idx + s.short.length)) continue;
      matchedSido = s;
      sidoEnd = idx + s.short.length;
      break;
    }
  }

  if (!matchedSido) return { sido: null, sigungu: null };

  if (matchedSido.short === "세종") {
    return { sido: matchedSido.full, sigungu: "세종시" };
  }

  const remainder = compact.slice(sidoEnd);
  const candidates = SIGUNGU_BY_SIDO_SHORT[matchedSido.short] ?? [];
  let best: { idx: number; entry: SigunguEntry } | null = null;
  for (const e of candidates) {
    const idx = remainder.indexOf(e.full);
    if (idx < 0) continue;
    if (
      best === null ||
      idx < best.idx ||
      (idx === best.idx && e.full.length > best.entry.full.length)
    ) {
      best = { idx, entry: e };
    }
  }

  return {
    sido: matchedSido.full,
    sigungu: best ? best.entry.primary : null,
  };
}
