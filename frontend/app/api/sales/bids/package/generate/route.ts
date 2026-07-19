import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { BidType } from "@/lib/scraper/types";
import { getFormById, getPackage } from "@/lib/bid/package-store";
import { getFormProfile } from "@/lib/bid/form-analyze";
import { assemblePackageData } from "@/lib/bid/package-data";
import { fillPackageHwpx } from "@/lib/bid/hwpx-fill";
import { readStorageObject, binaryResponse, sanitizeDownloadName } from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BID_TYPES = new Set(["order_plan", "prior_spec", "bid_notice"]);

/*
 * 입찰 증빙서류 패키지 생성(P3 1단계) — 분석·매핑된 발주처 양식(HWPX)에 선택한 실적 계약·
 * 수행인력·회사 프로필 데이터를 주입해 제출본 HWPX 를 만든다.
 * 출력: zip { 채움본.hwpx, 생성로그.txt } (2단계에서 PDF 두벌·인력별 첨부 병합 추가 예정)
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { bidType?: string; bidId?: string };
    const bidType = String(body.bidType ?? "");
    const bidId = String(body.bidId ?? "");
    if (!BID_TYPES.has(bidType) || !bidId) {
      return NextResponse.json({ error: "bidType/bidId 가 필요합니다." }, { status: 400 });
    }
    const pkg = await getPackage(bidType, bidId);
    if (!pkg) {
      return NextResponse.json({ error: "저장된 패키지 작업 상태가 없습니다. 먼저 '작업 상태 저장'을 하세요." }, { status: 400 });
    }
    if (!pkg.formId) {
      return NextResponse.json({ error: "사용할 제출 양식이 지정되지 않았습니다. 양식을 업로드/선택 후 저장하세요." }, { status: 400 });
    }
    if (pkg.contractIds.length === 0) {
      return NextResponse.json({ error: "실적 계약을 선택 후 저장하세요." }, { status: 400 });
    }
    const form = await getFormById(pkg.formId);
    if (!form) return NextResponse.json({ error: "양식 파일을 찾을 수 없습니다." }, { status: 404 });
    const profile = await getFormProfile(pkg.formId);
    if (!profile) {
      return NextResponse.json({ error: "양식 분석(항목 매핑)이 필요합니다. '양식 분석'을 먼저 실행하세요." }, { status: 400 });
    }

    const data = await assemblePackageData({
      bidType: bidType as BidType,
      bidId,
      contractIds: pkg.contractIds,
      employeeIds: pkg.employeeIds,
    });
    const formBytes = await readStorageObject(form.storageKey);
    // 회사 프로필에 등급 확인서 이미지가 있으면 신용평가 서식 스캔을 교체
    let creditImage: Uint8Array | undefined;
    if (data.company.profile.creditImage?.storageKey) {
      try {
        creditImage = await readStorageObject(data.company.profile.creditImage.storageKey);
      } catch {
        creditImage = undefined;
      }
    }
    const { bytes, warnings } = await fillPackageHwpx(formBytes, profile, data, { creditImage });

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "bid_packages",
      targetId: pkg.packageId,
      after: { kind: "package_generate", contracts: pkg.contractIds.length, persons: pkg.employeeIds.length, warnings: warnings.length },
    });

    const title = sanitizeDownloadName(data.bid.title || bidId).slice(0, 60);
    const zip = new JSZip();
    zip.file(`입찰서류(${title}).hwpx`, bytes);
    const log = [
      `생성일시: ${new Date().toISOString()}`,
      `공고: ${data.bid.title} (${data.bid.orgName})`,
      `실적 계약 ${data.contracts.length}건 / 수행인력 ${data.persons.length}명 / 서류 ${profile.documents.length}종`,
      "",
      warnings.length ? "경고:" : "경고 없음",
      ...warnings.map((w) => `- ${w}`),
      "",
      "확인 사항: 용역개요·참여임무 등 수기 항목과 발주처 평가란(득점)은 비워져 있습니다. 한글에서 열어 검토하세요.",
    ].join("\n");
    zip.file("생성로그.txt", log);
    const zipped = await zip.generateAsync({ type: "uint8array" });
    return binaryResponse(zipped, "application/zip", `입찰서류패키지(${title}).zip`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
