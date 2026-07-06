// DART 전자공시 OpenAPI 래퍼. API & RAG 1차(정형 공시 수집)용.
// 키 발급: https://opendart.fss.or.kr (무료). 환경변수 DART_API_KEY.

const DART_BASE = "https://opendart.fss.or.kr/api";

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

  const res = await fetch(`${DART_BASE}/list.json?${q.toString()}`, { cache: "no-store" });
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
  const res = await fetch(`${DART_BASE}/company.json?${q.toString()}`, { cache: "no-store" });
  const data = (await res.json()) as Record<string, unknown>;
  if (String(data.status ?? "") !== "000") return null;
  const brn = data.bizr_no ? String(data.bizr_no).replace(/[^0-9]/g, "") : "";
  return brn || null;
}

/** 공시 원문 뷰어 URL. */
export function disclosureUrl(receiptNo: string): string {
  return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNo}`;
}
