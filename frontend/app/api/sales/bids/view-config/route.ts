import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { DEFAULT_COLUMNS, getViewColumns, setViewColumns, type ViewColumn } from "@/lib/bid/view-config";
import { listSources } from "@/lib/scraper/sources-store";
import type { BidType } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BID_TYPES: BidType[] = ["order_plan", "prior_spec", "bid_notice"];
const TABLE_BY_TYPE: Record<BidType, string> = {
  order_plan: "public_order_plans",
  prior_spec: "public_prior_specs",
  bid_notice: "public_bid_notices",
};

/**
 * 열 구성 조회 — 저장 구성(없으면 기본) + 열 추가용 후보 필드.
 * 후보 = 표준 컬럼 + 최근 수집 1건의 raw 필드(한글명은 bid 소스 프로파일의 response_fields 에서).
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const bt = req.nextUrl.searchParams.get("bidType") as BidType | null;
    const bidType: BidType = bt && BID_TYPES.includes(bt) ? bt : "bid_notice";
    const saved = await getViewColumns(bidType);
    const columns = saved ?? DEFAULT_COLUMNS[bidType];

    // 후보 필드: 표준 컬럼(항상) + 최근 1건 raw 키
    const candidates: { name: string; nameKo?: string }[] = [
      { name: "org_name", nameKo: "발주기관" },
      { name: "title", nameKo: "사업명" },
      { name: "budget", nameKo: "예산" },
      { name: "posted_at", nameKo: "게시일" },
      { name: "deadline", nameKo: "마감" },
      { name: "method", nameKo: "조달방식" },
      { name: "work_type", nameKo: "업무구분" },
      { name: "category", nameKo: "분류" },
      { name: "url", nameKo: "원문링크" },
      { name: "external_id", nameKo: "공고번호" },
    ];
    const seen = new Set(candidates.map((c) => c.name));
    // 한글명 사전 — bid 소스 프로파일 endpoints[].response_fields
    const koMap = new Map<string, string>();
    try {
      const sources = await listSources("bid");
      for (const s of sources) {
        for (const ep of s.apiProfile?.endpoints ?? []) {
          for (const f of ep.response_fields ?? []) {
            if (f.name && f.name_ko && !koMap.has(f.name)) koMap.set(f.name, f.name_ko);
          }
        }
      }
    } catch {
      // 한글명은 부가 정보
    }
    try {
      const db = await getDb();
      const rows = rowsToObjects(
        await db.exec(`SELECT raw_json FROM ${TABLE_BY_TYPE[bidType]} ORDER BY created_at DESC LIMIT 1`)
      );
      if (rows.length) {
        const raw = typeof rows[0].raw_json === "string" ? JSON.parse(rows[0].raw_json as string) : rows[0].raw_json;
        for (const k of Object.keys((raw as Record<string, unknown>) ?? {})) {
          if (seen.has(k)) continue;
          seen.add(k);
          candidates.push({ name: k, ...(koMap.has(k) ? { nameKo: koMap.get(k) } : {}) });
        }
      }
    } catch {
      // 수집 데이터가 없으면 표준 컬럼만
    }
    return NextResponse.json({ columns, isDefault: !saved, candidates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 열 구성 저장 — { bidType, columns: ViewColumn[] }. 빈 배열이면 기본 열로 복귀. */
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = await req.json().catch(() => ({}));
    const bt = body?.bidType as BidType | undefined;
    if (!bt || !BID_TYPES.includes(bt)) {
      return NextResponse.json({ error: "bidType 이 올바르지 않습니다." }, { status: 400 });
    }
    const columns = Array.isArray(body?.columns) ? (body.columns as ViewColumn[]) : [];
    await setViewColumns(bt, columns, actor.userId);
    const saved = await getViewColumns(bt);
    return NextResponse.json({ columns: saved ?? DEFAULT_COLUMNS[bt], isDefault: !saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
