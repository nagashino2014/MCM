import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rankInfographic } from "@/lib/catalog/ai/service";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import { isInfoType, sanitizeInfoContent, type InfoType } from "@/lib/catalog/render/infographic/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST: 인포그래픽 유형 순위·이유(§4-3 3단계) { content, box, current, sectionTypes?, pref?, slot? }
//   규칙 후보(1·2단계)는 서버가 다시 계산하고, 상위 6개를 LLM 이 의미 적합도로 다시 매긴다. 실패하면 규칙 점수 순.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const content = sanitizeInfoContent(body.content);
    const b = (body.box && typeof body.box === "object" ? body.box : {}) as Record<string, unknown>;
    const box = { w: Math.max(40, Math.min(900, Number(b.w) || 400)), h: Math.max(20, Math.min(700, Number(b.h) || 100)) };
    if (!isInfoType(body.current)) return NextResponse.json({ error: "지금 유형이 올바르지 않습니다." }, { status: 400 });
    const current = body.current;
    const sectionTypes = (Array.isArray(body.sectionTypes) ? body.sectionTypes : []).filter(isInfoType).slice(0, 20) as InfoType[];
    const pref = isInfoType(body.pref) ? body.pref : undefined;
    const { candidates } = matchInfographic(content, { box, current, sectionTypes, pref });
    const slot = typeof body.slot === "string" && /^[a-z0-9.-]{1,60}$/.test(body.slot) ? body.slot : undefined;
    const res = await rankInfographic({ content, box, current, candidates: candidates.slice(0, 6), userId: actor.userId, slot });
    return NextResponse.json(res);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
