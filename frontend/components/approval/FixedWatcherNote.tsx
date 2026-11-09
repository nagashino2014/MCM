"use client";

// 고정 참조·열람자(346) — 기안 화면 공용. 참조·열람 카드 안에서 관리자가 정해 둔 사람을 잠금 표시한다.
// 저장·상신 때 서버가 같은 사람을 넣으므로(기안자·결재선 인원 제외) 화면은 안내만 한다.

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

interface FixedWatcher {
  userId: string;
  name: string;
  kind: "ref" | "view";
}

/** mailCc — 공문·계약서처럼 참조·열람자가 발송 메일 Cc 를 받는 화면. 고정 인원은 Cc 에서 빠진다고 알린다. */
export function FixedWatcherNote({ formId, mailCc = false }: { formId: string | null | undefined; mailCc?: boolean }) {
  const [list, setList] = useState<FixedWatcher[]>([]);

  useEffect(() => {
    if (!formId) {
      setList([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/approval/fixed-watchers?formId=${encodeURIComponent(formId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { watchers?: FixedWatcher[] } | null) => {
        if (!cancelled) setList(d?.watchers ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [formId]);

  if (!list.length) return null;
  const names = (kind: "ref" | "view") =>
    list
      .filter((w) => w.kind === kind)
      .map((w) => w.name)
      .join(", ");
  const ref = names("ref");
  const view = names("view");
  return (
    <p className="text-[11px] cd-text-faint flex items-start gap-1" title="관리자가 모든 문서에 정해 둔 참조·열람자입니다. 상신하면 자동으로 들어가고 뺄 수 없습니다.">
      <Lock className="w-3 h-3 shrink-0 mt-[2px]" />
      <span>
        고정{ref ? ` 참조 ${ref}` : ""}
        {ref && view ? " ·" : ""}
        {view ? ` 열람 ${view}` : ""} — 상신 시 자동 추가{mailCc ? "(발송 메일 Cc 는 받지 않음)" : ""}
      </span>
    </p>
  );
}
