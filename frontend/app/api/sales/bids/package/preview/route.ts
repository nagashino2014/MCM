import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import type { BidType } from "@/lib/scraper/types";
import { getFormById, parseStaffConfig } from "@/lib/bid/package-store";
import { getFormProfile } from "@/lib/bid/form-analyze";
import { assemblePackageData } from "@/lib/bid/package-data";
import { fillPackageHwpx } from "@/lib/bid/hwpx-fill";
import { convertHwpxToPdf } from "@/lib/agreement/convert";
import { readStorageObject } from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BID_TYPES = new Set(["order_plan", "prior_spec", "bid_notice"]);

const asIds = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 500) : [];

/*
 * 입찰 서류 패키지 미리보기 — 문서 생성과 같은 채움 엔진으로 HWPX 를 만들어 converter 로 PDF 변환해 돌려준다.
 * 저장 전 화면 상태(계약·인력·수행실적 설정)를 본문으로 받아 그대로 쓰며, 패키지 저장·산출물 보관·감사로그는
 * 남기지 않는다. docType 을 주면 그 서식만 잘라 채운다(항목별 미리보기), 없으면 전체.
 * body: { bidType, bidId, formId, contractIds, employeeIds, staffConfig, docType? }
 */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const bidType = String(body.bidType ?? "");
    const bidId = String(body.bidId ?? "");
    const formId = String(body.formId ?? "");
    const docType = typeof body.docType === "string" ? body.docType.trim() : "";
    if (!BID_TYPES.has(bidType) || !bidId) {
      return NextResponse.json({ error: "bidType/bidId 가 필요합니다." }, { status: 400 });
    }
    if (!formId) return NextResponse.json({ error: "제출 양식을 먼저 등록하세요." }, { status: 400 });
    const form = await getFormById(formId);
    if (!form) return NextResponse.json({ error: "양식 파일을 찾을 수 없습니다." }, { status: 404 });
    const profile = await getFormProfile(formId);
    if (!profile) {
      return NextResponse.json({ error: "양식 분석(항목 매핑)이 필요합니다. '양식 분석'을 먼저 실행하세요." }, { status: 400 });
    }
    if (docType && !profile.documents.some((d) => d.docType === docType)) {
      return NextResponse.json({ error: "이 발주처 양식에는 해당 서류가 매핑되어 있지 않습니다." }, { status: 404 });
    }

    const staffConfig = parseStaffConfig(body.staffConfig);
    const data = await assemblePackageData({
      bidType: bidType as BidType,
      bidId,
      contractIds: asIds(body.contractIds),
      employeeIds: asIds(body.employeeIds),
      staffConfig,
    });
    const formBytes = await readStorageObject(form.storageKey);
    let creditImage: Uint8Array | undefined;
    if ((!docType || docType === "credit_rating") && data.company.profile.creditImage?.storageKey) {
      try {
        creditImage = await readStorageObject(data.company.profile.creditImage.storageKey);
      } catch {
        creditImage = undefined;
      }
    }
    const { bytes, warnings } = await fillPackageHwpx(formBytes, profile, data, {
      creditImage,
      onlyDocTypes: docType ? [docType] : undefined,
    });
    const pdf = await convertHwpxToPdf(bytes, "preview.hwpx");
    if (!pdf) {
      return NextResponse.json(
        { error: "문서 변환 서비스(converter)에 연결할 수 없어 미리보기를 만들지 못했습니다." },
        { status: 503 }
      );
    }
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=preview.pdf",
        "Cache-Control": "no-store",
        "X-Preview-Warnings": String(warnings.length),
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
