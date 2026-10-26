import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { ILLUST_ID_RE, loadIllustrationRenders } from "@/lib/catalog/illustrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 그릴 일러스트(?ids=cil_…,cil_…) — 정보 + 정리한 SVG. 스튜디오가 쪽에 놓인·고르는 일러스트를 그릴 때 쓴다(보관한 것도 포함)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.view");
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((id) => ILLUST_ID_RE.test(id)).slice(0, 60);
    return NextResponse.json({ items: await loadIllustrationRenders(ids) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
