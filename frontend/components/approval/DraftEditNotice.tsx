"use client";

// 기안 편집 화면(범용 기안 · 공문 · 견적서) 공용 조각 — 반려 사유 배너 + 기안 삭제 버튼.
// 반려 문서는 "무엇을 고쳐야 하는지"가 편집 화면에 보여야 하고, 작성중·반려 문서는
// 기안자가 스스로 접을(삭제할) 수 있어야 한다. 권한 판정은 서버(canDelete)를 따른다.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/** 문서 상세(GET /api/approval/docs/[docId])의 결재 단계 중 반려 건. */
export interface RejectedInfo {
  assigneeName: string | null;
  actedAt: string | null;
  comment: string | null;
}

/** 문서 상세 응답에서 편집 화면이 필요한 만큼만 추린 형태. */
export interface EditDocMeta {
  status: string;
  canDelete: boolean;
  rejected: RejectedInfo | null;
}

/** 상세 응답 → 편집 화면용 메타(3개 보드 공통 파싱). */
export function toEditDocMeta(doc: {
  status?: string;
  canDelete?: boolean;
  steps?: { status: string; assigneeName: string | null; actedAt: string | null; comment: string | null }[];
}): EditDocMeta {
  const rej = (doc.steps ?? []).filter((s) => s.status === "rejected").at(-1);
  return {
    status: String(doc.status ?? "draft"),
    canDelete: doc.canDelete === true,
    rejected: rej ? { assigneeName: rej.assigneeName, actedAt: rej.actedAt, comment: rej.comment } : null,
  };
}

const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "");

/** 반려 사유 배너 — 반려 문서를 다시 열었을 때 편집 화면 최상단에 표시한다. */
export function RejectedBanner({ meta }: { meta: EditDocMeta | null }) {
  if (!meta || meta.status !== "rejected") return null;
  return (
    <div
      className="rounded-xl border px-3.5 py-2.5 flex flex-col gap-1"
      style={{ borderColor: "var(--cd-error)", background: "var(--cd-error-soft, rgba(250,137,107,0.1))" }}
    >
      <span className="text-[11.5px] font-bold cd-error-text">
        반려된 문서를 수정 중입니다 — {meta.rejected?.assigneeName ?? "결재자"}
        {meta.rejected?.actedAt ? ` · ${short(meta.rejected.actedAt)}` : ""}
      </span>
      <p className="text-[12.5px] cd-text">{meta.rejected?.comment?.trim() || "반려 사유가 입력되지 않았습니다."}</p>
      <span className="text-[10.5px] cd-text-faint">
        상신하면 기존 문서번호를 유지한 채 결재선 첫 단계부터 다시 진행됩니다.
      </span>
    </div>
  );
}

/**
 * 기안 삭제 버튼 — 작성중·반려 문서를 완전히 삭제하고 전자결재 홈으로 돌아간다.
 * 저장 전(docId 없음)이거나 권한이 없으면 렌더하지 않는다.
 */
export function DeleteDraftButton({
  docId,
  meta,
  label = "기안 삭제",
}: {
  docId: string | null;
  meta: EditDocMeta | null;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!docId || !meta?.canDelete) return null;
  return (
    <button
      type="button"
      className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] disabled:opacity-50"
      disabled={busy}
      title="이 기안을 완전히 삭제합니다 — 되돌릴 수 없습니다"
      onClick={async () => {
        if (!window.confirm("이 기안을 완전히 삭제합니다.\n결재선·참조 기록도 함께 삭제되고 되돌릴 수 없습니다.\n삭제하시겠습니까?")) return;
        setBusy(true);
        try {
          const res = await fetch(`/api/approval/docs/${encodeURIComponent(docId)}`, { method: "DELETE" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((data as { error?: string })?.error ?? "삭제 실패");
          router.push("/approval");
        } catch (err) {
          alert((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Trash2 className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
