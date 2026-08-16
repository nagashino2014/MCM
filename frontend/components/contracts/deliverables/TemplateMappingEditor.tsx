"use client";

// 발주처 자체양식 매핑 보정(D5) — AI가 잡은 "값이 들어갈 자리"를 사람이 고친다.
// 왼쪽은 원본 그대로의 문단·표(연번 포함), 오른쪽은 그 자리에 붙은 매핑.
// 왼쪽에서 자리를 누르면 매핑이 붙거나(없던 자리) 오른쪽의 해당 항목이 선택된다(있던 자리).
//
// overlay(원본 서식 유지) 양식 전용이다 — 재구축(spec) 양식은 좌표가 파일에 없어 고칠 대상이 다르다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import {
  DELIVERABLE_BINDINGS,
  BINDING_LABEL,
  type DeliverableKind,
  type TemplateSlot,
} from "@/lib/deliverable/types";

/** 원본 개요 — 서버(template-form.ts)의 FormOutline 과 같은 모양. 파서를 클라이언트로 끌어오지 않는다. */
interface OutlineCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}
interface OutlineTable {
  index: number;
  rowCnt: number;
  colCnt: number;
  cells: OutlineCell[];
}
interface OutlinePara {
  index: number;
  text: string;
  tables: number[];
}
interface Outline {
  paras: OutlinePara[];
  tables: OutlineTable[];
}

type EditSlot = TemplateSlot & { uid: string };

interface EditDoc {
  docType: string;
  title: string;
  paraFrom?: number;
  paraTo?: number;
  slots: EditSlot[];
}

interface Props {
  templateId: string;
  name: string;
  kind: DeliverableKind;
  /** 저장했으면 changed=true — 부모가 목록을 다시 읽는다 */
  onClose: (changed: boolean) => void;
}

/** 자리 하나를 가리키는 키 — 좌우 패널이 같은 자리를 알아보는 기준. */
const slotKey = (s: Pick<TemplateSlot, "target" | "para" | "table" | "row" | "col">): string =>
  s.target === "cell" ? `c${s.table}:${s.row}:${s.col}` : `p${s.para}`;

const anchorId = (key: string): string => `tmap-${key.replace(/[:]/g, "-")}`;

/** 문단 텍스트에서 라벨(값 앞 인쇄 문구)을 추정한다 — "□ 계 약 명 : PSM…" → "계 약 명". */
function guessLabel(text: string): string {
  const m = /^[\s□■○●▪·※\-\d.)(]*(.+?)\s*[:：]/.exec(text);
  return m ? m[1].trim() : "";
}

