import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { getBonusSettings } from "@/lib/bonus/targets";
import {
  listBonusEvaluationBoard,
  saveBonusEvaluations,
  type BonusEvalSaveEntry,
} from "@/lib/bonus/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 참여도·평점 보드 — 반기 발행 용역 × 참여자 슬롯 + 절대평가 설정. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("staffing.evaluation.read", { fallbackRoles: ["editor"] });
    const p = parsePeriod(new URL(req.url).searchParams.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const [rows, settings] = await Promise.all([
      listBonusEvaluationBoard(p),
      getBonusSettings(p.year, p.half),
    ]);
    return NextResponse.json({
      rows,
      absoluteGrading: settings.absoluteGrading,
      gradeCaps: settings.gradeCaps,
      isAdmin: ctx.role === "admin",
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 참여도·등급 일괄 저장 — 절대평가 상한 위반 시 400(저장 차단). */
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("staffing.evaluation.write", { fallbackRoles: ["editor"] });
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const entries: BonusEvalSaveEntry[] = (Array.isArray(body?.entries) ? body.entries : [])
      .map((e: Record<string, unknown>) => ({
        contractId: String(e?.contractId ?? ""),
        employeeId: String(e?.employeeId ?? ""),
        participationPct: Number(e?.participationPct ?? 0),
        grade: e?.grade ? String(e.grade) : null,
      }))
      .filter((e: BonusEvalSaveEntry) => e.contractId && e.employeeId);
    await saveBonusEvaluations(actor.userId, p, entries);
    return NextResponse.json({ ok: true, saved: entries.length });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 400) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
