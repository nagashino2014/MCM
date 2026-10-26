"use client";

// 지표 넣기 창 — 지표 사전(분야별)과 데이터 항목(회사 정보·기준월 등)에서 골라 글 속 칩으로 넣는다.
// 숫자는 지표 칩으로만 들어간다(블루프린트 §6-5). 칩은 데이터가 바뀌면 함께 바뀐다. 검색창에서 ↑↓ 로 고르고 Enter 로 넣는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { CatalogRenderData } from "@/lib/catalog/render/types";
import { bindOptions, resolveBind, type BindOption, type ChipOptions } from "@/lib/catalog/studio/binds";

export function BindPicker({
  open,
  data,
  onClose,
  onPick,
}: {
  open: boolean;
  data: CatalogRenderData | null;
  onClose: () => void;
  onPick: (bind: string, opts: ChipOptions) => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [digits, setDigits] = useState(1);
  const [unit, setUnit] = useState(true);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    // 창이 첫 단추([닫기])에 초점을 준 다음 프레임에 검색칸으로 옮긴다
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const all = useMemo(() => (data ? bindOptions(data) : []), [data]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all.filter((o) => {
      const hay = `${o.label} ${o.group} ${o.footnote} ${o.value ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [all, q]);

  useEffect(() => {
    if (active >= shown.length) setActive(Math.max(0, shown.length - 1));
  }, [shown.length, active]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: BindOption | undefined) => {
    if (o) onPick(o.bind, o.kind === "metric" ? { digits, unit } : {});
  };
  const valueOf = (o: BindOption) => {
    const v = data ? resolveBind(o.bind, data, digits) : null;
    if (o.kind === "data") return o.value ?? "-";
    return `${v ?? "-"}${unit && o.unit ? o.unit : ""}`;
  };

  let lastGroup = "";
  return (
    <CdModal open={open} onClose={onClose} title="지표 넣기" size="lg">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 cd-text-faint absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              className="cd-input"
              style={{ paddingLeft: 28 }}
              placeholder="지표·항목 이름이나 정의로 찾기"
              aria-label="지표 찾기"
              aria-controls="st-bind-list"
              value={q}
              onChange={(e) => (setQ(e.target.value), setActive(0))}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(shown.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pick(shown[active]);
                }
              }}
            />
          </label>
          <label className="flex items-center gap-1 text-xs cd-text-muted whitespace-nowrap">
            소수 자리
            <select className="cd-select" style={{ width: 88 }} value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
              <option value={0}>없음</option>
              <option value={1}>1자리</option>
              <option value={2}>2자리</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs cd-text-muted whitespace-nowrap">
            <input type="checkbox" checked={unit} onChange={(e) => setUnit(e.target.checked)} /> 단위 붙이기
          </label>
          <CdHelp topic="catalog.studio-data" />
        </div>

        {shown.length === 0 ? <p className="text-sm cd-text-faint">찾는 지표가 없습니다.</p> : null}
        <ul id="st-bind-list" ref={listRef} className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: "56vh" }} aria-label="넣을 수 있는 지표·데이터 항목">
          {shown.map((o, i) => {
            const head = o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={o.bind} className="flex flex-col gap-1">
                {head ? <h3 className="text-xs font-semibold cd-text-muted pt-1">{head}</h3> : null}
                <button
                  type="button"
                  data-idx={i}
                  className={`cd-action w-full rounded-lg border cd-border-c px-2.5 py-1.5 text-left text-xs flex flex-col gap-0.5 ${i === active ? "cd-tint-primary" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => pick(o)}
                >
                  <span className="flex items-center gap-2">
                    <b className="cd-text">{o.label}</b>
                    {o.kind === "data" ? <span className="cd-pill cd-pill-idle">글 항목</span> : null}
                    <span className="ml-auto tabular-nums cd-text truncate" style={{ maxWidth: "50%" }}>
                      {valueOf(o)}
                    </span>
                  </span>
                  {o.footnote ? <span className="cd-text-faint">{o.footnote}</span> : null}
                  {o.missing ? <span className="cd-text-faint">값 없음 — {o.missing}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </CdModal>
  );
}
