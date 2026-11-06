"use client";

/**
 * 부서 삭제 확인 창(2026-11-06) — 열리면 GET /api/admin/organization/delete-preview 로 막는 사유를 받아 보여 준다.
 * 사유가 없을 때만 삭제 버튼이 나온다. 규칙: lib/admin/department-references.ts
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CdButton, CdModal } from "@/components/cdash";
import type { DepartmentDeletePreview, DepartmentRefCount } from "@/lib/admin/organization";
import type { DepartmentRow } from "./types";

function refText(item: DepartmentRefCount): string {
  const names = item.names.length ? ` (${item.names.join(", ")}${item.count > item.names.length ? " 등" : ""})` : "";
  return `${item.label} ${item.count}${item.unit}${names}`;
}

export function DepartmentDeleteModal({
  dept,
  onClose,
  onDeleted,
}: {
  dept: DepartmentRow | null;
  onClose: () => void;
  onDeleted: (dept: DepartmentRow) => void;
}) {
  const [preview, setPreview] = useState<DepartmentDeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deptId = dept?.deptId;

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!deptId) return;
    let alive = true;
    fetch(`/api/admin/organization/delete-preview?deptId=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { preview?: DepartmentDeletePreview; error?: string };
        if (!res.ok) throw new Error(data.error ?? `확인 실패 (${res.status})`);
        if (alive) setPreview(data.preview ?? null);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, [deptId]);

  const run = async () => {
    if (!dept || !preview?.canDelete) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organization?deptId=${encodeURIComponent(dept.deptId)}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `삭제 실패 (${res.status})`);
      onDeleted(dept);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={!!dept}
      onClose={() => (busy ? undefined : onClose())}
      title="부서 삭제"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <CdButton variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {preview && !preview.canDelete ? "닫기" : "취소"}
          </CdButton>
          {preview?.canDelete && (
            <CdButton variant="danger" size="sm" onClick={() => void run()} disabled={busy} icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>
              삭제
            </CdButton>
          )}
        </div>
      }
    >
      {dept && (
        <div className="flex flex-col gap-3 text-sm">
          {!preview && !error && (
            <p className="cd-text-faint flex items-center gap-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> 부서를 쓰는 데이터를 확인하는 중…
            </p>
          )}
          {error && (
            <p className="text-xs" style={{ color: "var(--cd-error)" }} role="alert">
              {error}
            </p>
          )}

          {preview && !preview.canDelete && (
            <>
              <p>
                <b>{preview.deptName}</b> 부서는 아직 쓰이고 있어 삭제할 수 없습니다.
              </p>
              <ul className="rounded-lg border px-3 py-2 text-xs flex flex-col gap-1.5" style={{ borderColor: "var(--cd-error-soft)" }} aria-label="삭제할 수 없는 사유">
                {preview.blockers.map((item) => (
                  <li key={item.key}>
                    <span className="font-semibold" style={{ color: "var(--cd-error)" }}>
                      {refText(item)}
                    </span>
                    <span className="cd-text-muted"> — {item.hint}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {preview?.canDelete && (
            <>
              <p>
                <b>{preview.deptName}</b> 부서를 삭제합니다. 되돌릴 수 없습니다.
              </p>
              {preview.cascades.length > 0 && (
                <p className="text-xs cd-text-muted">함께 지워지는 것: {preview.cascades.map(refText).join(", ")}</p>
              )}
            </>
          )}
        </div>
      )}
    </CdModal>
  );
}
