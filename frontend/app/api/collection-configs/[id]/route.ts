import { NextRequest, NextResponse } from "next/server";
import { getCollectionConfig } from "@/lib/ieps/queries";
import { withDbWrite } from "@/lib/db";
import {
  authErrorToResponse,
  requireAuthenticated,
  requireEditor,
} from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
  } catch (err) {
    return authErrorToResponse(err);
  }
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const row = await getCollectionConfig(numId);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      id: row.id,
      name: row.name,
      config: safeJson(row.configJson),
      isDefault: !!row.isDefault,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "config 조회 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}

interface PatchBody {
  name?: string;
  config?: unknown;
  isDefault?: boolean;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    await requireEditor();
  } catch (err) {
    return authErrorToResponse(err);
  }
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    await withDbWrite(async (db) => {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      if (body.name !== undefined) {
        setClauses.push(`name = $${values.length + 1}`);
        values.push(body.name);
      }
      if (body.config !== undefined) {
        setClauses.push(`config_json = $${values.length + 1}::jsonb`);
        values.push(JSON.stringify(body.config));
      }
      if (body.isDefault !== undefined) {
        if (body.isDefault) {
          await db.run("UPDATE collection_configs SET is_default = 0");
        }
        setClauses.push(`is_default = $${values.length + 1}`);
        values.push(body.isDefault ? 1 : 0);
      }
      if (setClauses.length === 0) return;
      setClauses.push(`updated_at = $${values.length + 1}`);
      values.push(new Date().toISOString());
      values.push(numId);
      await db.run(
        `UPDATE collection_configs SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
        values as any[]
      );
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "갱신 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    await requireEditor();
  } catch (err) {
    return authErrorToResponse(err);
  }
  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    await withDbWrite(async (db) => {
      await db.run("DELETE FROM collection_configs WHERE id = $1", [numId]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "삭제 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
