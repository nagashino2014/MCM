import { NextRequest, NextResponse } from "next/server";
import { listCollectionConfigs } from "@/lib/ieps/queries";
import { withDbWrite } from "@/lib/db";
import {
  authErrorToResponse,
  requireAuthenticated,
  requireEditor,
} from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuthenticated();
    const rows = await listCollectionConfigs();
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        config: safeJson(r.configJson),
        isDefault: !!r.isDefault,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface CreateBody {
  name: string;
  config: unknown;
  isDefault?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    await requireEditor();
  } catch (err) {
    return authErrorToResponse(err);
  }
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || !body.name || !body.config) {
    return NextResponse.json({ error: "name and config required" }, { status: 400 });
  }

  try {
    const id = await withDbWrite(async (db) => {
      const now = new Date().toISOString();
      if (body.isDefault) {
        await db.run("UPDATE collection_configs SET is_default = 0");
      }
      // 같은 name 으로 반복 저장 시 새 행을 누적하지 않고 기존 행을 갱신한다.
      // 사용자가 "옵션 저장"을 반복 클릭할 때 드롭다운이 끝없이 늘어나 "저장이 안 된 것처럼"
      // 보이는 문제를 막기 위함. UNIQUE 제약은 추가하지 않고 LOOKUP+UPDATE 또는 INSERT 패턴 사용.
      const existing = await db.exec(
        "SELECT id FROM collection_configs WHERE name = $1 LIMIT 1",
        [body.name]
      );
      if (existing.length && existing[0].values.length) {
        const existingId = Number(existing[0].values[0][0]);
        await db.run(
          "UPDATE collection_configs SET config_json = $1::jsonb, is_default = $2, updated_at = $3 WHERE id = $4",
          [JSON.stringify(body.config), body.isDefault ? 1 : 0, now, existingId]
        );
        return existingId;
      }
      const inserted = await db.exec(
        "INSERT INTO collection_configs (name, config_json, is_default, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4, $5) RETURNING id",
        [body.name, JSON.stringify(body.config), body.isDefault ? 1 : 0, now, now]
      );
      return inserted.length && inserted[0].values.length ? Number(inserted[0].values[0][0]) : null;
    });
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json(
      { error: "저장 실패: " + (err as Error).message },
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
