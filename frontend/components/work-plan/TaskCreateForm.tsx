"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import type { TaskCategoryRow } from "@/lib/work-plan/tasks";

// 새 Task 생성 폼(메타: 업무명/착수일/업무분류). 생성 후 onCreated(taskId)로 보고 편집으로 전환.
export default function TaskCreateForm({
  category,
  onCreated,
}: {
  category: TaskCategoryRow;
  onCreated: (task: { taskId: string; taskName: string; startedAt: string }) => void;
}) {
  const [taskName, setTaskName] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setErr(null);
    if (!taskName.trim()) {
      setErr("업무명을 입력하세요.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/work-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskName: taskName.trim(), categoryId: category.categoryId, startedAt: startedAt || null }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? "Task 생성에 실패했습니다.");
      }
      const b = (await res.json()) as { taskId: string };
      onCreated({ taskId: b.taskId, taskName: taskName.trim(), startedAt });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col gap-4">
      <div>
        <h2 className="font-bold cd-text">새 Task 등록</h2>
        <p className="text-xs cd-text-faint mt-0.5">업무명과 착수일을 입력하고 생성하면, 공정표·수행인력·업무보고를 작성할 수 있습니다.</p>
      </div>

      <div className="rounded-2xl border cd-border-c p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5 md:col-span-1">
          <span className="text-[11px] font-semibold cd-text-faint">업무분류</span>
          <div className="cd-input text-sm w-full flex items-center cd-text-muted">{category.categoryName}</div>
        </label>
        <label className="flex flex-col gap-1.5 md:col-span-1">
          <span className="text-[11px] font-semibold cd-text-faint">업무명 *</span>
          <input className="cd-input text-sm w-full" placeholder="예: 계약/영업관리 웹 플랫폼 개발" value={taskName} onChange={(e) => setTaskName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 md:col-span-1">
          <span className="text-[11px] font-semibold cd-text-faint">착수일</span>
          <AutoDateInput className="cd-input text-sm w-full" value={startedAt} onChange={setStartedAt} />
        </label>
      </div>

      <div className="flex items-center justify-end gap-3">
        <span className="text-xs cd-error-text">{err}</span>
        <button
          type="button"
          disabled={creating}
          onClick={create}
          className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> {creating ? "생성 중…" : "Task 생성"}
        </button>
      </div>
    </section>
  );
}
