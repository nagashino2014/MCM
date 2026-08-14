import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { importTaxForm, listTaxProfiles, saveTaxProfile } from "@/lib/payroll/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ profiles: await listTaxProfiles() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * JSON: 수기 저장 { employeeId, withholdingRate, dependents, childDeduction }
 * multipart: 소득세액공제신고서 엑셀 업로드(file 복수 허용) → 성명 매칭 upsert
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("file").filter((f): f is File => f instanceof File);
      if (!files.length) return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
      const results = [];
      for (const f of files) {
        try {
          const r = await importTaxForm(Buffer.from(await f.arrayBuffer()));
          results.push({ file: f.name, ...r });
        } catch (err) {
          results.push({ file: f.name, error: (err as Error).message });
        }
      }
      return NextResponse.json({ results });
    }
    const body = await req.json();
    if (!body.employeeId) return NextResponse.json({ error: "employeeId가 필요합니다." }, { status: 400 });
    await saveTaxProfile({
      employeeId: String(body.employeeId),
      withholdingRate: [80, 100, 120].includes(Number(body.withholdingRate)) ? Number(body.withholdingRate) : 100,
      dependents: Math.min(11, Math.max(1, Number(body.dependents ?? 1))),
      childDeduction: Math.max(0, Number(body.childDeduction ?? 0)),
      specialRelation: body.specialRelation == null ? undefined : Boolean(body.specialRelation),
      note: body.note ?? null,
      source: "manual",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