export function TemplateMappingEditor({ templateId, name, kind, onClose }: Props) {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [docs, setDocs] = useState<EditDoc[]>([]);
  const [note, setNote] = useState<string>("");
  const [activeDoc, setActiveDoc] = useState<string>("");
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const uidRef = useRef(0);

  const newUid = () => `s${(uidRef.current += 1)}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/deliverables/templates/${templateId}?outline=1`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "양식을 불러오지 못했습니다.");
      const tpl = data?.template ?? {};
      const loaded: EditDoc[] = ((tpl.profile?.docs ?? []) as EditDoc[]).map((d) => ({
        docType: d.docType,
        title: d.title,
        paraFrom: d.paraFrom,
        paraTo: d.paraTo,
        slots: (d.slots ?? []).map((s) => ({ ...s, uid: newUid() })),
      }));
      setDocs(loaded);
      setNote(String(tpl.profile?.note ?? ""));
      setActiveDoc(loaded[0]?.docType ?? "");
      setOutline(data?.outline ?? null);
      setDirty(false);
      if (!data?.outline) setMsg("원본 개요를 읽지 못했습니다. 자리 추가는 할 수 없고 기존 매핑만 고칠 수 있습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 자리 키 → 그 자리에 붙은 매핑(+소속 서식). 좌측 패널이 이걸로 표시한다. */
  const byKey = useMemo(() => {
    const map = new Map<string, { slot: EditSlot; docType: string }>();
    for (const d of docs) for (const s of d.slots) map.set(slotKey(s), { slot: s, docType: d.docType });
    return map;
  }, [docs]);

  /** 서식 구간(paraFrom)이 시작되는 문단 → 좌측 목록에 구분 머리를 넣는다. */
  const docStartAt = useMemo(() => {
    const map = new Map<number, EditDoc>();
    for (const d of docs) if (d.paraFrom != null) map.set(d.paraFrom, d);
    return map;
  }, [docs]);

  const bindings = useMemo(
    () => DELIVERABLE_BINDINGS.filter((b) => (kind === "start" ? b.group !== "준공" : true)),
    [kind]
  );
  const groups = useMemo(() => [...new Set(bindings.map((b) => b.group))], [bindings]);

  const mutate = (fn: (draft: EditDoc[]) => EditDoc[]) => {
    setDocs((prev) => fn(prev));
    setDirty(true);
  };

  const updateSlot = (uid: string, patch: Partial<TemplateSlot>) =>
    mutate((prev) =>
      prev.map((d) => ({ ...d, slots: d.slots.map((s) => (s.uid === uid ? { ...s, ...patch } : s)) }))
    );

  const removeSlot = (uid: string) =>
    mutate((prev) => prev.map((d) => ({ ...d, slots: d.slots.filter((s) => s.uid !== uid) })));

  const updateDoc = (docType: string, patch: Partial<EditDoc>) =>
    mutate((prev) => prev.map((d) => (d.docType === docType ? { ...d, ...patch } : d)));

  const addDoc = () => {
    const slug = `custom:doc${docs.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
    mutate((prev) => [...prev, { docType: slug, title: `서식 ${prev.length + 1}`, slots: [] }]);
    setActiveDoc(slug);
  };

  const removeDoc = (docType: string) => {
    if (!window.confirm("이 서식과 거기 붙은 자리를 모두 지울까요?")) return;
    mutate((prev) => prev.filter((d) => d.docType !== docType));
    if (activeDoc === docType) setActiveDoc(docs.find((d) => d.docType !== docType)?.docType ?? "");
  };

  /** 좌측에서 자리를 눌렀을 때 — 이미 매핑돼 있으면 선택, 없으면 활성 서식에 새로 붙인다. */
  const pick = (base: Omit<TemplateSlot, "binding" | "label">, labelGuess: string) => {
    const key = slotKey(base as TemplateSlot);
    const hit = byKey.get(key);
    if (hit) {
      setActiveDoc(hit.docType);
      setSelected(hit.slot.uid);
      return;
    }
    let target = activeDoc;
    if (!docs.some((d) => d.docType === target)) {
      if (docs.length) {
        target = docs[0].docType;
        setActiveDoc(target);
      } else {
        target = `custom:doc1-${Math.random().toString(36).slice(2, 6)}`;
        setActiveDoc(target);
        const uid = newUid();
        mutate(() => [
          { docType: target, title: "서식 1", slots: [{ ...(base as TemplateSlot), binding: "", label: labelGuess, uid }] },
        ]);
        setSelected(uid);
        return;
      }
    }
    const uid = newUid();
    mutate((prev) =>
      prev.map((d) =>
        d.docType === target
          ? { ...d, slots: [...d.slots, { ...(base as TemplateSlot), binding: "", label: labelGuess, uid }] }
          : d
      )
    );
    setSelected(uid);
  };

  /** 오른쪽 항목을 누르면 왼쪽 원본의 그 자리로 스크롤한다 — 좌표만 보고는 어디인지 알기 어렵다. */
  const revealInSource = (s: EditSlot) => {
    setSelected(s.uid);
    document.getElementById(anchorId(slotKey(s)))?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const profile = {
        analyzedAt: new Date().toISOString(),
        model: "manual",
        note: note.trim() || undefined,
        docs: docs.map((d) => ({
          docType: d.docType,
          title: d.title.trim() || d.docType,
          paraFrom: d.paraFrom,
          paraTo: d.paraTo,
          slots: d.slots.map(({ uid: _uid, ...s }) => s),
        })),
      };
      const res = await fetch(`/api/contracts/deliverables/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장에 실패했습니다.");
      setDirty(false);
      if (data?.dropped) {
        setMsg(`저장했습니다. 다만 ${data.dropped}개 자리는 값 범위를 정할 수 없거나 원본 좌표와 맞지 않아 빠졌습니다.`);
        await load();
      } else {
        onClose(true);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("저장하지 않은 수정이 있습니다. 닫을까요?")) return;
    onClose(false);
  };

  const slotCount = docs.reduce((a, d) => a + d.slots.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <button
            type="button"
            className="cd-btn rounded-xl border cd-border-c px-3 py-1.5 text-[12.5px] flex items-center gap-1.5"
            onClick={close}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> 매핑 확인으로
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] cd-text-faint">
            {docs.length}종 서식 · {slotCount}개 자리{dirty ? " · 수정됨" : ""}
          </span>
          <button
            type="button"
            className="cd-btn cd-fill-primary rounded-xl px-4 py-2 text-[13px] flex items-center gap-1.5"
            onClick={() => void save()}
            disabled={saving || loading}
          >
            <Save className="w-4 h-4" /> {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border cd-border-c px-3.5 py-2 text-[11.5px] cd-text-faint">
        <b className="cd-text">{name}</b> — 왼쪽 원본에서 값이 들어갈 자리를 누르면 오른쪽에 매핑이 붙습니다. 문단 자리는{" "}
        <b className="cd-text">라벨 뒤부터 접미어 앞까지</b>가 값으로 바뀝니다(라벨의 자간 공백은 무시하고 찾습니다). 표 자리는
        칸 전체가 값으로 바뀝니다.
      </div>

      {msg && (
        <div className="rounded-xl px-4 py-2.5 text-[13px]" style={{ background: "var(--cd-tint)", color: "var(--cd-text)" }}>
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] cd-text-faint py-10 text-center">불러오는 중…</p>
      ) : (
        <div className="flex flex-col xl:flex-row gap-5 items-start">
          {/* 좌: 원본 구조 */}
          <section className="cd-card rounded-3xl overflow-hidden w-full xl:flex-[6] min-w-0">
            <div className="p-4 border-b cd-border-c">
              <h2 className="font-bold cd-text text-sm">원본 문서</h2>
              <p className="text-[11px] cd-text-faint mt-0.5">
                연번은 원본의 문단·표 순서입니다. 색이 들어간 줄이 값 자리로 잡힌 곳입니다.
              </p>
            </div>
            <div className="p-3 overflow-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
              {!outline && <p className="text-[12.5px] cd-text-faint py-8 text-center">원본 개요가 없습니다.</p>}
              {outline?.paras.map((p) => {
                const head = docStartAt.get(p.index);
                const key = `p${p.index}`;
                const hit = byKey.get(key);
                const on = hit && hit.slot.uid === selected;
                return (
                  <div key={p.index}>
                    {head && (
                      <div className="mt-3 mb-1.5 flex items-center gap-2">
                        <span className="text-[11.5px] font-semibold cd-text-primary">{head.title}</span>
                        <span className="flex-1 border-t cd-border-c" />
                      </div>
                    )}
                    {(p.text || !p.tables.length) && (
                      <button
                        type="button"
                        id={anchorId(key)}
                        disabled={!p.text}
                        className={`w-full text-left flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] border ${
                          hit ? (on ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-tint-primary border-transparent") : "border-transparent"
                        } ${p.text ? "hover:cd-tint-primary" : "opacity-45"}`}
                        onClick={() => pick({ target: "para", para: p.index }, guessLabel(p.text))}
                      >
                        <span className="cd-text-faint shrink-0 tabular-nums" style={{ width: "2.5rem" }}>
                          {p.index}
                        </span>
                        <span className="cd-text truncate flex-1 min-w-0">{p.text || "(빈 줄)"}</span>
                        {hit && (
                          <span className="shrink-0 text-[11px] cd-text-primary">
                            {hit.slot.binding ? BINDING_LABEL[hit.slot.binding] ?? hit.slot.binding : "자리(미지정)"}
                          </span>
                        )}
                      </button>
                    )}
                    {p.tables.map((ti) => {
                      const t = outline.tables[ti];
                      if (!t) return null;
                      return (
                        <div key={ti} className="my-2">
                          <div className="text-[11px] cd-text-faint mb-1">
                            표 {t.index} · {t.rowCnt}행 {t.colCnt}열 (문단 {p.index})
                          </div>
                          <div className="overflow-x-auto">
                            <table className="border-collapse w-full" style={{ tableLayout: "fixed" }}>
                              <tbody>
                                {Array.from({ length: t.rowCnt }, (_, r) => (
                                  <tr key={r}>
                                    {t.cells
                                      .filter((c) => c.row === r)
                                      .sort((a, b) => a.col - b.col)
                                      .map((c) => {
                                        const ck = `c${t.index}:${c.row}:${c.col}`;
                                        const chit = byKey.get(ck);
                                        const con = chit && chit.slot.uid === selected;
                                        return (
                                          <td
                                            key={`${c.row}-${c.col}`}
                                            id={anchorId(ck)}
                                            rowSpan={c.rowSpan > 1 ? c.rowSpan : undefined}
                                            colSpan={c.colSpan > 1 ? c.colSpan : undefined}
                                            className={`border cd-border-c align-top p-1 cursor-pointer ${
                                              chit ? "cd-tint-primary" : ""
                                            } ${con ? "border-[color:var(--cd-primary)]" : ""}`}
                                            onClick={() => pick({ target: "cell", table: t.index, row: c.row, col: c.col }, c.text)}
                                          >
                                            <div className="text-[10px] cd-text-faint tabular-nums">
                                              {c.row}·{c.col}
                                            </div>
                                            <div className="text-[11.5px] cd-text break-words">{c.text || " "}</div>
                                            {chit && (
                                              <div className="text-[10.5px] cd-text-primary mt-0.5">
                                                {chit.slot.binding ? BINDING_LABEL[chit.slot.binding] ?? chit.slot.binding : "자리(미지정)"}
                                              </div>
                                            )}
                                          </td>
                                        );
                                      })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 우: 매핑 편집 */}
          <section className="cd-card rounded-3xl overflow-hidden w-full xl:flex-[4] min-w-0">
            <div className="p-4 border-b cd-border-c flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-bold cd-text text-sm">값 자리</h2>
                <p className="text-[11px] cd-text-faint mt-0.5">새 자리는 <b className="cd-text">선택된 서식</b>에 붙습니다.</p>
              </div>
              <button
                type="button"
                className="cd-btn rounded-xl border cd-border-c px-3 py-1.5 text-[12.5px] flex items-center gap-1.5 shrink-0"
                onClick={addDoc}
              >
                <Plus className="w-3.5 h-3.5" /> 서식 추가
              </button>
            </div>
            <div className="p-3 overflow-auto flex flex-col gap-3" style={{ maxHeight: "calc(100vh - 320px)" }}>
              {docs.length === 0 && (
                <p className="text-[12.5px] cd-text-faint py-8 text-center">
                  서식이 없습니다. 왼쪽에서 자리를 누르면 서식이 하나 만들어집니다.
                </p>
              )}
              {docs.map((d) => {
                const on = d.docType === activeDoc;
                return (
                  <div
                    key={d.docType}
                    className={`rounded-2xl border ${on ? "border-[color:var(--cd-primary)]" : "cd-border-c"}`}
                    onClick={() => setActiveDoc(d.docType)}
                  >
                    <div className="p-3 border-b cd-border-c flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          className="cd-input text-[12.5px] flex-1 min-w-0"
                          value={d.title}
                          placeholder="서식 이름(작성 화면의 선택 항목)"
                          onChange={(e) => updateDoc(d.docType, { title: e.target.value })}
                        />
                        <button
                          type="button"
                          className="cd-btn rounded-lg border cd-border-c p-1.5 shrink-0"
                          title="서식 삭제"
                          onClick={() => removeDoc(d.docType)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-[11.5px] cd-text-faint">
                        <span className="shrink-0">문단 구간</span>
                        <input
                          className="cd-input text-[12px]"
                          style={{ width: "4.5rem" }}
                          type="number"
                          min={0}
                          value={d.paraFrom ?? ""}
                          onChange={(e) =>
                            updateDoc(d.docType, { paraFrom: e.target.value === "" ? undefined : Number(e.target.value) })
                          }
                        />
                        <span className="shrink-0">~</span>
                        <input
                          className="cd-input text-[12px]"
                          style={{ width: "4.5rem" }}
                          type="number"
                          min={0}
                          value={d.paraTo ?? ""}
                          onChange={(e) =>
                            updateDoc(d.docType, { paraTo: e.target.value === "" ? undefined : Number(e.target.value) })
                          }
                        />
                        <span className="shrink-0">(끝 미포함 · 서식을 골라 뽑을 때 씀)</span>
                      </div>
                    </div>

                    <div className="p-2 flex flex-col gap-2">
                      {d.slots.length === 0 && (
                        <p className="text-[12px] cd-text-faint py-3 text-center">
                          자리가 없습니다. 저장하면 이 서식은 사라집니다.
                        </p>
                      )}
                      {d.slots.map((s) => {
                        const bad = s.target === "para" && !s.label?.trim() && !s.suffix?.trim();
                        const custom = s.binding.startsWith("custom:");
                        // 착수계에서는 준공 항목이 목록에 없다 — 기존 매핑이 그런 값이면 옵션을 살려 둔다(무단 유실 방지).
                        const orphan = !custom && !!s.binding && !bindings.some((b) => b.key === s.binding);
                        return (
                          <div
                            key={s.uid}
                            className={`rounded-xl border p-2.5 flex flex-col gap-2 ${
                              s.uid === selected ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-[11.5px] cd-text-primary shrink-0 underline-offset-2 hover:underline"
                                onClick={() => revealInSource(s)}
                              >
                                {s.target === "cell" ? `표 ${s.table} · ${s.row}행 ${s.col}열` : `문단 ${s.para}`}
                              </button>
                              <select
                                className="cd-input text-[12px] flex-1 min-w-0"
                                value={custom ? "__custom" : s.binding}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updateSlot(s.uid, { binding: v === "__custom" ? "custom:" : v });
                                }}
                              >
                                <option value="">(값 없음 — 지정하세요)</option>
                                {orphan && <option value={s.binding}>{BINDING_LABEL[s.binding] ?? s.binding}</option>}
                                {groups.map((g) => (
                                  <optgroup key={g} label={g}>
                                    {bindings
                                      .filter((b) => b.group === g)
                                      .map((b) => (
                                        <option key={b.key} value={b.key}>
                                          {b.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                ))}
                                <option value="__custom">직접 입력(사용자가 값을 채움)</option>
                              </select>
                              <button
                                type="button"
                                className="cd-btn rounded-lg border cd-border-c p-1.5 shrink-0"
                                title="자리 삭제"
                                onClick={() => removeSlot(s.uid)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {custom && (
                              <input
                                className="cd-input text-[12px]"
                                placeholder="직접 입력 항목 이름 (예: custom:orderNo)"
                                value={s.binding}
                                onChange={(e) => updateSlot(s.uid, { binding: e.target.value })}
                              />
                            )}

                            <div className="flex gap-2">
                              <input
                                className="cd-input text-[12px] flex-1 min-w-0"
                                placeholder={s.target === "cell" ? "표시용 이름(선택)" : "라벨 — 값 앞에 인쇄된 문구"}
                                value={s.label ?? ""}
                                onChange={(e) => updateSlot(s.uid, { label: e.target.value })}
                              />
                              {s.target === "para" && (
                                <input
                                  className="cd-input text-[12px]"
                                  style={{ width: "7rem" }}
                                  placeholder="접미어"
                                  value={s.suffix ?? ""}
                                  onChange={(e) => updateSlot(s.uid, { suffix: e.target.value || undefined })}
                                />
                              )}
                            </div>

                            {bad && (
                              <p className="text-[11px] cd-error-text flex items-center gap-1.5">
                                <TriangleAlert className="w-3.5 h-3.5 shrink-0" /> 라벨이나 접미어 중 하나는 있어야 값 범위를
                                정할 수 있습니다. 비워 두면 저장할 때 빠집니다.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="pt-1">
                <label className="text-[11.5px] cd-text-faint">메모(확인이 필요한 점)</label>
                <textarea
                  className="cd-input text-[12px] mt-1"
                  rows={2}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
