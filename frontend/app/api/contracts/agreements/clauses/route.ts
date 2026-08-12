import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  addClause,
  deleteClause,
  harvestClauses,
  listClauses,
  markClauseUsed,
  updateClause,
  CLAUSE_CATEGORIES,
} from "@/lib/agreement/clause-library";

// 계약서 조항 라이브러리(149) — 작성 화면 검색·삽입 / 관리 화면 등록·수확·편집.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET: 검색(?q=&category=&serviceType=). 작성 화면·관리 화면 공용.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;
    const clauses = await listClauses({
      q: sp.get("q"),
      category: sp.get("category"),
      serviceType: sp.get("serviceType"),
      limit: Number(sp.get("limit") ?? 200),
    });
    return NextResponse.json({ clauses, categories: CLAUSE_CATEGORIES });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 등록(action 생략) | 일괄 수확(action=harvest) | 사용 기록(action=use)
export async function POST(req: NextRequest) {
  try {
    const session = await requirePermission("contract.view");
    const body = (await req.json()) as {
      action?: "harvest" | "use";
      title?: string;
      body?: string;
      category?: string;
      tags?: string[];
      serviceType?: string | null;
      clauseIds?: string[];
    };

    if (body.action === "harvest") {
      await requirePermission("approval.manage"); // 일괄 적재는 관리 권한
      const result = await harvestClauses(session.userId);
      return NextResponse.json(result);
    }
    if (body.action === "use") {
      await markClauseUsed(Array.isArray(body.clauseIds) ? body.clauseIds : []);
      return NextResponse.json({ ok: true });
    }

    if (!body.title?.trim() || !body.body?.trim()) {
      return NextResponse.json({ error: "조항 제목과 본문을 입력하세요." }, { status: 400 });
    }
    const result = await addClause({
      title: body.title,
      body: body.body,
      category: body.category,
      tags: body.tags,
      serviceType: body.serviceType ?? null,
      source: "manual",
      createdBy: session.userId,
    });
    if (result.duplicated) {
      return NextResponse.json({ duplicated: true, message: "같은 내용의 조항이 이미 라이브러리에 있습니다." });
    }
    return NextResponse.json({ clauseId: result.clauseId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 조항 수정 / DELETE: 삭제 — 관리 권한.
export async function PATCH(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const body = (await req.json()) as {
      clauseId: string;
      title?: string;
      body?: string;
      category?: string;
      tags?: string[];
      serviceType?: string | null;
    };
    if (!body?.clauseId) return NextResponse.json({ error: "조항을 지정하세요." }, { status: 400 });
    await updateClause(body.clauseId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const clauseId = req.nextUrl.searchParams.get("clauseId");
    if (!clauseId) return NextResponse.json({ error: "조항을 지정하세요." }, { status: 400 });
    await deleteClause(clauseId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
