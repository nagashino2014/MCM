import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse } from "@/lib/contracts/document-bundle";
import { buildRecordBundle, type RecordBundleInclude, type RecordBundlePackaging } from "@/lib/staffing/record-bundle";
import { RECORD_PERMISSION, loadStaffRecordDetail, resolveRecordScope, scopeAllowsDept } from "@/lib/staffing/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PACKAGINGS: RecordBundlePackaging[] = ["merged", "perContract", "split"];

/*
 * 수행인력 실적 증빙 다운로드 — 화면에서 체크한 용역만 대상.
 * body: { employeeId, contractIds[], include{history,contract,invoice,certificate,roster}, packaging }
 * 응답: PDF(일괄 병합) 또는 ZIP. 누락 집계는 X-Record-Summary 헤더(URI 인코딩 JSON).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission(RECORD_PERMISSION);
    const scope = await resolveRecordScope(ctx.userId);
    if (scope.kind === "none") throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);

    const body = (await req.json().catch(() => ({}))) as {
      employeeId?: string;
      contractIds?: string[];
      include?: Partial<RecordBundleInclude>;
      packaging?: string;
    };
    const employeeId = String(body.employeeId ?? "").trim();
    if (!employeeId) return NextResponse.json({ error: "인력을 선택하세요." }, { status: 400 });
    const contractIds = [...new Set((body.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (contractIds.length === 0) return NextResponse.json({ error: "증빙으로 내보낼 용역을 선택하세요." }, { status: 400 });
    if (contractIds.length > 100) {
      return NextResponse.json({ error: "한 번에 최대 100건까지 내보낼 수 있습니다." }, { status: 400 });
    }
    const packaging = PACKAGINGS.find((p) => p === body.packaging);
    if (!packaging) return NextResponse.json({ error: "파일 구성을 선택하세요." }, { status: 400 });
    const include: RecordBundleInclude = {
      history: body.include?.history === true,
      contract: body.include?.contract === true,
      invoice: body.include?.invoice === true,
      certificate: body.include?.certificate === true,
      roster: body.include?.roster === true,
    };
    if (!Object.values(include).some(Boolean)) {
      return NextResponse.json({ error: "포함할 서류를 하나 이상 선택하세요." }, { status: 400 });
    }

    const detail = await loadStaffRecordDetail(employeeId);
    if (!detail) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
    if (!scopeAllowsDept(scope, detail.profile.deptId)) throw new AuthError("소속 부서원의 실적만 내보낼 수 있습니다.", 403);

    // 계약 문서는 그 인력이 실제 참여한 용역(detail.rows)에 한해서만 나간다 — buildRecordBundle 이 교집합만 쓴다.
    const result = await buildRecordBundle({ detail, contractIds, include, packaging });
    const res = binaryResponse(result.bytes, result.contentType, result.fileName);
    res.headers.set("X-Record-Summary", encodeURIComponent(JSON.stringify(result.summary)));
    return res;
  } catch (err) {
    return authErrorToResponse(err);
  }
}
