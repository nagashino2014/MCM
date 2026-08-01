"use client";

// 데이터 의미 사전 관리(/approval/semantic-concepts, admin) — 양식 필드에 붙이는 시맨틱 태그 카탈로그.
// 지표는 필드 key 가 아닌 이 개념 태그를 참조하므로, 여기서 개념을 가감하면 분석 어휘가 바뀐다.
// 엔티티 참조(ref.*) 4종은 필드 타입에서 자동 부여되는 개념이라 적용 대상 편집이 잠긴다.
// 설계: docs/semantic-analytics-wizard-blueprint.md §4-1 (SW-P0).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { DEFAULT_SEMANTIC_CONCEPTS, type SemanticConceptItem } from "@/lib/approval/semantic-concepts";
import "@/components/cdash/cdash.css";

/** 수동 태깅을 허용하는 필드/표 열 타입 후보(빌더 속성 패널과 일치). */
const TYPE_CHOICES = ["currency", "number", "date", "period", "select", "radio", "text", "multitext"] as const;

export function ApprovalSemanticConceptsBoard() {
  const { theme } = useCdashTheme();
  const [items, setItems] = useState<SemanticConceptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  /** 설정 패키지 가져오기(SW-P4 §9) — 양식+의미 사전+지표를 upsert(삭제 없음) */
  const importPackage = async (file: File) => {
    try {
      const pkg = JSON.parse(await file.text());
      if (!confirm(`설정 패키지를 적용할까요?\n양식 ${pkg.forms?.length ?? 0} · 개념 ${pkg.concepts?.length ?? 0} · 지표 ${pkg.metrics?.length ?? 0}건 (기존 항목은 덮어쓰고, 삭제는 하지 않습니다)`)) return;
      const res = await fetch("/api/approval/config-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pkg),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "가져오기 실패");
      const s = body.summary;
      alert(`적용 완료 — 폴더 ${s.folders} · 양식 ${s.forms} · 개념 ${s.concepts} · 지표 ${s.metrics}${s.errors.length ? `\n오류 ${s.errors.length}건: ${s.errors.slice(0, 3).join(" / ")}` : ""}`);
      await load();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/approval/semantic-concepts?all=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "사전을 불러오지 못했습니다.");
      setItems(data.concepts ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setItem = (i: number, patch: Partial<SemanticConceptItem>) =>
    setItems((prev) => prev.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));
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
      const res = await fetch("/api/approval/semantic-concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concepts: items.map((it, i) => ({ ...it, sortOrder: i })) }),
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
    if (!confirm("표준 개념 사전 기본값으로 되돌립니다(저장 전까지 반영되지 않음). 계속할까요?")) return;
    setItems(DEFAULT_SEMANTIC_CONCEPTS.map((d, i) => ({ ...d, sortOrder: i, active: true })));
  };

  const addItem = (group?: string) =>
    setItems((prev) => [
      ...prev,
      {
        key: `concept_${prev.length + 1}`,
        label: "새 개념",
        group: group ?? "분류",
        appliesTo: ["currency"],
        auto: false,
        sortOrder: prev.length,
        active: true,
      },
    ]);

  const groups = useMemo(() => {
    const out: string[] = [];
    for (const it of items) if (!out.includes(it.group)) out.push(it.group);
    return out;
  }, [items]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!activeGroup || !groups.includes(activeGroup)) setActiveGroup(groups[0]);
  }, [groups, activeGroup]);

  const groupItems = useMemo(
    () => items.map((it, i) => ({ it, i })).filter(({ it }) => it.group === activeGroup),
    [items, activeGroup]
  );

  const renameGroup = (from: string, to: string) => {
    setItems((prev) => prev.map((x) => (x.group === from ? { ...x, group: to } : x)));
    setActiveGroup(to);
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="데이터 의미 사전"
        meta={`${groups.length}개 그룹 · ${items.length}개 개념`}
        actions={
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-[11px] cd-text-faint">저장됨 {savedAt}</span>}
            {/* 설정 패키지(양식+의미 사전+지표) — 테넌트 복제·백업 단위(SW-P4 §9) */}
            <a href="/api/approval/config-package" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" title="양식·의미 사전·지표를 JSON 파일로 내보냅니다">
              <Download className="w-3.5 h-3.5" /> 설정 내보내기
            </a>
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5" title="설정 패키지 JSON 을 적용합니다(덮어쓰기·삭제 없음)" onClick={() => importInputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> 설정 가져오기
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importPackage(f);
                e.target.value = "";
              }}
            />
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

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          {/* 그룹 선택 */}
          <div className="lg:w-[345px] shrink-0 flex flex-col gap-2 lg:overflow-y-auto">
            <p className="text-[11px] font-bold cd-text-faint px-0.5">개념 그룹 선택</p>
            <div className="grid grid-cols-2 gap-2">
              {groups.map((g) => {
                const list = items.filter((x) => x.group === g);
                const on = g === activeGroup;
                return (
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
                    <span className="block text-[10px] font-bold cd-text-faint">개념 그룹</span>
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
                  const name = prompt("새 개념 그룹 이름을 입력하세요.");
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
              양식 빌더에서 금액·날짜·선택 항목에 붙이는 &quot;데이터 의미&quot; 태그의 표준 사전입니다. 분석 지표는 필드가 아니라 이 개념을
              참조하므로, 양식이 바뀌어도 같은 개념만 붙이면 지표가 그대로 동작합니다. 엔티티 참조(자동) 개념은 필드 종류에서 자동 부여됩니다.
            </p>
          </div>

          {/* 선택 그룹 상세 */}
          <div className="flex-1 min-w-0 cd-card p-5 gap-3 lg:overflow-y-auto">
            {!activeGroup ? (
              <p className="text-sm cd-text-faint py-8 text-center">왼쪽에서 개념 그룹을 선택하세요.</p>
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
                  <span className="text-[11px] cd-text-faint">이름을 바꾸면 이 그룹의 개념 전체에 적용됩니다.</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-left cd-text-faint text-[11px]">
                        <th className="py-1.5 pr-2 font-semibold">라벨</th>
                        <th className="py-1.5 pr-2 font-semibold">키</th>
                        <th className="py-1.5 pr-2 font-semibold">적용 대상(필드 종류)</th>
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
                              style={{ width: 150 }}
                              value={it.key}
                              disabled={it.auto}
                              onChange={(e) => setItem(i, { key: e.target.value })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            {it.auto ? (
                              <span className="text-[11px] cd-text-faint">자동 — {it.appliesTo.join(", ")} 필드에 항상 부여</span>
                            ) : (
                              <span className="flex items-center gap-1 flex-wrap">
                                {TYPE_CHOICES.map((t) => {
                                  const on = it.appliesTo.includes(t);
                                  return (
                                    <button
                                      key={t}
                                      type="button"
                                      className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-mono transition-colors ${
                                        on ? "cd-glass-active" : "cd-border-c cd-text-faint cd-row-hover"
                                      }`}
                                      onClick={() =>
                                        setItem(i, {
                                          appliesTo: on ? it.appliesTo.filter((x) => x !== t) : [...it.appliesTo, t],
                                        })
                                      }
                                    >
                                      {t}
                                    </button>
                                  );
                                })}
                              </span>
                            )}
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
                              {!it.auto && (
                                <button
                                  type="button"
                                  className="cd-text-faint hover:cd-error-text"
                                  title="삭제"
                                  onClick={() => setItems((prev) => prev.filter((_, xi) => xi !== i))}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {groupItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-[12.5px] cd-text-faint">
                            이 그룹에 개념이 없습니다.
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
                  <Plus className="w-3.5 h-3.5" /> 이 그룹에 개념 추가
                </button>
                <p className="text-[10.5px] cd-text-faint">
                  비활성 개념은 빌더 태깅 선택지에서 숨겨집니다. 이미 양식에 붙어 있는 태그는 문서에 그대로 남으며, 개념을 삭제하면 키로
                  표시됩니다. 키는 지표 정의가 참조하므로 운영 중 변경하지 않는 것이 안전합니다.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
