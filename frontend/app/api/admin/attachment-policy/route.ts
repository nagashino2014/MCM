import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  EXT_CATEGORY_LABEL,
  addCustomExt,
  deleteCustomExt,
  listExtCatalog,
  listUserPolicies,
  resetUsers,
  setGlobalBlocked,
  setUserMode,
  setUserRules,
  type UserPolicyMode,
} from "@/lib/security/attachment-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERM = "security.attachment_policy";

/** 첨부 확장자 정책 — 확장자 목록(전사 기본) + 인원별 설정. */
export async function GET() {
  try {
    await requirePermission(PERM, { fallbackRoles: ["admin"] });
    const [catalog, users] = await Promise.all([listExtCatalog(), listUserPolicies()]);
    return NextResponse.json({ catalog, users, categories: EXT_CATEGORY_LABEL });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

type Body =
  | { action: "setGlobal"; exts: string[]; blocked: boolean }
  | { action: "addExt"; ext: string; description?: string; risk?: "high" | "medium"; blocked?: boolean }
  | { action: "deleteExt"; ext: string }
  | { action: "setUserMode"; userIds: string[]; mode: UserPolicyMode }
  | { action: "setUserRules"; userIds: string[]; exts: string[]; rule: "allow" | "block" | "inherit" }
  | { action: "resetUsers"; userIds: string[] };

const MODES: UserPolicyMode[] = ["default", "allow_all", "block_listed"];

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission(PERM, { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Body;
    let changed = 0;
    switch (body.action) {
      case "setGlobal":
        changed = await setGlobalBlocked(Array.isArray(body.exts) ? body.exts : [], body.blocked === true, actor.userId);
        break;
      case "addExt":
        await addCustomExt(
          { ext: String(body.ext ?? ""), description: String(body.description ?? ""), risk: body.risk === "high" ? "high" : "medium", blocked: body.blocked !== false },
          actor.userId
        );
        changed = 1;
        break;
      case "deleteExt":
        await deleteCustomExt(String(body.ext ?? ""));
        changed = 1;
        break;
      case "setUserMode":
        if (!MODES.includes(body.mode)) return NextResponse.json({ error: "모드가 올바르지 않습니다." }, { status: 400 });
        changed = await setUserMode(Array.isArray(body.userIds) ? body.userIds : [], body.mode, actor.userId);
        break;
      case "setUserRules":
        if (!["allow", "block", "inherit"].includes(body.rule)) return NextResponse.json({ error: "규칙이 올바르지 않습니다." }, { status: 400 });
        changed = await setUserRules(
          Array.isArray(body.userIds) ? body.userIds : [],
          Array.isArray(body.exts) ? body.exts : [],
          body.rule,
          actor.userId
        );
        break;
      case "resetUsers":
        changed = await resetUsers(Array.isArray(body.userIds) ? body.userIds : []);
        break;
      default:
        return NextResponse.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
    }
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "attachment_policy_change",
      targetTable: "attachment_ext_catalog",
      targetId: body.action,
      after: body,
    });
    return NextResponse.json({ ok: true, changed });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
