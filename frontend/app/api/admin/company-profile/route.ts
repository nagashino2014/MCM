import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  getCompanyProfile,
  getStaffComposition,
  listCredentials,
  listHistory,
  saveCompanyProfile,
  type CompanyProfile,
} from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사 프로필 전체(일반현황 + 인적구성 집계 + 연혁 + 면허/인증)
export async function GET() {
  try {
    await requirePermission("org.view", { fallbackRoles: ["admin"] });
    const [profile, staff, history, credentials] = await Promise.all([
      getCompanyProfile(),
      getStaffComposition(),
      listHistory(),
      listCredentials(),
    ]);
    return NextResponse.json({ profile, staff, history, credentials });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 일반현황(+신용등급·재정상황·주요 사업내용) 저장
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Partial<CompanyProfile>;
    await saveCompanyProfile(
      {
        companyName: String(body.companyName ?? ""),
        ceoName: String(body.ceoName ?? ""),
        bizRegNo: String(body.bizRegNo ?? ""),
        corpRegNo: String(body.corpRegNo ?? ""),
        address: String(body.address ?? ""),
        phone: String(body.phone ?? ""),
        fax: String(body.fax ?? ""),
        bizField: String(body.bizField ?? ""),
        foundedYm: String(body.foundedYm ?? ""),
        mainBusiness: String(body.mainBusiness ?? ""),
        credit: {
          bondGrade: String(body.credit?.bondGrade ?? ""),
          creditGrade: String(body.credit?.creditGrade ?? ""),
          ratedAt: String(body.credit?.ratedAt ?? ""),
        },
        finance: Array.isArray(body.finance)
          ? body.finance.map((f) => ({
              year: String(f?.year ?? ""),
              capital: String(f?.capital ?? ""),
              revenue: String(f?.revenue ?? ""),
            }))
          : [],
      },
      actor.userId
    );
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_profile",
      targetId: "default",
      after: { companyName: body.companyName },
    });
    const profile = await getCompanyProfile();
    return NextResponse.json({ profile });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
