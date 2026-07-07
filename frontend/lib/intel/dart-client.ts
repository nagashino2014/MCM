// DART 전자공시 OpenAPI 래퍼. API & RAG 1차(정형 공시 수집)용.
// 키 발급: https://opendart.fss.or.kr (무료). 환경변수 DART_API_KEY.

// undici 의 fetch + ProxyAgent 를 한 세트로 사용한다. Node 내장 fetch(내장 undici)에 별도 버전
// ProxyAgent 를 dispatcher 로 넘기면 버전 불일치로 무시될 수 있으므로, 동일 undici 로 통일한다.
import { fetch as undiciFetch, ProxyAgent } from "undici";

const DART_BASE = "https://opendart.fss.or.kr/api";

// DART 는 인증키에 등록된 IP 에서만 호출을 허용한다(status 012). 스테이징 ECS 는 태스크마다
// 아웃바운드 IP 가 바뀌므로, DART_HTTPS_PROXY(=bastion squid) 를 경유해 outbound IP 를
// bastion EIP 로 고정한다. 미설정 시(로컬 개발) 직결 — 로컬은 이미 등록된 IP 라 무영향.
const dartProxy = process.env.DART_HTTPS_PROXY;
const dartDispatcher = dartProxy ? new ProxyAgent(dartProxy) : undefined;

function dartFetch(url: string) {
  return undiciFetch(url, {
    ...(dartDispatcher ? { dispatcher: dartDispatcher } : {}),
  });
}

export interface DartDisclosure {
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  reportName: string;
  receiptNo: string; // rcept_no
  filerName: string | null;
  receiptDate: string; // YYYYMMDD
  remark: string | null;
}

function apiKey(): string {
  const k = process.env.DART_API_KEY;
  if (!k) throw new Error("DART_API_KEY가 설정되지 않았습니다.");
  return k;
}

/** 공시검색(list.json). 기간·공시유형으로 조회. status 000=정상, 013=데이터없음. */
export async function listDisclosures(params: {
  bgnDe: string; // YYYYMMDD
  endDe: string; // YYYYMMDD
  pblntfTy?: string; // 공시유형(B=주요사항보고 등). 미지정 시 전체
  pageNo?: number;
  pageCount?: number;
}): Promise<{ disclosures: DartDisclosure[]; totalPage: number; totalCount: number }> {
  const q = new URLSearchParams({
    crtfc_key: apiKey(),
    bgn_de: params.bgnDe,
    end_de: params.endDe,
    page_no: String(params.pageNo ?? 1),
    page_count: String(params.pageCount ?? 100),
  });
  if (params.pblntfTy) q.set("pblntf_ty", params.pblntfTy);

  const res = await dartFetch(`${DART_BASE}/list.json?${q.toString()}`);
  const data = (await res.json()) as Record<string, unknown>;
  const status = String(data.status ?? "");
  if (status === "013") return { disclosures: [], totalPage: 0, totalCount: 0 }; // 조회 결과 없음
  if (status !== "000") throw new Error(`DART list 오류: ${status} ${String(data.message ?? "")}`);

  const list = Array.isArray(data.list) ? (data.list as Record<string, unknown>[]) : [];
  return {
    disclosures: list.map((r) => ({
      corpCode: String(r.corp_code ?? ""),
      corpName: String(r.corp_name ?? ""),
      stockCode: r.stock_code ? String(r.stock_code).trim() || null : null,
      reportName: String(r.report_nm ?? ""),
      receiptNo: String(r.rcept_no ?? ""),
      filerName: r.flr_nm ? String(r.flr_nm) : null,
      receiptDate: String(r.rcept_dt ?? ""),
      remark: r.rm ? String(r.rm) : null,
    })),
    totalPage: Number(data.total_page ?? 1),
    totalCount: Number(data.total_count ?? list.length),
  };
}

/** 기업개황(company.json)에서 사업자등록번호(bizr_no) 조회. 매칭 실패 시 null. */
export async function getCompanyBrn(corpCode: string): Promise<string | null> {
  const q = new URLSearchParams({ crtfc_key: apiKey(), corp_code: corpCode });
  const res = await dartFetch(`${DART_BASE}/company.json?${q.toString()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (String(data.status ?? "") !== "000") return null;
  const brn = data.bizr_no ? String(data.bizr_no).replace(/[^0-9]/g, "") : "";
  return brn || null;
}

/** 공시 원문 뷰어 URL. */
export function disclosureUrl(receiptNo: string): string {
  return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNo}`;
}

/** DS005 유형자산 양수 결정 상세(rcept_no로 후보 공시와 매칭). */
export interface TangibleAssetAcq {
  receiptNo: string;
  assetClass: string | null; // ast_sen (토지/건물/기계장치…)
  assetName: string | null; // ast_nm
  purpose: string | null; // inh_pp (양수목적)
  effect: string | null; // inh_af (양수영향)
  amount: number | null; // inhdtl_inhprc (원)
  counterparty: string | null; // dlptn_cmpnm (거래상대방)
}

const wonToNumber = (v: unknown): number | null => {
  const digits = String(v ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 주요사항보고서 주요정보 - 유형자산 양수 결정(tgastInhDecsn).
 * 회사(corp_code)+기간으로 조회해 rcept_no → 상세 맵을 반환. 무자료(013)/오류 시 빈 맵.
 * 이 상세의 자산구분(ast_sen)·목적(inh_pp)으로 "단순 부지 토지구매" vs "설비 증설"을 판별한다.
 */
export async function getTangibleAssetAcquisitions(
  corpCode: string,
  bgnDe: string,
  endDe: string
): Promise<Map<string, TangibleAssetAcq>> {
  const q = new URLSearchParams({ crtfc_key: apiKey(), corp_code: corpCode, bgn_de: bgnDe, end_de: endDe });
  const map = new Map<string, TangibleAssetAcq>();
  let data: Record<string, unknown>;
  try {
    const res = await dartFetch(`${DART_BASE}/tgastInhDecsn.json?${q.toString()}`);
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return map; // 네트워크 등 일시 오류는 관대하게 무시(후보는 report_nm 폴백 분류)
  }
  if (String(data.status ?? "") !== "000") return map; // 013(무자료) 포함 → 빈 맵
  const list = Array.isArray(data.list) ? (data.list as Record<string, unknown>[]) : [];
  for (const r of list) {
    const receiptNo = String(r.rcept_no ?? "");
    if (!receiptNo) continue;
    map.set(receiptNo, {
      receiptNo,
      assetClass: r.ast_sen ? String(r.ast_sen).trim() || null : null,
      assetName: r.ast_nm ? String(r.ast_nm).trim() || null : null,
      purpose: r.inh_pp ? String(r.inh_pp).trim() || null : null,
      effect: r.inh_af ? String(r.inh_af).trim() || null : null,
      amount: wonToNumber(r.inhdtl_inhprc),
      counterparty: r.dlptn_cmpnm ? String(r.dlptn_cmpnm).trim() || null : null,
    });
  }
  return map;
}
