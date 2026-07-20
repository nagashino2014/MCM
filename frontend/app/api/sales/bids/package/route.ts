import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getBid } from "@/lib/bid/bid-queries";
import type { BidType } from "@/lib/scraper/types";
import { getFormByOrg, getFormById, getPackage, savePackage, type StaffConfig } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BID_TYPES = new Set(["order_plan", "prior_spec", "bid_notice"]);

// GET: 입찰 서류 생성 페이지 초기 데이터 — 공고 요약 + 패키지 작업 상태 + 발주처 기본 양식
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const bidType = String(sp.get("bidType") ?? "");
    const bidId = String(sp.get("bidId") ?? "");
    if (!BID_TYPES.has(bidType) || !bidId) {
      return NextResponse.json({ error: "bidType/bidId 파라미터가 필요합니다." }, { status: 400 });
    }
    const bid = await getBid(bidType as BidType, bidId);
    if (!bid) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }
    const pkg = await getPackage(bidType, bidId);
    // 사용 양식: 패키지에 지정된 양식 우선, 없으면 발주처(org_name) 기본 양식을 디폴트로 제안
    const form =
      (pkg?.formId ? await getFormById(pkg.formId) : null) ??
      (bid.orgName ? await getFormByOrg(bid.orgName) : null);
    return NextResponse.json({
      bid: {
        bidId: bid.bidId,
        externalId: bid.externalId,
        title: bid.title,
        orgName: bid.orgName,
        budget: bid.budget,
        postedAt: bid.postedAt,
        deadline: bid.deadline,
        method: bid.method,
        workType: bid.workType,
      },
      package: pkg,
      form,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PutBody {
  bidType?: string;
  bidId?: string;
  formId?: string | null;
  contractIds?: string[];
  employeeIds?: string[];
  staffConfig?: StaffConfig | null;
}

// PUT: 패키지 작업 상태 저장(공고당 1건 upsert)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as PutBody;
    const bidType = String(body.bidType ?? "");
    const bidId = String(body.bidId ?? "");
    if (!BID_TYPES.has(bidType) || !bidId) {
      return NextResponse.json({ error: "bidType/bidId 가 필요합니다." }, { status: 400 });
    }
    const bid = await getBid(bidType as BidType, bidId);
    if (!bid) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }
    const saved = await savePackage({
      bidType,
      bidId,
      orgName: bid.orgName,
      formId: body.formId ? String(body.formId) : null,
      contractIds: Array.isArray(body.contractIds) ? body.contractIds.map(String) : [],
      employeeIds: Array.isArray(body.employeeIds) ? body.employeeIds.map(String) : [],
      staffConfig: body.staffConfig ?? null,
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "bid_packages",
      targetId: saved.packageId,
      after: { bidType, bidId, contracts: saved.contractIds.length, employees: saved.employeeIds.length },
    });
    return NextResponse.json({ package: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
