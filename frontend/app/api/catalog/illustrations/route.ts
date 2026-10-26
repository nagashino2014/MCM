import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { IllustrationError, importIllustration, listIllustrations } from "@/lib/catalog/illustrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SVG = 4 * 1024 * 1024;
const MAX_THUMB = 2 * 1024 * 1024;

// GET: 일러스트 라이브러리(?all=1 이면 보관한 것까지) — 스튜디오 '일러스트 넣기'·관리 화면
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.view");
    const all = req.nextUrl.searchParams.get("all") === "1";
    return NextResponse.json({ items: await listIllustrations({ includeArchived: all }) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 일러스트 한 건 더하기(multipart: meta = 매처 meta.json 글자, svg = illust.svg, thumb? = thumb.png)
//   화면은 묶음 폴더의 영역마다 한 번씩 보낸다. 같은 meta.key 를 다시 올리면 새 판으로 바꾼다(옛 판은 쓰는 곳이 있으면 보관).
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const form = await req.formData();
    const svg = form.get("svg");
    const thumb = form.get("thumb");
    if (!(svg instanceof File)) throw new IllustrationError("SVG 파일이 필요합니다.");
    if (svg.size > MAX_SVG) throw new IllustrationError("SVG 는 3MB 이하만 올릴 수 있습니다.");
    let meta: unknown;
    try {
      meta = JSON.parse(String(form.get("meta") ?? "{}"));
    } catch {
      throw new IllustrationError("meta.json 을 읽지 못했습니다.");
    }
    const thumbBytes = thumb instanceof File && thumb.size > 0 && thumb.size <= MAX_THUMB ? new Uint8Array(await thumb.arrayBuffer()) : null;
    const out = await importIllustration({ meta, svg: await svg.text(), thumb: thumbBytes, actorUserId: actor.userId });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_illustrations",
      targetId: out.assetId,
      after: { sourceKey: out.sourceKey, title: out.title, replaced: out.replaced },
    });
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
