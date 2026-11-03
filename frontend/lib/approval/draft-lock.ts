// 초안 송부 잠금(336) — 견적·계약서 store 가 송부 성공 시 같은 트랜잭션에서 부른다.
// ⚠ lib/approval/docs.ts 를 import 하지 않는다(store → docs 순환 금지 관례). db 만 쓴다.

import type { PgDatabase } from "@/lib/db";

/**
 * 작성 중(draft) 문서에 draft_sent_at 을 1회만 기록한다. 이미 잠겼거나 상신·승인된 문서는 그대로 둔다.
 * 이후 saveDoc 이 이 문서의 수정을 거절하고, 버전 번호 계산이 이 버전을 확정 버전으로 센다.
 */
export async function lockSentDraft(txn: PgDatabase, docId: string, at: string): Promise<void> {
  await txn.run(
    `UPDATE approval_docs
        SET field_values = field_values || jsonb_build_object('draft_sent_at', $2::text, 'doc_stage', 'draft'),
            updated_at = $2
      WHERE doc_id = $1 AND status = 'draft' AND NOT (field_values ? 'draft_sent_at')`,
    [docId, at]
  );
}
