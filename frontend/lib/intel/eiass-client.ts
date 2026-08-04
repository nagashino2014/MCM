// EIASS(환경영향평가정보지원시스템) 협의진행현황 크롤링 클라이언트. 발주 신호(eiass) 수집용.
// 공식 data.go.kr API는 3~4개월 지연 사본이라 원천 사이트를 직접 조회한다(robots.txt 허용 경로만).
// 리스트: 셸(GET)이 아닌 POST {state*ListData.do} 가 HTML fragment 를 반환(쿠키·세션·CSRF 불필요).
// 상세: POST eiaInfo.do(환경영향평가) / perInfo.do(전략·소규모). 서버가 구형 TLS cipher 라
// Windows curl(schannel)은 실패하지만 undici(node/OpenSSL)는 정상(실측 확인).
// 주의: 리뉴얼 스테이징(eiassrenew) 노출로 사이트 개편 가능성 → 파서는 라벨 텍스트 기준(구조 독립적),
// 수집측은 파싱 0건 시 알람을 남긴다.

import { fetch as undiciFetch, Agent } from "undici";

const BASE = "https://www.eiass.go.kr";

// EIASS 서버는 중간 인증서(Sectigo RSA DV CA)를 내려주지 않아(서버 설정 오류) Linux Node 의
// 번들 CA 로는 체인 검증이 실패한다(로컬 Windows 만 성공, ECS 는 전건 실패 — 2026-07-08 실측).
// 공개 게시판 읽기 전용 크롤링(자격증명·민감정보 없음)이라 이 호스트에 한해 검증을 생략한다.
const eiassDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

// 수집 대상 3종(사전환경성검토는 구제도 아카이브라 제외).
export type EiassKind = "eia" | "sperss" | "mperss";

export const EIASS_KIND_LABELS: Record<EiassKind, string> = {
  eia: "환경영향평가",
  sperss: "전략환경영향평가",
  mperss: "소규모환경영향평가",
};

// kind별 리스트 fragment / 상세 엔드포인트. eia만 컬럼 구성이 다르다(협의기관·단계변경일).
const LIST_PATH: Record<EiassKind, string> = {
  eia: "/partcptn/state/stateEiassListData.do",
  sperss: "/partcptn/state/stateSperssListData.do",
  mperss: "/partcptn/state/stateMperssListData.do",
};
// 사용자 안내용 셸 페이지(상세는 POST 전용이라 딥링크 불가 → 리스트 셸을 url 로 저장).
export const EIASS_LIST_URL: Record<EiassKind, string> = {
  eia: `${BASE}/partcptn/state/stateEiassList.do`,
  sperss: `${BASE}/partcptn/state/stateSperssList.do`,
  mperss: `${BASE}/partcptn/state/stateMperssList.do`,
};

export interface EiassListRow {
  code: string; // 사업코드(예: HG20260394) — external_id
  seq: string; // 상세 조회용 시퀀스
  title: string; // 사업명
  agency: string | null; // 협의기관(eia 리스트만 노출, 나머지는 상세에서)
  dateText: string; // 접수일(sperss/mperss) 또는 단계변경일(eia). "2026.07.03"
  status: string; // 협의진행상태/현재단계(예: 검토서 본안-접수)
}

export interface EiassDetail {
  agency: string | null; // 협의기관(유역·지방환경청 등)
  region: string | null; // 소재지(사업위치 첫 주소)
  bizCategory: string | null; // 사업구분(예: 산업입지및산업단지의 조성)
  operator: string | null; // 사업시행자명
  operatorKind: string | null; // 시행자 구분(공공/민간, perInfo만)
  approver: string | null; // 승인기관명
  scaleText: string | null; // 사업규모 원문(㎡ 등)
  costEokwon: number | null; // 사업비(억원)
  projectPeriod: string | null; // 사업기간 원문(예: "2028. ~ 2030.") — 영업 적기 판단용
  evalAgent: string | null; // 평가대행자/작성자 소속(대행 평가업체 — 경쟁·시장 동향용)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HTML 태그·엔티티 제거 + 공백 정리. */
function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const textOrNull = (s: string): string | null => (s ? s : null);

async function post(path: string, params: Record<string, string>, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
      dispatcher: eiassDispatcher,
    });
    if (!res.ok) throw new Error(`EIASS 응답 오류: ${res.status} ${path}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 협의진행현황 리스트 1페이지(10행 고정). 검색 필터는 사이트 goPage()가 ccilXxx 값을 search_xxx
 * hidden 에 복사해 전송하므로 둘 다 채운다. 정렬은 내부 수정일시 역순 고정(파라미터 없음).
 */
export async function fetchEiassList(
  kind: EiassKind,
  page: number
): Promise<{ total: number; rows: EiassListRow[] }> {
  const html = await post(LIST_PATH[kind], {
    currentPage: String(page),
    search_step1: "", search_step2: "", search_organ: "", search_biz: "",
    ccilStep1Code: "", ccilStep2Code: "", ccilOrganCode: "", search_value: "",
  });

  const total = Number((html.match(/검색결과\s*:\s*([\d,]+)건/)?.[1] ?? "0").replace(/,/g, ""));

  // 행 앵커: <a href="javascript:view('CODE', 'SEQ');" id="view_CODE_SEQ">사업명</a>
  // 행 단위로 잘라 같은 <tr> 안의 data-cell-header 셀(접수일/단계/상태)을 함께 파싱한다.
  const rows: EiassListRow[] = [];
  for (const tr of html.split(/<tr>/).slice(1)) {
    const link = tr.match(/view\('([^']+)'\s*,\s*'([^']+)'\);"\s*id="view_[^"]+"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const cell = (label: string): string => {
      const m = tr.match(new RegExp(`data-cell-header="${label}[^"]*"[^>]*>([\\s\\S]*?)</td>`));
      return clean(m?.[1]);
    };
    const agencyM = tr.match(/data-cell-header="협의기관[^"]*"[^>]*title="([^"]*)"/);
    rows.push({
      code: link[1],
      seq: link[2],
      title: clean(link[3]),
      agency: textOrNull(clean(agencyM?.[1])),
      dateText: cell("접수일") || cell("단계변경일"),
      status: cell("협의진행상태") || cell("현재단계"),
    });
  }
  return { total, rows };
}

