import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { generateBriefing, listBriefings, type RagSearchFilter } from "@/lib/intel/rag-queries";
import { getBriefingDocumentPermissions } from "@/lib/intel/briefing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const actor = await requireBriefingPermission("view");
    const limitRaw = Number(req.nextUrl.searchParams.get("limit"));
    const briefings = await listBriefings(
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined, actor.userId
    );
    return NextResponse.json({ briefings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 브리핑 생성. body: { question: string, filters?: RagSearchFilter }
export async function POST(req: NextRequest) {
  try {
    const actor = await requireBriefingPermission("create");
    const body = (await req.json().catch(() => ({}))) as {
      question?: string;
      filters?: RagSearchFilter;
    };
    const question = (body.question ?? "").trim();
    if (!question) return NextResponse.json({ error: "질문을 입력하세요." }, { status: 400 });
    const briefing = await generateBriefing(question, body.filters ?? {}, actor.userId || null);
    return NextResponse.json({ briefing: { ...briefing, ...await getBriefingDocumentPermissions(briefing.briefingId, actor.userId) } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
