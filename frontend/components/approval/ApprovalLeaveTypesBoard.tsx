"use client";

// 휴가 종류 규정 관리(/approval/leave-types, admin) — 사규 [별표 5. 경조금 지급 규정] 카탈로그.
// ★규정 변경 대비 편집 화면: 항목별 라벨·부여일수·차감방식·활성·순서를 편집한다.
// 연차/반차만 대장 차감(deduct), 경조·출산·조의는 부여일수(days) 고정, 공가·병가는 가변(빈칸).
// 설계: docs/e-approval-blueprint.md §8-5.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { DEFAULT_LEAVE_TYPES, type LeaveTypeItem } from "@/lib/approval/leave-types";
import "@/components/cdash/cdash.css";

export function ApprovalLeaveTypesBoard() {
  const { theme } = useCdashTheme();
  const [items, setItems] = useState<LeaveTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approval/leave-types?all=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "카탈로그를 불러오지 못했습니다.");
      setItems(data.types ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setItem = (i: number, patch: Partial<LeaveTypeItem>) => setItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setItems((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const dupKeys = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const it of items) {
      if (seen.has(it.key)) dup.add(it.key);
      seen.add(it.key);
    }
    return dup;
  }, [items]);

  const save = async () => {
    if (dupKeys.size) {
      alert(`키가 중복됩니다: ${[...dupKeys].join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/approval/leave-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: items.map((it, i) => ({ ...it, sortOrder: i })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const restoreDefault = () => {
    if (!confirm("사규 개정안 기본값으로 되돌립니다(저장 전까지 반영되지 않음). 계속할까요?")) return;
    setItems(DEFAULT_LEAVE_TYPES.map((d, i) => ({ ...d, sortOrder: i, active: true })));
  };

  const addItem = (group?: string) =>
    setItems((prev) => [
      ...prev,
      { key: `type_${prev.length + 1}`, label: "새 항목", group: group ?? "기타", days: null, deduct: null, sortOrder: prev.length, active: true },
    ]);

  // 그룹 목록(등장 순서 유지) — 좌측 태그 버튼의 원본.
  const groups = useMemo(() => {
    const out: string[] = [];
    for (const it of items) if (!out.includes(it.group)) out.push(it.group);
    return out;
  }, [items]);

  // 선택 그룹이 사라지면(이름 변경·삭제) 첫 그룹으로 되돌린다.
  useEffect(() => {
    if (groups.length === 0) return;
    if (!activeGroup || !groups.includes(activeGroup)) setActiveGroup(groups[0]);
  }, [groups, activeGroup]);

  /** 선택 그룹에 속한 항목 — 편집은 원본 인덱스로 해야 하므로 인덱스를 함께 들고 다닌다. */
  const groupItems = useMemo(
    () => items.map((it, i) => ({ it, i })).filter(({ it }) => it.group === activeGroup),
    [items, activeGroup]
  );

  /** 그룹 이름 일괄 변경 — 그룹 카드의 이름을 고치면 소속 항목 전체에 반영한다. */
  const renameGroup = (from: string, to: string) => {
    setItems((prev) => prev.map((x) => (x.group === from ? { ...x, group: to } : x)));
    setActiveGroup(to);
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="휴가 종류 규정"
        meta={`${groups.length}개 그룹 · ${items.length}개 항목`}
        actions={
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-[11px] cd-text-faint">저장됨 {savedAt}</span>}
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" onClick={restoreDefault}>
              <RotateCcw className="w-3.5 h-3.5" /> 기본값 복원
            </button>
            <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={saving} onClick={save}>
              <Save className="w-3.5 h-3.5 inline mr-1" />
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}

      {/* 좌: 그룹 태그 카드 / 우: 선택 그룹의 항목 편집.
          전체를 한 표로 늘어놓으면 40여 행이 그대로 쏟아져 어느 그룹을 보는지 알 수 없었다. */}
      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          {/* 그룹 선택 */}
          <div className="lg:w-[345px] shrink-0 flex flex-col gap-2 lg:overflow-y-auto">
            <p className="text-[11px] font-bold cd-text-faint px-0.5">휴가 그룹 선택</p>
            <div className="grid grid-cols-2 gap-2">
              {groups.map((g) => {
                const list = items.filter((x) => x.group === g);
                const on = g === activeGroup;
                return (
                  // 카드 배경은 흰색(카드색) — 글라스 칩은 캔버스와 같은 톤이라 배경에 묻혔다.
                  <button
                    key={g}
                    type="button"
                    onClick={() => setActiveGroup(g)}
                    className={`rounded-2xl px-3.5 py-[18px] text-left border transition-all ${
                      on ? "cd-glass-active" : "cd-border-c cd-row-hover"
                    }`}
                    style={{
                      background: on ? undefined : "var(--cd-card-solid)",
                      boxShadow: on ? undefined : "var(--cd-shadow)",
                    }}
                  >
                    <span className="block text-[10px] font-bold cd-text-faint">휴가 그룹</span>
                    <span className={`block text-[14.5px] font-extrabold truncate ${on ? "" : "cd-text"}`}>{g}</span>
                    <span className="block mt-1 text-[11px] cd-text-faint">
                      {list.length}개 · 사용 {list.filter((x) => x.active).length}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const name = prompt("새 휴가 그룹 이름을 입력하세요.");
                  if (!name?.trim()) return;
                  addItem(name.trim());
                  setActiveGroup(name.trim());
                }}
                className="rounded-2xl px-3.5 py-[18px] border border-dashed cd-border-c cd-text-faint flex flex-col items-center justify-center gap-1 cd-row-hover"
              >
                <Plus className="w-4 h-4" />
                <span className="text-[11px] font-bold">그룹 추가</span>
              </button>
            </div>
            <p className="text-[10.5px] cd-text-faint leading-relaxed px-0.5 mt-1">
              차감: 연차·반차만 연차 대장에서 차감됩니다. 경조·출산·조의는 부여일수 고정, 공가·병가는 부여일수를 비워 실사용 기간만큼 처리됩니다.
            </p>
          </div>

          {/* 선택 그룹 상세 */}
          <div className="flex-1 min-w-0 cd-card p-5 gap-3 lg:overflow-y-auto">
            {!activeGroup ? (
              <p className="text-sm cd-text-faint py-8 text-center">왼쪽에서 휴가 그룹을 선택하세요.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold cd-text-faint">그룹명</span>
                  <input
                    className="cd-input"
                    style={{ width: 200 }}
                    value={activeGroup}
                    onChange={(e) => renameGroup(activeGroup, e.target.value)}
                  />
                  <span className="text-[11px] cd-text-faint">이름을 바꾸면 이 그룹의 항목 전체에 적용됩니다.</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-left cd-text-faint text-[11px]">
                        <th className="py-1.5 pr-2 font-semibold">라벨</th>
                        <th className="py-1.5 pr-2 font-semibold">키</th>
                        <th className="py-1.5 pr-2 font-semibold">부여일수</th>
                        <th className="py-1.5 pr-2 font-semibold">차감</th>
                        <th className="py-1.5 pr-2 font-semibold">사용</th>
                        <th className="py-1.5 font-semibold">순서</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupItems.map(({ it, i }) => (
                        <tr key={i} className="border-t cd-border-c">
                          <td className="py-1 pr-2">
                            <input className="cd-input" style={{ width: 170 }} value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              className={`cd-input font-mono ${dupKeys.has(it.key) ? "cd-error-border" : ""}`}
                              style={{ width: 170 }}
                              value={it.key}
                              onChange={(e) => setItem(i, { key: e.target.value })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <input
                              className="cd-input text-right"
                              style={{ width: 72 }}
                              inputMode="decimal"
                              placeholder="가변"
                              value={it.days ?? ""}
                              onChange={(e) => setItem(i, { days: e.target.value.trim() === "" ? null : Number(e.target.value.replace(/[^\d.]/g, "")) })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <select
                              className="cd-select"
                              style={{ width: 110 }}
                              value={it.deduct ?? ""}
                              onChange={(e) => setItem(i, { deduct: e.target.value === "" ? null : (e.target.value as "full" | "half") })}
                            >
                              <option value="">비차감</option>
                              <option value="full">연차 1일</option>
                              <option value="half">연차 0.5일</option>
                            </select>
                          </td>
                          <td className="py-1 pr-2 text-center">
                            <input type="checkbox" checked={it.active} onChange={(e) => setItem(i, { active: e.target.checked })} />
                          </td>
                          <td className="py-1">
                            <span className="flex items-center gap-0.5">
                              <button type="button" className="cd-text-faint hover:cd-text" title="위로" onClick={() => move(i, -1)}>
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" className="cd-text-faint hover:cd-text" title="아래로" onClick={() => move(i, 1)}>
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                className="cd-text-faint hover:cd-error-text"
                                title="삭제"
                                onClick={() => setItems((prev) => prev.filter((_, xi) => xi !== i))}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                      {groupItems.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-[12.5px] cd-text-faint">
                            이 그룹에 항목이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  className="cd-btn rounded-xl border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint flex items-center gap-1.5 self-start"
                  onClick={() => addItem(activeGroup)}
                >
                  <Plus className="w-3.5 h-3.5" /> 이 그룹에 항목 추가
                </button>
                <p className="text-[10.5px] cd-text-faint">
                  비활성(사용 해제) 항목은 휴가신청 선택지에서 숨겨집니다. 삭제한 항목을 참조하던 기존 문서는 키로 표시됩니다. 순서는 선택지 표시 순서입니다.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
