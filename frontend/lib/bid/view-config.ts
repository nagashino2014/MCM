/**
 * 공공입찰 목록 커스텀 열 구성(076 bid_view_configs).
 * 열 = raw_json 필드/표준 컬럼을 조합(single|join|calc)해 하나의 셀로 표시.
 * 서버(bids route)가 행마다 cells 를 계산해 내려주고, BidBoard 는 columns+cells 로 동적 렌더한다.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getNestedValue } from "@/lib/scraper/execute-api";
import type { BidType } from "@/lib/scraper/types";

export interface ViewColumn {
  label: string;
  /** raw_json 필드명(점 경로) 또는 표준 컬럼명(org_name/title/budget/posted_at/deadline/method/work_type/category/url/external_id). */
  parts: string[];
  /** single=첫 값, join=구분자 결합(발주년도/발주월 등), calc=사칙연산(숫자). */
  mode: "single" | "join" | "calc";
  /** join 구분자(기본 ", "). */
  sep?: string;
  /** calc 연산자. */
  op?: "+" | "-" | "*" | "/";
  /** 렌더 형식 — money(억/만), date(앞 16자리), link(새 탭), text. */
  format?: "text" | "money" | "date" | "link";
  /** 헤더 클릭 정렬 허용(날짜/금액/목록형 열). 정렬 기준은 parts[0]. */
  sortable?: boolean;
}

/** 구성이 없을 때의 기본 열 — 기존 고정 컬럼과 동일. */
export const DEFAULT_COLUMNS: Record<BidType, ViewColumn[]> = {
  order_plan: [
    { label: "발주기관", parts: ["org_name"], mode: "single", sortable: true },
    { label: "사업명", parts: ["title"], mode: "single" },
    { label: "예산", parts: ["budget"], mode: "single", format: "money", sortable: true },
    { label: "게시일", parts: ["posted_at"], mode: "single", format: "date", sortable: true },
    { label: "발주시기", parts: ["orderYear", "orderMnth"], mode: "join", sep: "/", sortable: true },
    { label: "조달방식", parts: ["method"], mode: "single", sortable: true },
  ],
  prior_spec: [
    { label: "발주기관", parts: ["org_name"], mode: "single", sortable: true },
    { label: "사업명", parts: ["title"], mode: "single" },
    { label: "예산", parts: ["budget"], mode: "single", format: "money", sortable: true },
    { label: "게시일", parts: ["posted_at"], mode: "single", format: "date", sortable: true },
    { label: "마감", parts: ["deadline"], mode: "single", format: "date", sortable: true },
    { label: "조달방식", parts: ["method"], mode: "single", sortable: true },
    { label: "원문", parts: ["url"], mode: "single", format: "link" },
  ],
  bid_notice: [
    { label: "발주기관", parts: ["org_name"], mode: "single", sortable: true },
    { label: "사업명", parts: ["title"], mode: "single" },
    { label: "예산", parts: ["budget"], mode: "single", format: "money", sortable: true },
    { label: "게시일", parts: ["posted_at"], mode: "single", format: "date", sortable: true },
    { label: "마감", parts: ["deadline"], mode: "single", format: "date", sortable: true },
    { label: "조달방식", parts: ["method"], mode: "single", sortable: true },
    { label: "원문", parts: ["url"], mode: "single", format: "link" },
  ],
};

function sanitizeColumns(v: unknown): ViewColumn[] {
  if (!Array.isArray(v)) return [];
  const out: ViewColumn[] = [];
  for (const c of v) {
    if (!c || typeof c !== "object") continue;
    const col = c as ViewColumn;
    if (typeof col.label !== "string" || !col.label.trim()) continue;
    const parts = Array.isArray(col.parts) ? col.parts.map(String).filter(Boolean).slice(0, 5) : [];
    if (!parts.length) continue;
    out.push({
      label: col.label.trim().slice(0, 30),
      parts,
      mode: col.mode === "join" || col.mode === "calc" ? col.mode : "single",
      ...(col.sep != null ? { sep: String(col.sep).slice(0, 5) } : {}),
      ...(col.op === "+" || col.op === "-" || col.op === "*" || col.op === "/" ? { op: col.op } : {}),
      ...(col.format === "money" || col.format === "date" || col.format === "link" ? { format: col.format } : {}),
      ...(col.sortable ? { sortable: true } : {}),
    });
    if (out.length >= 12) break; // 열 수 상한
  }
  return out;
}

/** 저장된 구성(없으면 null — 호출측이 DEFAULT_COLUMNS 사용). */
export async function getViewColumns(bidType: BidType): Promise<ViewColumn[] | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT columns FROM bid_view_configs WHERE bid_type = $1", [bidType])
  );
  if (!rows.length) return null;
  const raw = rows[0].columns;
  const cols = sanitizeColumns(typeof raw === "string" ? JSON.parse(raw) : raw);
  return cols.length ? cols : null;
}

/** 구성 저장(빈 배열이면 삭제 = 기본 열로 복귀). */
export async function setViewColumns(bidType: BidType, columns: ViewColumn[], updatedBy: string | null): Promise<void> {
  const cols = sanitizeColumns(columns);
  await withDbWrite(async (db) => {
    if (!cols.length) {
      await db.run("DELETE FROM bid_view_configs WHERE bid_type = $1", [bidType]);
      return;
    }
    await db.run(
      `INSERT INTO bid_view_configs (bid_type, columns, updated_at, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (bid_type) DO UPDATE SET columns = EXCLUDED.columns, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [bidType, JSON.stringify(cols), new Date().toISOString(), updatedBy]
    );
  });
}

const toNum = (v: unknown): number => {
  const s = String(v ?? "").replace(/[^0-9.\-]/g, "");
  return s ? Number(s) : NaN; // 비숫자 문자열이 0 으로 연산에 섞이지 않게
};

/** 표준 컬럼+raw_json 병합 객체에서 열 값을 계산한다(문자열 — 렌더 형식은 클라이언트). */
export function computeCell(merged: Record<string, unknown>, col: ViewColumn): string | null {
  const vals = col.parts.map((p) => {
    const v = getNestedValue(merged, p);
    return v == null || v === "" ? null : String(v);
  });
  if (col.mode === "calc") {
    const nums = vals.map((v) => (v == null ? NaN : toNum(v)));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    const r = nums.reduce((a, b, i) => {
      if (i === 0) return b;
      switch (col.op) {
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b !== 0 ? a / b : NaN;
        default: return a + b;
      }
    }, 0);
    if (!Number.isFinite(r)) return null;
    return String(Math.round(r * 100) / 100);
  }
  const nonNull = vals.filter((v): v is string => v != null);
  if (!nonNull.length) return null;
  if (col.mode === "join") return nonNull.join(col.sep ?? ", ");
  return nonNull[0];
}
