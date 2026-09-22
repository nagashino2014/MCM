// 내부 규정 머리 정보 요청값 검증 — API 라우트 공용(route 파일은 핸들러 외 export 금지라 분리).

import type { InternalRuleMeta } from "./store";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 제목 필수, 제정일은 YYYY-MM-DD, 규정번호는 양의 정수. */
export function parseInternalRuleMeta(raw: Record<string, unknown> | undefined): { meta: InternalRuleMeta; error?: string } {
  const title = String(raw?.title ?? "").trim();
  const regNoRaw = raw?.regNo;
  const regNo = regNoRaw == null || regNoRaw === "" ? null : Number(regNoRaw);
  const enacted = String(raw?.enactedDate ?? "").trim() || null;
  const meta: InternalRuleMeta = {
    title,
    regNo: regNo != null && Number.isInteger(regNo) && regNo > 0 ? regNo : null,
    ownerDept: String(raw?.ownerDept ?? "").trim() || null,
    approver: String(raw?.approver ?? "").trim() || null,
    enactedDate: enacted,
  };
  if (!title) return { meta, error: "규정 제목을 입력해 주세요." };
  if (regNo != null && meta.regNo == null) return { meta, error: "규정번호는 1 이상의 숫자로 입력해 주세요." };
  if (enacted && !ISO_DATE.test(enacted)) return { meta, error: "제정일을 YYYY-MM-DD 형식으로 입력해 주세요." };
  return { meta };
}
