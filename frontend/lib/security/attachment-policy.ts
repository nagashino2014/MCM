import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/**
 * 메일·메신저 첨부 확장자 정책(262, 2026-09-17) — 전사 기본 + 인원별 예외.
 * 판정은 파일명의 마지막 확장자(끝의 점·공백 제거, 소문자). 목록에 없는 확장자는 항상 허용.
 *   사용자 모드 allow_all → 차단 없음 / block_listed → 목록 전부 차단 / default → 전사 기본(blocked)
 *   → 사용자 확장자 규칙(allow·block)이 최종 결정.
 * 적용: 메일 발송(일반·대용량 첨부 발급), 메신저 전송(일반·대용량·개인문서함 전송).
 */

export const EXT_CATEGORY_LABEL: Record<string, string> = {
  exec: "실행 파일(Windows)",
  script: "스크립트",
  installer: "설치·패키지",
  shortcut: "바로가기·링크",
  disk: "디스크 이미지",
  system: "시스템·설정",
  office_macro: "매크로 포함 문서",
  database: "데이터베이스(Access)",
  java: "Java",
  mac_linux: "macOS·Linux",
  archive: "압축 파일",
  web: "웹 문서",
  custom: "직접 추가",
};

export type UserPolicyMode = "default" | "allow_all" | "block_listed";

export interface ExtCatalogRow {
  ext: string;
  category: string;
  risk: "high" | "medium";
  description: string;
  blocked: boolean;
  isCustom: boolean;
  sortOrder: number;
}

export interface UserPolicyRow {
  userId: string;
  name: string;
  email: string | null;
  deptName: string | null;
  positionName: string | null;
  status: string;
  mode: UserPolicyMode;
  note: string | null;
  rules: Record<string, "allow" | "block">;
}

/** 파일명 → 판정용 확장자(없으면 null). "report.pdf.exe" → "exe", "a.exe. " → "exe". */
export function extensionOf(fileName: string): string | null {
  const name = String(fileName ?? "").trim().replace(/[.\s]+$/, "");
  const base = name.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return null;
  return base.slice(i + 1).toLowerCase();
}

/** 확장자 입력 정규화 — 점·공백 제거, 소문자, 허용 문자만. */
export function normalizeExt(raw: string): string | null {
  const e = String(raw ?? "").trim().replace(/^\.+/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,30}$/.test(e) ? e : null;
}

export async function listExtCatalog(): Promise<ExtCatalogRow[]> {
  const db = await getDb();
  return rowsToObjects(await db.exec(`SELECT * FROM attachment_ext_catalog ORDER BY sort_order, ext`)).map((r) => ({
    ext: String(r.ext),
    category: String(r.category),
    risk: String(r.risk) === "high" ? "high" : "medium",
    description: String(r.description),
    blocked: Number(r.blocked) === 1,
    isCustom: Number(r.is_custom) === 1,
    sortOrder: Number(r.sort_order ?? 0),
  }));
}

/** 사용자 1명의 실제 차단 확장자 집합. */
export async function blockedExtensionsFor(userId: string): Promise<Set<string>> {
  const db = await getDb();
  const [catalog, policy, rules] = await Promise.all([
    db.exec(`SELECT ext, blocked FROM attachment_ext_catalog`),
    db.exec(`SELECT mode FROM attachment_ext_user_policy WHERE user_id = $1`, [userId]),
    db.exec(`SELECT ext, action FROM attachment_ext_user_rules WHERE user_id = $1`, [userId]),
  ]);
  const mode = (rowsToObjects(policy)[0]?.mode as UserPolicyMode | undefined) ?? "default";
  const cat = rowsToObjects(catalog);
  const blocked = new Set<string>(
    mode === "allow_all" ? [] : mode === "block_listed" ? cat.map((r) => String(r.ext)) : cat.filter((r) => Number(r.blocked) === 1).map((r) => String(r.ext))
  );
  for (const r of rowsToObjects(rules)) {
    if (String(r.action) === "allow") blocked.delete(String(r.ext));
    else blocked.add(String(r.ext));
  }
  return blocked;
}

/** 전송 전 검사 — 차단 확장자가 있으면 400 오류(파일명 나열). */
export async function assertAttachmentsAllowed(userId: string, fileNames: string[]): Promise<void> {
  const names = fileNames.filter(Boolean);
  if (!names.length) return;
  const blocked = await blockedExtensionsFor(userId);
  if (!blocked.size) return;
  const hits = names.filter((n) => {
    const e = extensionOf(n);
    return e != null && blocked.has(e);
  });
  if (hits.length) {
    const exts = [...new Set(hits.map((n) => `.${extensionOf(n)}`))].join(", ");
    throw Object.assign(
      new Error(`보안 정책상 보낼 수 없는 파일 형식입니다(${exts}): ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? " 외" : ""}. 필요하면 관리자에게 허용을 요청하세요.`),
      { status: 400 }
    );
  }
}

/* ───────────── 관리 ───────────── */

