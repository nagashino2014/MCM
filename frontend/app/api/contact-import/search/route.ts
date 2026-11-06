import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { enqueueAwsJob, isFacilityQualityQueueEnabled } from "@/lib/ieps/aws-job-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 한도·차단으로 멈췄거나 조회가 실패한 회사의 사업자번호 검색을 이어 간다. */
export async function POST() {
  try {
    await requirePermission("facility.edit");
    if (!isFacilityQualityQueueEnabled()) {
      return NextResponse.json({ error: "외부 조회 워커가 연결되지 않은 환경입니다." }, { status: 409 });
    }
    await withDbWrite((db) => db.run(
      `UPDATE contact_import_companies SET search_status = 'pending' WHERE decision IS NULL AND search_status IN ('paused', 'attention')`
    ));
    await enqueueAwsJob({ type: "contact-import-search" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
