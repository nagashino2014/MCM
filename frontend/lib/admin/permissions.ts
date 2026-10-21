import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export type PermissionScopeKind = "self" | "self_dept" | "specific_dept" | "all";
export type PermissionEffect = "allow" | "deny";

export interface PermissionRow {
  permissionKey: string;
  module: string;
  action: string;
  description: string;
  scopesSupported: PermissionScopeKind[];
  isDangerous: boolean;
}

export interface PermissionGrantRow {
  grantId: string;
  templateId: string;
  permissionKey: string;
  scopeKind: PermissionScopeKind;
  scopeDeptId: string | null;
  effect: PermissionEffect;
}

export interface PermissionTemplateRow {
  templateId: string;
  templateName: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  grants: PermissionGrantRow[];
}

export interface UserPermissionAssignmentRow {
  assignmentId: string;
  userId: string;
  userName: string;
  userEmail: string;
  templateId: string;
  templateName: string;
  scopeOverrideKind: PermissionScopeKind | null;
  scopeOverrideDeptId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  revokedAt: string | null;
}

export interface PermissionsSnapshot {
  permissions: PermissionRow[];
  templates: PermissionTemplateRow[];
  assignments: UserPermissionAssignmentRow[];
}

export interface SaveTemplateInput {
  templateId?: string;
  templateName: string;
  description?: string | null;
  isActive?: boolean;
  grants: Array<{
    permissionKey: string;
    scopeKind: PermissionScopeKind;
    scopeDeptId?: string | null;
    effect?: PermissionEffect;
  }>;
}

function boolInt(value: unknown): boolean {
  return Number(value ?? 0) === 1 || value === true;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function scopes(value: unknown): PermissionScopeKind[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as PermissionScopeKind[];
}

export async function listPermissionsSnapshot(): Promise<PermissionsSnapshot> {
  const db = await getDb();
  const [permissionsResult, templatesResult, grantsResult, assignmentsResult] = await Promise.all([
    db.exec(
      "SELECT permission_key, module, action, description, scopes_supported, is_dangerous FROM permissions ORDER BY module ASC, action ASC"
    ),
    db.exec(
      "SELECT template_id, template_name, description, is_system, is_active FROM permission_templates ORDER BY is_system DESC, template_name ASC"
    ),
    db.exec(
      "SELECT grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect FROM permission_template_grants ORDER BY created_at ASC"
    ),
    db.exec(
      `SELECT a.assignment_id, a.user_id, u.name AS user_name, u.email AS user_email,
              a.template_id, t.template_name, a.scope_override_kind, a.scope_override_dept_id,
              a.effective_from, a.effective_to, a.reason, a.revoked_at
         FROM user_permission_assignments a
         JOIN users u ON u.user_id = a.user_id
         JOIN permission_templates t ON t.template_id = a.template_id
        ORDER BY a.assigned_at DESC`
    ),
  ]);

  const grants = rowsToObjects(grantsResult).map((row) => ({
    grantId: String(row.grant_id ?? ""),
    templateId: String(row.template_id ?? ""),
    permissionKey: String(row.permission_key ?? ""),
    scopeKind: String(row.scope_kind ?? "self") as PermissionScopeKind,
    scopeDeptId: row.scope_dept_id != null ? String(row.scope_dept_id) : null,
    effect: String(row.effect ?? "allow") as PermissionEffect,
  }));

  return {
    permissions: rowsToObjects(permissionsResult).map((row) => ({
      permissionKey: String(row.permission_key ?? ""),
      module: String(row.module ?? ""),
      action: String(row.action ?? ""),
      description: String(row.description ?? ""),
      scopesSupported: scopes(row.scopes_supported),
      isDangerous: boolInt(row.is_dangerous),
    })),
    templates: rowsToObjects(templatesResult).map((row) => {
      const templateId = String(row.template_id ?? "");
      return {
        templateId,
        templateName: String(row.template_name ?? ""),
        description: row.description != null ? String(row.description) : null,
        isSystem: boolInt(row.is_system),
        isActive: boolInt(row.is_active),
        grants: grants.filter((grant) => grant.templateId === templateId),
      };
    }),
    assignments: rowsToObjects(assignmentsResult).map((row) => ({
      assignmentId: String(row.assignment_id ?? ""),
      userId: String(row.user_id ?? ""),
      userName: String(row.user_name ?? ""),
      userEmail: String(row.user_email ?? ""),
      templateId: String(row.template_id ?? ""),
      templateName: String(row.template_name ?? ""),
      scopeOverrideKind:
        row.scope_override_kind != null ? (String(row.scope_override_kind) as PermissionScopeKind) : null,
      scopeOverrideDeptId:
        row.scope_override_dept_id != null ? String(row.scope_override_dept_id) : null,
      effectiveFrom: String(row.effective_from ?? ""),
      effectiveTo: row.effective_to != null ? String(row.effective_to) : null,
      reason: row.reason != null ? String(row.reason) : null,
      revokedAt: row.revoked_at != null ? String(row.revoked_at) : null,
    })),
  };
}

export async function savePermissionTemplate(
  actorUserId: string,
  input: SaveTemplateInput
): Promise<string> {
  const name = input.templateName.trim();
  if (!name) throw new Error("권한 템플릿명이 필요합니다.");
  const templateId = input.templateId?.trim() || id("tpl");
  // 비활성 템플릿은 이미 부여된 계정에도 적용되지 않으므로(lib/auth/rbac.ts, F-29) 시스템 관리자 템플릿을 끄면
  // 모든 관리자가 잠긴다 — '마지막 시스템 관리자' 회수 보호와 같은 취지로 막는다.
  if (templateId === "tpl-system-admin" && input.isActive === false) {
    throw Object.assign(new Error("시스템 관리자 템플릿(tpl-system-admin)은 비활성으로 바꿀 수 없습니다."), { status: 400 });
  }
  const now = new Date().toISOString();

  await withDbWrite(async (db) => {
    const beforeRows = input.templateId
      ? rowsToObjects(
          await db.exec("SELECT * FROM permission_templates WHERE template_id = $1 LIMIT 1", [
            templateId,
          ])
        )
      : [];

    await db.run(
      `INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 0, $4, $5, $6, $6)
       ON CONFLICT (template_id) DO UPDATE SET
         template_name = EXCLUDED.template_name,
         description = EXCLUDED.description,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [templateId, name, input.description || null, input.isActive === false ? 0 : 1, actorUserId, now]
    );
    await db.run("DELETE FROM permission_template_grants WHERE template_id = $1", [templateId]);
    for (const grant of input.grants) {
      await db.run(
        `INSERT INTO permission_template_grants
          (grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect, conditions_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
        [
          id("grant"),
          templateId,
          grant.permissionKey,
          grant.scopeKind,
          grant.scopeDeptId || null,
          grant.effect || "allow",
          now,
        ]
      );
    }
    await recordAuditLogInline(db, {
      actorUserId,
      action: "permission_template_update",
      targetTable: "permission_templates",
      targetId: templateId,
      before: beforeRows[0] ?? null,
      after: input,
    });
  });

  return templateId;
}

export async function assignPermissionTemplate(
  actorUserId: string,
  input: {
    userId: string;
    templateId: string;
    scopeOverrideKind?: PermissionScopeKind | null;
    scopeOverrideDeptId?: string | null;
    effectiveFrom?: string;
    effectiveTo?: string | null;
    reason?: string | null;
  }
): Promise<string> {
  const assignmentId = id("assign");
  const now = new Date().toISOString();
  const effectiveFrom = input.effectiveFrom || now.slice(0, 10);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO user_permission_assignments
        (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
         effective_from, effective_to, reason, assigned_by, assigned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        assignmentId,
        input.userId,
        input.templateId,
        input.scopeOverrideKind || null,
        input.scopeOverrideDeptId || null,
        effectiveFrom,
        input.effectiveTo || null,
        input.reason || null,
        actorUserId,
        now,
      ]
    );
    await recordAuditLogInline(db, {
      actorUserId,
      action: "permission_assignment_update",
      targetTable: "user_permission_assignments",
      targetId: assignmentId,
      after: input,
    });
  });
  return assignmentId;
}

