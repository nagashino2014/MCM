import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  deleteRoleUser,
  fixedLineReady,
  listLineDepartments,
  listLineTemplates,
  listRoleUsers,
  previewFixedLines,
  saveLineTemplate,
  setRoleUser,
  type FixedLineRole,
} from "@/lib/approval/fixed-line";
import type { DrafterRuleKind, ExtraPosition, LineEnforceWhen, LineTemplateStep } from "@/lib/approval/fixed-line-rules";
import { deleteLineUserRule, lineUserRulesReady, listLineUserRules, setLineUserRule } from "@/lib/approval/line-user-rules";
import { deleteFixedWatcher, fixedWatchersReady, listFixedWatchers, setFixedWatcher, type FixedWatcherKind } from "@/lib/approval/fixed-watchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 고정 결재선(335, 결재 운영) — 양식별 결재 단계·역할 담당자·해석 미리보기 + 고정 참조·열람자(346)
// + 기안자별 추가 결재자·참조·열람(353). 결재 운영자 전용.

async function snapshot() {
  const [ready, templates, roleUsers, departments, watchersReady, fixedWatchers, userRulesReady, userRules] = await Promise.all([
    fixedLineReady(),
    listLineTemplates(),
    listRoleUsers(),
    listLineDepartments(),
    fixedWatchersReady(),
    listFixedWatchers(),
    lineUserRulesReady(),
    listLineUserRules(),
  ]);
  return { ready, templates, roleUsers, departments, watchersReady, fixedWatchers, userRulesReady, userRules };
}

// GET: 템플릿·역할 담당자·부서 목록. ?preview=1 이면 재직자별 해석 결과를 함께 준다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const data = await snapshot();
    if (req.nextUrl.searchParams.get("preview") === "1") {
      return NextResponse.json({ ...data, preview: await previewFixedLines() });
    }
    return NextResponse.json(data);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PutBody {
  kind?: "template" | "role" | "watcher" | "userRule";
  formId?: string;
  steps?: LineTemplateStep[];
  enforceWhen?: LineEnforceWhen | null;
  enabled?: boolean;
  headDrafterTo?: "exec" | "ceo" | null;
  role?: FixedLineRole;
  deptId?: string | null;
  userId?: string;
  watchKind?: FixedWatcherKind;
  drafterUserId?: string;
  targetUserId?: string;
  ruleKind?: DrafterRuleKind;
  position?: ExtraPosition | null;
  note?: string | null;
}

// PUT: { kind:'template', formId, steps, enforceWhen, enabled } | { kind:'role', role, deptId, userId }
//    | { kind:'watcher', userId, watchKind:'ref'|'view' } (모든 양식 고정 참조·열람자, 346)
//    | { kind:'userRule', drafterUserId, formId, ruleKind:'approve'|'ref'|'view', targetUserId, position, note } (기안자별, 353)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as PutBody;
    if (body.kind === "template") {
      await saveLineTemplate(actor.userId, {
        formId: String(body.formId ?? ""),
        steps: Array.isArray(body.steps) ? body.steps : [],
        enforceWhen: body.enforceWhen ?? null,
        enabled: body.enabled !== false,
        headDrafterTo: body.headDrafterTo ?? null,
      });
    } else if (body.kind === "role") {
      await setRoleUser(actor.userId, { role: body.role as FixedLineRole, deptId: body.deptId ?? null, userId: String(body.userId ?? "") });
    } else if (body.kind === "watcher") {
      await setFixedWatcher(actor.userId, { userId: String(body.userId ?? ""), kind: body.watchKind as FixedWatcherKind });
    } else if (body.kind === "userRule") {
      await setLineUserRule(actor.userId, {
        drafterUserId: String(body.drafterUserId ?? ""),
        formId: body.formId ?? null,
        kind: body.ruleKind as DrafterRuleKind,
        targetUserId: String(body.targetUserId ?? ""),
        position: body.position ?? null,
        note: body.note ?? null,
      });
    } else {
      return NextResponse.json({ error: "kind 가 올바르지 않습니다." }, { status: 400 });
    }
    return NextResponse.json(await snapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?entryId= : 역할 담당자 행 삭제(부서별 임원·임원 취급 인원) | ?watcherEntryId= : 고정 참조·열람자 삭제(346)
//      | ?userRuleId= : 기안자별 규칙 삭제(353)
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const userRuleId = req.nextUrl.searchParams.get("userRuleId") ?? "";
    if (userRuleId) {
      await deleteLineUserRule(actor.userId, userRuleId);
      return NextResponse.json(await snapshot());
    }
    const watcherEntryId = req.nextUrl.searchParams.get("watcherEntryId") ?? "";
    if (watcherEntryId) {
      await deleteFixedWatcher(actor.userId, watcherEntryId);
      return NextResponse.json(await snapshot());
    }
    const entryId = req.nextUrl.searchParams.get("entryId") ?? "";
    if (!entryId) return NextResponse.json({ error: "entryId 가 필요합니다." }, { status: 400 });
    await deleteRoleUser(actor.userId, entryId);
    return NextResponse.json(await snapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
