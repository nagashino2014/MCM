/**
 * 접속기록(access_log) 헬퍼 — 개인정보보호 블루프린트 PR-P1.
 * audit_log(데이터 "변경" 이력)와 구분되는 "접속·열람" 이력이다: 로그인 성공, 타인 개인정보
 * 열람·다운로드, 민감 설정 변경, 비상모드 기동. append-only(마이그 192 트리거)로 보호된다.
 *
 * best-effort: 기록 실패가 본 요청을 막지 않는다(콘솔 에러만). 컴플라이언스 기록이지만
 * 로그 인프라 장애로 업무가 중단되는 것이 더 큰 리스크라는 판단(블루프린트 §3-4).
 */

import { getDb } from "@/lib/db";

export type AccessAction = "login" | "view" | "download" | "delete" | "export" | "admin_change";

export interface AccessLogEntry {
  actorUserId: string | null;
  action: AccessAction;
  /** session | employee_doc | payroll | yearend | mail_alias | rbac_bypass | access_log ... */
  targetKind: string;
  targetId?: string | null;
  detail?: unknown;
}

export async function recordAccessLog(entry: AccessLogEntry): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO access_log (actor_user_id, action, target_kind, target_id, detail, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        entry.actorUserId,
        entry.action,
        entry.targetKind,
        entry.targetId ?? null,
        entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    // 마이그 192 미적용 환경 포함 — 요청 흐름을 막지 않는다.
    console.error("[access-log] 기록 실패:", (err as Error).message);
  }
}