/** 라벨 셀 다음 <td> 의 텍스트(단순 값 필드용). */
function fieldAfter(html: string, label: string): string | null {
  const m = html.match(new RegExp(`>${label}(?:<br\\s*/?>[^<]*)?</(?:td|th)>\\s*<td[^>]*>([\\s\\S]*?)</td>`));
  return m ? textOrNull(clean(m[1])) : null;
}

/** 라벨 이후 window 범위에서 내부 라벨(예: 사업시행자명)의 값(중첩 테이블 필드용). */
function nestedField(html: string, outerLabel: string, innerLabel: string): string | null {
  const i = html.indexOf(`>${outerLabel}</td>`);
  if (i < 0) return null;
  const scope = html.slice(i, i + 3000);
  const m = scope.match(new RegExp(`>${innerLabel}</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`));
  return m ? textOrNull(clean(m[1])) : null;
}

/**
 * 상세 조회. eia 는 eiaInfo.do(단순 td 값), sperss/mperss 는 perInfo.do(사업시행자·승인기관이
 * 중첩 테이블) — 두 형태를 모두 시도해 채운다. 파싱은 라벨 텍스트 기준이라 마크업 변화에 관대.
 */
export async function fetchEiassDetail(kind: EiassKind, code: string, seq: string): Promise<EiassDetail> {
  const html =
    kind === "eia"
      ? await post("/biz/base/info/eiaInfo.do", { EIA_CD: code, EIA_DISC_SEQ: seq })
      : await post("/biz/base/info/perInfo.do", { PER_CD: code, REVIRPT_SEQ: seq });

  // 협의기관: 업무담당자정보 표의 첫 값
  const agency = (() => {
    const m = html.match(/>협의기관<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
    return m ? textOrNull(clean(m[1])) : null;
  })();

  // 소재지: 사업위치 표의 첫 데이터 셀
  const region = (() => {
    const i = html.indexOf(">소재지</th>");
    if (i < 0) return null;
    const m = html.slice(i).match(/<tbody>\s*<tr>\s*<td[^>]*>([\s\S]*?)<\/td>/);
    return m ? textOrNull(clean(m[1])) : null;
  })();

  // 사업시행자/승인기관: eia=단순 td, per=중첩 테이블(…명 라벨)
  const operator = nestedField(html, "사업시행자", "사업시행자명") ?? fieldAfter(html, "사업시행자");
  const operatorKind = nestedField(html, "사업시행자", "구분");
  const approver = nestedField(html, "승인기관", "승인기관명") ?? fieldAfter(html, "승인기관");

  const costText = fieldAfter(html, "사업비");
  const cost = costText ? Number(costText.replace(/[^0-9.]/g, "")) : NaN;

  // 평가대행자: eia="평가대행자정보" 필드 / per=작성자 정보의 소속(본안 우선)
  const evalAgent =
    fieldAfter(html, "평가대행자정보") ??
    (() => {
      const m = html.match(/작성자 정보[\s\S]{0,1500}?>소속<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
      return m ? textOrNull(clean(m[1])) : null;
    })();

  // 사업규모: 규모 표(eia, 여러 행이면 첫 행) 우선 — 단순 td 폴백(per). 순서가 반대면 표 caption 이 섞인다.
  const scaleText =
    (() => {
      const i = html.indexOf(">사업규모</td>");
      if (i < 0) return null;
      const m = html.slice(i, i + 2000).match(/>규모<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/);
      return m ? textOrNull(clean(m[1])) : null;
    })() ?? fieldAfter(html, "사업규모");

  return {
    agency,
    region,
    bizCategory: fieldAfter(html, "사업구분"),
    operator,
    operatorKind,
    approver,
    scaleText,
    costEokwon: Number.isFinite(cost) && cost > 0 ? cost : null,
    projectPeriod: fieldAfter(html, "사업기간"),
    evalAgent,
  };
}

export { sleep as eiassSleep };
