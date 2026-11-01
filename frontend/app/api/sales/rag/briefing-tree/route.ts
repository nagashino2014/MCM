import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { buildBriefingTree } from "@/lib/intel/briefing-tree";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
/** 정기 발행본 분류 트리 — 업종 → 사업장 → 발행 보고서(열람 범위는 발행 이력과 같다). */
export async function GET() { try { const a = await requireBriefingPermission("view"); return NextResponse.json(await buildBriefingTree(a.userId)); } catch (e) { return authErrorToResponse(e); } }
