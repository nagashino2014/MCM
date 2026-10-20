// 결재 단계 표기(DA-2) — 스텝퍼·도장란·PDF 공용. 설계: docs/e-approval-delegation-blueprint.md §3.
// 대결: 원결재자 칸에 '대결' 도장 + 대결자 이름(원결재자 병기). 부재 건너뛰기: '부재'. 전결: '전결'(DA-3).

export interface StepDisplayInput {
  status: string;
  actType?: string | null;
  skipReason?: string | null;
  delegatedFrom?: string | null;
  delegatedFromName?: string | null;
  delegatedFromPosition?: string | null;
  assigneePosition?: string | null;
}

export interface StepDisplay {
  /** 도장 문자(처리된 단계만) — 승인·대결·전결·반려 */
  stamp: string | null;
  /** 상태 문자 — 예정·대기·대결 대기·승인·대결·전결·반려·부재·생략 */
  statusLabel: string;
  /** 대결 단계의 원결재자 이름(표기 병기용) */
  proxyOf: string | null;
  /** 결재란 머리칸 직위 — 대결은 원결재자 직위(원결재자 칸에 대결) */
  position: string | null;
}

export function stepDisplay(s: StepDisplayInput): StepDisplay {
  const proxied = !!s.delegatedFrom;
  const proxyOf = proxied ? s.delegatedFromName ?? s.delegatedFrom ?? null : null;
  const position = proxied ? s.delegatedFromPosition ?? s.assigneePosition ?? null : s.assigneePosition ?? null;
  switch (s.status) {
    case "approved": {
      const stamp = s.actType === "final" ? "전결" : proxied ? "대결" : "승인";
      return { stamp, statusLabel: stamp, proxyOf, position };
    }
    case "rejected":
      return { stamp: "반려", statusLabel: proxied ? "대결 반려" : "반려", proxyOf, position };
    case "pending":
      return { stamp: null, statusLabel: proxied ? "대결 대기" : "대기", proxyOf, position };
    case "waiting":
      return { stamp: null, statusLabel: "예정", proxyOf, position };
    case "skipped":
      return {
        stamp: null,
        statusLabel: s.skipReason === "absence" ? "부재" : s.skipReason === "final" ? "전결" : "생략",
        proxyOf,
        position,
      };
    default:
      return { stamp: null, statusLabel: s.status, proxyOf, position };
  }
}
