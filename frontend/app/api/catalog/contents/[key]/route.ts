import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getContent, getContentMaster, isContentKey, publishContent, restoreContentVersion, saveContentDraft } from "@/lib/catalog/contents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ key: string }> };

async function keyOf(ctx: Ctx) {
  const { key } = await ctx.params;
  if (!isContentKey(key)) throw Object.assign(new Error("알 수 없는 콘텐츠입니다."), { status: 404 });
  return key;
}

// GET: 편집 콘텐츠(대표이사 인사말·조직도) — 임시 저장본 + 판 기록. ?master=1 이면 MCM 조직 마스터 기본안(조직도)도 함께
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("catalog.manage");
    const key = await keyOf(ctx);
    const state = await getContent(key);
    if (req.nextUrl.searchParams.get("master") === "1") return NextResponse.json({ ...state, master: await getContentMaster(key) });
    return NextResponse.json(state);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 임시 저장 { data }
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requirePermission("catalog.manage");
    const key = await keyOf(ctx);
    const body = (await req.json().catch(() => ({}))) as { data?: unknown };
    await saveContentDraft(key, body.data, actor.userId);
    return NextResponse.json(await getContent(key));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: { action: "publish", data, note } 확정(새 판 기록) | { action: "restore", version } 이전 판 불러오기
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requirePermission("catalog.manage");
    const key = await keyOf(ctx);
    const body = (await req.json().catch(() => ({}))) as { action?: string; data?: unknown; note?: string; version?: number };
    if (body.action === "publish") {
      const version = await publishContent(key, body.data, String(body.note ?? ""), actor.userId);
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "catalog_update",
        targetTable: "catalog_content_versions",
        targetId: `${key}#${version}`,
        after: { version, note: body.note ?? null },
      });
    } else if (body.action === "restore") {
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 1) return NextResponse.json({ error: "version 이 필요합니다." }, { status: 400 });
      await restoreContentVersion(key, version, actor.userId);
    } else {
      return NextResponse.json({ error: "action 은 publish 또는 restore 입니다." }, { status: 400 });
    }
    return NextResponse.json(await getContent(key));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