export async function revokePermissionAssignment(
  actorUserId: string,
  assignmentId: string
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    const before = rowsToObjects(
      await db.exec("SELECT * FROM user_permission_assignments WHERE assignment_id = $1 LIMIT 1", [
        assignmentId,
      ])
    )[0];
    // 마지막 시스템 관리자 보호(role 일원화 WP6, 2026-10-19): 유효한 tpl-system-admin 을 가진 활성 계정이
    // 1명 이하로 떨어지는 회수는 거부한다(계정 비활성화·삭제는 api/admin/users/[id] 가 같은 기준으로 막는다).
    if (before && String(before.template_id ?? "") === "tpl-system-admin" && before.revoked_at == null) {
      const today = now.slice(0, 10);
      const remain = rowsToObjects(
        await db.exec(
          `SELECT COUNT(DISTINCT u.user_id) AS n FROM users u
             JOIN user_permission_assignments a ON a.user_id = u.user_id
            WHERE u.status = 'active' AND a.template_id = 'tpl-system-admin' AND a.revoked_at IS NULL
              AND a.assignment_id <> $1
              AND (a.effective_from IS NULL OR left(a.effective_from, 10) <= $2)
              AND (a.effective_to IS NULL OR left(a.effective_to, 10) >= $2)`,
          [assignmentId, today]
        )
      );
      if (Number(remain[0]?.n ?? 0) < 1) {
        throw Object.assign(new Error("마지막 시스템 관리자(tpl-system-admin)의 권한은 회수할 수 없습니다."), { status: 400 });
      }
    }
    await db.run(
      "UPDATE user_permission_assignments SET revoked_at = $1, revoked_by = $2 WHERE assignment_id = $3",
      [now, actorUserId, assignmentId]
    );
    await recordAuditLogInline(db, {
      actorUserId,
      action: "permission_assignment_update",
      targetTable: "user_permission_assignments",
      targetId: assignmentId,
      before,
      after: { revokedAt: now },
    });
  });
}
