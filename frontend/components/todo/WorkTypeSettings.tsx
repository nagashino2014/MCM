"use client";

/**
 * 할 일 설정 › 하위 작업 유형·종류(302, 2026-10-20) — 유형별 탭에서 종류 목록을 관리한다.
 * 관리자(todo.admin·시스템 관리자)만 편집, 그 외는 읽기 전용. [저장] 한 번에 PUT /api/todo/work-types(전체 교체·빠진 항목은 숨김).
 * 기본 8종 유형은 키가 고정이라 이름을 바꿔도 자동 매칭(계약 대분류·영업·업무추진계획)이 유지된다.
 */

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { CdButton, useCdToast } from "@/components/cdash";
import type { TodoWorkType } from "@/lib/todo/types";
import { apiCall } from "./useTodoData";

let tmpSeq = 0;
const tmpKey = () => `new:${Date.now().toString(36)}${(tmpSeq++).toString(36)}`;

function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function WorkTypeSettings() {
  const { toast } = useCdToast();
  const [types, setTypes] = useState<TodoWorkType[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    apiCall<{ types: TodoWorkType[]; canEdit: boolean }>("/api/todo/work-types")
      .then((d) => {
        if (!alive) return;
        setTypes(d.types);
        setCanEdit(d.canEdit);
        setActive(d.types.find((t) => t.isActive)?.typeKey ?? d.types[0]?.typeKey ?? null);
      })
      .catch(() => alive && setTypes([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!types) return <p className="todo-mu text-[12.5px]">불러오는 중…</p>;
  const cur = types.find((t) => t.typeKey === active) ?? null;
  const edit = (fn: (list: TodoWorkType[]) => TodoWorkType[]) => {
    setTypes((l) => (l ? fn(l) : l));
    setDirty(true);
  };
  const patchType = (key: string, patch: Partial<TodoWorkType>) => edit((l) => l.map((t) => (t.typeKey === key ? { ...t, ...patch } : t)));
  const patchKinds = (key: string, fn: (k: TodoWorkType["kinds"]) => TodoWorkType["kinds"]) => edit((l) => l.map((t) => (t.typeKey === key ? { ...t, kinds: fn(t.kinds) } : t)));

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await apiCall<{ types: TodoWorkType[] }>("/api/todo/work-types", { method: "PUT", body: JSON.stringify({ types }) });
      const keepLabel = cur?.label;
      setTypes(d.types);
      setActive((a) => (d.types.some((t) => t.typeKey === a) ? a : d.types.find((t) => t.label === keepLabel)?.typeKey ?? d.types[0]?.typeKey ?? null));
      setDirty(false);
      toast("유형·종류를 저장했습니다.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="todo-wt">
      <p className="todo-mu text-[12px]">
        {canEdit ? "유형마다 하위 작업 '종류' 목록을 따로 정합니다. 숨긴 항목은 새로 고를 수 없지만 이미 저장된 하위 작업에는 그대로 보입니다." : "관리자만 편집할 수 있습니다. 유형마다 고를 수 있는 종류 목록입니다."}
      </p>
      <div className="todo-wt-tabs" role="tablist" aria-label="유형">
        {types.map((t) => (
          <button
            key={t.typeKey}
            type="button"
            role="tab"
            aria-selected={t.typeKey === active}
            className="cd-action todo-wt-tab"
            data-hidden={!t.isActive ? "true" : undefined}
            onClick={() => setActive(t.typeKey)}
          >
            {t.label || "(이름 없음)"}
          </button>
        ))}
        {canEdit && (
          <button
            type="button"
            className="cd-action todo-wt-tab"
            data-add="true"
            onClick={() => {
              const key = tmpKey();
              edit((l) => [...l, { typeKey: key, label: "새 유형", builtin: false, sortOrder: 999, isActive: true, kinds: [] }]);
              setActive(key);
            }}
          >
            <Plus aria-hidden="true" /> 유형
          </button>
        )}
      </div>
      {cur && (
        <div className="todo-wt-panel" role="tabpanel">
          <div className="todo-wt-row" data-head="true">
            <span className="todo-wt-lb">유형 이름</span>
            <input className="cd-input todo-wt-in" value={cur.label} maxLength={40} disabled={!canEdit} onChange={(e) => patchType(cur.typeKey, { label: e.target.value })} aria-label="유형 이름" />
            <label className="todo-wt-chk">
              <input type="checkbox" checked={!cur.isActive} disabled={!canEdit} onChange={(e) => patchType(cur.typeKey, { isActive: !e.target.checked })} />
              숨김
            </label>
            {cur.builtin && <span className="todo-mu text-[11.5px]">자동 매칭 유형</span>}
          </div>
          <div className="todo-wt-kinds" aria-label={`${cur.label} 종류`}>
            {cur.kinds.length === 0 && <p className="todo-mu text-[12px]">종류가 없습니다.</p>}
            {cur.kinds.map((k, i) => (
              <div key={k.kindKey} className="todo-wt-row" data-hidden={!k.isActive ? "true" : undefined}>
                <span className="todo-wt-no">{i + 1}</span>
                <input
                  className="cd-input todo-wt-in"
                  value={k.label}
                  maxLength={40}
                  disabled={!canEdit}
                  aria-label={`종류 ${i + 1} 이름`}
                  onChange={(e) => patchKinds(cur.typeKey, (ks) => ks.map((x) => (x.kindKey === k.kindKey ? { ...x, label: e.target.value } : x)))}
                />
                {canEdit && (
                  <>
                    <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label="위로" disabled={i === 0} onClick={() => patchKinds(cur.typeKey, (ks) => move(ks, i, -1))}>
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label="아래로" disabled={i === cur.kinds.length - 1} onClick={() => patchKinds(cur.typeKey, (ks) => move(ks, i, 1))}>
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </>
                )}
                <label className="todo-wt-chk">
                  <input
                    type="checkbox"
                    checked={!k.isActive}
                    disabled={!canEdit}
                    onChange={(e) => patchKinds(cur.typeKey, (ks) => ks.map((x) => (x.kindKey === k.kindKey ? { ...x, isActive: !e.target.checked } : x)))}
                  />
                  숨김
                </label>
                {canEdit && k.kindKey.startsWith("new:") && (
                  <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label="추가 취소" onClick={() => patchKinds(cur.typeKey, (ks) => ks.filter((x) => x.kindKey !== k.kindKey))}>
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="todo-wt-foot">
              <CdButton variant="soft" size="sm" icon={<Plus className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => patchKinds(cur.typeKey, (ks) => [...ks, { kindKey: tmpKey(), label: "", sortOrder: 999, isActive: true }])}>
                종류 추가
              </CdButton>
              <span className="ml-auto todo-mu text-[12px]">{dirty ? "저장하지 않은 변경이 있습니다" : ""}</span>
              <CdButton variant="primary" size="sm" loading={busy} disabled={!dirty} onClick={() => void save()}>
                유형·종류 저장
              </CdButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
