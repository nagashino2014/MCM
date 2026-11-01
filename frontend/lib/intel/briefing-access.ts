import { getDb, rowsToObjects } from "@/lib/db";
import { checkPermission, loadUserAccess, type UserAccess } from "@/lib/auth/rbac";
import { briefingError } from "./briefing-schedule";

export type BriefingCapability = "view" | "create" | "share";
export interface BriefingCapabilities { canView: boolean; canCreate: boolean; canShare: boolean }
/** 명시적 새 권한(deny 포함)이 있으면 이전 sales 권한으로 우회하지 않는다. */
export function canBriefingCapability(access: UserAccess, capability: BriefingCapability): boolean {
  const key = `intel.briefing.${capability}`;
  const permission = access.grants.some(g => g.permissionKey === key) ? key : capability === "view" ? "sales.view" : "sales.edit";
  return checkPermission(access, permission);
}
export async function getBriefingCapabilities(userId: string): Promise<BriefingCapabilities> {
  const db = await getDb();
  if (!rowsToObjects(await db.exec("SELECT user_id FROM users WHERE user_id=$1 AND status='active'", [userId])).length) return { canView: false, canCreate: false, canShare: false };
  const access = await loadUserAccess(userId);
  const canView = canBriefingCapability(access, "view");
  return { canView, canCreate: canView && canBriefingCapability(access, "create"), canShare: canView && canBriefingCapability(access, "share") };
}
export async function assertBriefingCapability(userId: string, capability: BriefingCapability): Promise<void> {
  const caps = await getBriefingCapabilities(userId);
  if (!caps[capability === "view" ? "canView" : capability === "create" ? "canCreate" : "canShare"]) throw briefingError("브리핑에 접근할 권한이 없습니다.", 403);
}
function sqlIdentifiers(alias: string, userParameter: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias) || !/^\$[1-9][0-9]*$/.test(userParameter)) throw new Error("Invalid briefing ACL SQL identifier");
}
export function briefingOwnerSql(alias = "b"): string {
  sqlIdentifiers(alias, "$1");
  return `(CASE WHEN COALESCE(to_jsonb(${alias})->>'access_scope','legacy_sales')='restricted' THEN (SELECT bp.owner_user_id FROM intel_briefing_profiles bp WHERE bp.profile_id=${alias}.profile_id) ELSE ${alias}.created_by END)`;
}
/** 기능 권한과 별개인 문서 ACL. 전사 역할에도 타인의 비공개 자료를 자동 개방하지 않는다. */
export function briefingVisibilitySql(alias = "b", userParameter = "$1"): string {
  sqlIdentifiers(alias, userParameter);
  return `(${briefingOwnerSql(alias)}=${userParameter} OR (COALESCE(to_jsonb(${alias})->>'access_scope','legacy_sales')='restricted' AND EXISTS(SELECT 1 FROM intel_briefing_recipients br WHERE br.profile_id=${alias}.profile_id AND br.user_id=${userParameter})) OR EXISTS(SELECT 1 FROM intel_rag_briefing_shares bs WHERE bs.briefing_id=${alias}.briefing_id AND bs.recipient_user_id=${userParameter} AND (COALESCE(to_jsonb(${alias})->>'access_scope','legacy_sales')<>'restricted' OR COALESCE(to_jsonb(bs)->>'explicit_share','false')='true')))`;
}
export async function assertBriefingDocumentOwner(briefingId: string, userId: string, capability: "create" | "share" = "share"): Promise<void> {
  await assertBriefingCapability(userId, capability);
  const db = await getDb();
  if (!rowsToObjects(await db.exec(`SELECT b.briefing_id FROM intel_rag_briefings b WHERE b.briefing_id=$1 AND ${briefingOwnerSql()}=$2`, [briefingId, userId])).length) throw briefingError("본인이 만든 브리핑만 관리하거나 공유할 수 있습니다.", 403);
}
export async function getBriefingDocumentPermissions(briefingId: string, userId: string): Promise<{ canShare: boolean; canManage: boolean }> {
  const caps = await getBriefingCapabilities(userId); const db = await getDb();
  const owned = rowsToObjects(await db.exec(`SELECT b.briefing_id FROM intel_rag_briefings b WHERE b.briefing_id=$1 AND ${briefingOwnerSql()}=$2`, [briefingId, userId])).length > 0;
  return { canShare: owned && caps.canShare, canManage: owned && caps.canCreate };
}
