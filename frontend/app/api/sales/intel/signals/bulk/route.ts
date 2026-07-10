import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  convertSignalToProject,
  deleteSignals,
  deleteSignalsByGrade,
  getIntelSignal,
} from "@/lib/intel/intel-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 신호 일괄 작업 — 리스트 하단 버튼 4종.
//  deleteSelected: 선택 신호 삭제
//  deleteByGrade:  제외(excluded)/관찰(monitoring) 등급 일괄 삭제 (source 지정 시 해당 소스만)
//  convertMatched: 선택 신호 중 사업장 매칭·미전환 건을 영업건으로 일괄 편입
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      signalIds?: unknown;
      grade?: string;
      source?: string;
    };
    const ids = Array.isArray(body.signalIds)
      ? body.signalIds.map((v) => String(v)).filter(Boolean)
      : [];

    if (body.action === "deleteSelected") {
      if (!ids.length) return NextResponse.json({ error: "선택된 신호가 없습니다." }, { status: 400 });
      const deleted = await deleteSignals(ids);
      return NextResponse.json({ ok: true, deleted });
    }

    if (body.action === "deleteByGrade") {
      if (body.grade !== "excluded" && body.grade !== "monitoring") {
        return NextResponse.json({ error: "grade 는 excluded 또는 monitoring 이어야 합니다." }, { status: 400 });
      }
      const deleted = await deleteSignalsByGrade(body.grade, body.source || undefined);
      return NextResponse.json({ ok: true, deleted });
    }

    if (body.action === "convertMatched") {
      if (!ids.length) return NextResponse.json({ error: "선택된 신호가 없습니다." }, { status: 400 });
      let converted = 0;
      let skipped = 0;
      for (const signalId of ids) {
        const sig = await getIntelSignal(signalId);
        if (!sig || !sig.facilityId || sig.linkedProjectId) { skipped++; continue; }
        await convertSignalToProject(signalId, actor.userId);
        converted++;
      }
      return NextResponse.json({ ok: true, converted, skipped });
    }

    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