export async function listUserPolicies(): Promise<UserPolicyRow[]> {
  const db = await getDb();
  const users = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, COALESCE(e.name, u.name) AS name, u.email, u.status, d.dept_name, pos.position_name,
              d.display_order AS dept_order, pos.rank_order,
              p.mode, p.note
         FROM users u
         LEFT JOIN employee_profiles e ON e.employee_id = u.employee_id OR (u.employee_id IS NULL AND e.user_id = u.user_id)
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions pos ON pos.position_id = e.position_id
         LEFT JOIN attachment_ext_user_policy p ON p.user_id = u.user_id
        ORDER BY (u.status = 'active') DESC, d.display_order NULLS LAST, pos.rank_order DESC NULLS LAST, name`
    )
  );
  const rules = rowsToObjects(await db.exec(`SELECT user_id, ext, action FROM attachment_ext_user_rules`));
  const byUser = new Map<string, Record<string, "allow" | "block">>();
  for (const r of rules) {
    const m = byUser.get(String(r.user_id)) ?? {};
    m[String(r.ext)] = String(r.action) === "allow" ? "allow" : "block";
    byUser.set(String(r.user_id), m);
  }
  const seen = new Set<string>();
  const out: UserPolicyRow[] = [];
  for (const u of users) {
    const id = String(u.user_id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      userId: id,
      name: String(u.name ?? u.email ?? id),
      email: u.email != null ? String(u.email) : null,
      deptName: u.dept_name != null ? String(u.dept_name) : null,
      positionName: u.position_name != null ? String(u.position_name) : null,
      status: String(u.status ?? "active"),
      mode: (u.mode as UserPolicyMode | null) ?? "default",
      note: u.note != null ? String(u.note) : null,
      rules: byUser.get(id) ?? {},
    });
  }
  return out;
}

export async function setGlobalBlocked(exts: string[], blocked: boolean, actorUserId: string): Promise<number> {
  const list = [...new Set(exts.map((e) => normalizeExt(e)).filter((e): e is string => !!e))];
  if (!list.length) return 0;
  await withDbWrite(async (db) => {
    await db.exec(
      `UPDATE attachment_ext_catalog SET blocked = $2, updated_by = $3, updated_at = now()::text WHERE ext = ANY($1::text[])`,
      [list, blocked ? 1 : 0, actorUserId]
    );
  });
  return list.length;
}

export async function addCustomExt(
  input: { ext: string; description: string; risk: "high" | "medium"; blocked: boolean },
  actorUserId: string
): Promise<void> {
  const ext = normalizeExt(input.ext);
  if (!ext) throw Object.assign(new Error("확장자는 영문·숫자로 입력하세요(예: exe)."), { status: 400 });
  const db = await getDb();
  const exists = rowsToObjects(await db.exec(`SELECT 1 FROM attachment_ext_catalog WHERE ext = $1`, [ext]));
  if (exists.length) throw Object.assign(new Error(`.${ext} 는 이미 목록에 있습니다.`), { status: 400 });
  await withDbWrite(async (txn) => {
    await txn.exec(
      `INSERT INTO attachment_ext_catalog (ext, category, risk, description, blocked, is_custom, sort_order, updated_by, updated_at)
       VALUES ($1, 'custom', $2, $3, $4, 1, 5000, $5, now()::text)`,
      [ext, input.risk === "high" ? "high" : "medium", input.description.trim() || "관리자 추가", input.blocked ? 1 : 0, actorUserId]
    );
  });
}

export async function deleteCustomExt(ext: string): Promise<void> {
  const e = normalizeExt(ext);
  if (!e) return;
  const db = await getDb();
  const row = rowsToObjects(await db.exec(`SELECT is_custom FROM attachment_ext_catalog WHERE ext = $1`, [e]))[0];
  if (!row) return;
  if (Number(row.is_custom) !== 1) throw Object.assign(new Error("기본 목록의 확장자는 삭제할 수 없습니다(허용으로 바꾸세요)."), { status: 400 });
  await withDbWrite(async (txn) => {
    await txn.exec(`DELETE FROM attachment_ext_catalog WHERE ext = $1`, [e]);
  });
}

export async function setUserMode(userIds: string[], mode: UserPolicyMode, actorUserId: string): Promise<number> {
  const ids = [...new Set(userIds.map(String).filter(Boolean))];
  if (!ids.length) return 0;
  await withDbWrite(async (db) => {
    for (const id of ids) {
      await db.exec(
        `INSERT INTO attachment_ext_user_policy (user_id, mode, updated_by, updated_at) VALUES ($1, $2, $3, now()::text)
         ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [id, mode, actorUserId]
      );
    }
  });
  return ids.length;
}

/** 인원×확장자 규칙 — rule: allow | block | inherit(규칙 삭제 = 모드·전사 기본 따름). */
export async function setUserRules(
  userIds: string[],
  exts: string[],
  rule: "allow" | "block" | "inherit",
  actorUserId: string
): Promise<number> {
  const ids = [...new Set(userIds.map(String).filter(Boolean))];
  const list = [...new Set(exts.map((e) => normalizeExt(e)).filter((e): e is string => !!e))];
  if (!ids.length || !list.length) return 0;
  await withDbWrite(async (db) => {
    if (rule === "inherit") {
      await db.exec(`DELETE FROM attachment_ext_user_rules WHERE user_id = ANY($1::text[]) AND ext = ANY($2::text[])`, [ids, list]);
      return;
    }
    for (const id of ids) {
      for (const ext of list) {
        await db.exec(
          `INSERT INTO attachment_ext_user_rules (user_id, ext, action, updated_by, updated_at) VALUES ($1, $2, $3, $4, now()::text)
           ON CONFLICT (user_id, ext) DO UPDATE SET action = EXCLUDED.action, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
          [id, ext, rule, actorUserId]
        );
      }
    }
  });
  return ids.length * list.length;
}

/** 인원 설정 초기화 — 모드 default + 확장자 규칙 전부 삭제. */
export async function resetUsers(userIds: string[]): Promise<number> {
  const ids = [...new Set(userIds.map(String).filter(Boolean))];
  if (!ids.length) return 0;
  await withDbWrite(async (db) => {
    await db.exec(`DELETE FROM attachment_ext_user_rules WHERE user_id = ANY($1::text[])`, [ids]);
    await db.exec(`DELETE FROM attachment_ext_user_policy WHERE user_id = ANY($1::text[])`, [ids]);
  });
  return ids.length;
}
