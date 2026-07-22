"use client";

// 전자결재 양식 관리(빌더) — 다우식 캔버스형 편집기:
// 좌측 필드 팔레트(클릭=맨 아래 추가, 드래그=원하는 위치 삽입) + 실제 양식 모양 캔버스
// (필드 클릭 선택·드래그 이동·행 사이 드롭존 삽입) + 우측 선택 필드 속성 패널.
// 배치는 행(row)×폭(span 1~3) 그리드에 스냅 — 자유롭게 움직여도 정렬이 항상 맞는다.
// 모든 입력 요소는 field_key 스키마로 정의되어 문서 값이 구조화 저장된다(핵심 원칙).
// 설계: docs/e-approval-blueprint.md §2·§3·§5-5.

import { useEffect, useMemo, useState } from "react";
import {
  AlignLeft,
  Building2,
  Calendar,
  CalendarCheck2,
  CalendarRange,
  CheckSquare,
  ClipboardCheck,
  CircleDot,
  Clock,
  Coins,
  Eye,
  FileSignature,
  FolderOpen,
  Hash,
  Info,
  List,
  Pencil,
  Plus,
  Save,
  Table2,
  Trash2,
  Type,
  User,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalFormRenderer } from "@/components/approval/ApprovalFormRenderer";
import { FILL_SOURCES, type ApprovalFieldDef, type ApprovalFieldType, type ApprovalTableColumn } from "@/lib/approval/fields";
import "@/components/cdash/cdash.css";

interface FolderRow {
  folderId: string;
  name: string;
  sortOrder: number;
}

interface FormRow {
  formId: string;
  folderId: string | null;
  name: string;
  description: string | null;
  fields: ApprovalFieldDef[];
  docNoRule: string | null;
  retentionYears: number | null;
  orgFolder: string | null;
  deptFolder: string | null;
  useYn: boolean;
  version: number;
  updatedAt: string;
}

const FIELD_TYPE_LABEL: Record<ApprovalFieldType, string> = {
  text: "텍스트",
  multitext: "여러 줄",
  number: "숫자",
  currency: "금액",
  select: "드롭박스",
  radio: "옵션(단일)",
  checkbox: "체크(복수)",
  date: "날짜",
  time: "시간",
  period: "기간",
  user_select: "사용자",
  dept_select: "부서",
  company_select: "업체 검색",
  contract_select: "계약 검색",
  leave_type: "휴가 종류",
  table: "표(반복 행)",
  static: "안내문",
};

const PALETTE: { type: ApprovalFieldType; icon: LucideIcon }[] = [
  { type: "text", icon: Type },
  { type: "multitext", icon: AlignLeft },
  { type: "number", icon: Hash },
  { type: "currency", icon: Coins },
  { type: "select", icon: List },
  { type: "radio", icon: CircleDot },
  { type: "checkbox", icon: CheckSquare },
  { type: "date", icon: Calendar },
  { type: "time", icon: Clock },
  { type: "period", icon: CalendarRange },
  { type: "user_select", icon: User },
  { type: "dept_select", icon: Users },
  { type: "company_select", icon: Building2 },
  { type: "contract_select", icon: FileSignature },
  { type: "leave_type", icon: CalendarCheck2 },
  { type: "table", icon: Table2 },
  { type: "static", icon: Info },
];

const NEW_FORM: FormRow = {
  formId: "",
  folderId: null,
  name: "",
  description: null,
  fields: [{ key: "field_1", label: "항목 1", type: "text", row: 1, span: 3 }],
  docNoRule: null,
  retentionYears: 3,
  orgFolder: null,
  deptFolder: null,
  useYn: true,
  version: 1,
  updatedAt: "",
};

/* ---------- 행 그리드 모델 유틸 ---------- */
type RowsModel = ApprovalFieldDef[][];

function toRows(fields: ApprovalFieldDef[]): RowsModel {
  const map = new Map<number, ApprovalFieldDef[]>();
  for (const f of fields) map.set(f.row, [...(map.get(f.row) ?? []), f]);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, fs]) => fs);
}
function fromRows(rows: RowsModel): ApprovalFieldDef[] {
  return rows.filter((r) => r.length > 0).flatMap((r, i) => r.map((f) => ({ ...f, row: i + 1 })));
}

function makeField(type: ApprovalFieldType, existing: ApprovalFieldDef[], span: number): ApprovalFieldDef {
  const keys = new Set(existing.map((f) => f.key));
  let n = existing.length + 1;
  while (keys.has(`field_${n}`)) n += 1;
  const base: ApprovalFieldDef = { key: `field_${n}`, label: FIELD_TYPE_LABEL[type], type, row: 1, span };
  if (["select", "radio", "checkbox"].includes(type)) base.options = ["옵션 1", "옵션 2"];
  if (type === "static") {
    base.label = "안내";
    base.content = "안내문 내용을 입력하세요.";
  }
  if (type === "table") {
    base.tableColumns = [
      { key: "col_1", label: "열 1", type: "text" },
      { key: "col_2", label: "열 2", type: "text" },
    ];
    base.minRows = 2;
  }
  return base;
}

/** 드래그 페이로드 — 팔레트 신규(type) 또는 캔버스 내 이동(key) */
type DragItem = { kind: "new"; type: ApprovalFieldType } | { kind: "move"; key: string };

export default function ApprovalFormsBoard() {
  const { theme } = useCdashTheme();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormRow | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragItem | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/approval/forms?all=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "양식 목록을 불러오지 못했습니다.");
      setFolders(data.folders ?? []);
      setForms(data.forms ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const byFolder = new Map<string, FormRow[]>();
    for (const f of forms) {
      const k = f.folderId ?? "__none__";
      byFolder.set(k, [...(byFolder.get(k) ?? []), f]);
    }
    return byFolder;
  }, [forms]);

  const rows = useMemo(() => (draft ? toRows(draft.fields) : []), [draft]);
  const selected = draft?.fields.find((f) => f.key === selectedKey) ?? null;

  const setFields = (next: ApprovalFieldDef[]) => setDraft((prev) => (prev ? { ...prev, fields: next } : prev));

  const patchSelected = (patch: Partial<ApprovalFieldDef>) => {
    if (!draft || !selectedKey) return;
    setFields(draft.fields.map((f) => (f.key === selectedKey ? { ...f, ...patch } : f)));
    if (patch.key && patch.key !== selectedKey) setSelectedKey(patch.key);
  };

  /** 드롭 처리 — target: 행 사이(newRowAt) 또는 특정 필드 뒤(afterKey, 같은 행) */
  const handleDrop = (target: { newRowAt?: number; afterKey?: string }) => {
    if (!draft || !drag) return;
    let moving: ApprovalFieldDef | null = null;
    let working = draft.fields;
    if (drag.kind === "move") {
      moving = working.find((f) => f.key === drag.key) ?? null;
      if (!moving) return;
      if (drag.key === target.afterKey) {
        setDrag(null);
        return;
      }
      working = working.filter((f) => f.key !== drag.key);
    }
    const model = toRows(working);
    if (target.newRowAt != null) {
      const nf: ApprovalFieldDef =
        drag.kind === "move" ? { ...moving!, span: moving!.span ?? 3 } : makeField(drag.type, working, 3);
      model.splice(target.newRowAt, 0, [nf]);
      setFields(fromRows(model));
      setSelectedKey(nf.key);
    } else if (target.afterKey) {
      const nf: ApprovalFieldDef =
        drag.kind === "move" ? { ...moving!, span: moving!.span ?? 1 } : makeField(drag.type, working, 1);
      outer: for (const r of model) {
        for (let i = 0; i < r.length; i++) {
          if (r[i].key === target.afterKey) {
            r.splice(i + 1, 0, nf);
            break outer;
          }
        }
      }
      setFields(fromRows(model));
      setSelectedKey(nf.key);
    }
    setDrag(null);
  };

  const addAtEnd = (type: ApprovalFieldType) => {
    if (!draft) return;
    const nf = makeField(type, draft.fields, 3);
    const model = toRows(draft.fields);
    model.push([nf]);
    setFields(fromRows(model));
    setSelectedKey(nf.key);
    setPreview(false);
  };

  const removeSelected = () => {
    if (!draft || !selectedKey) return;
    setFields(fromRows(toRows(draft.fields.filter((f) => f.key !== selectedKey))));
    setSelectedKey(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/approval/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formId: draft.formId || null,
          folderId: draft.folderId,
          name: draft.name,
          description: draft.description,
          fields: draft.fields,
          docNoRule: draft.docNoRule,
          retentionYears: draft.retentionYears,
          orgFolder: draft.orgFolder,
          deptFolder: draft.deptFolder,
          useYn: draft.useYn,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setDraft(data.form);
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        eyebrow="Approval · Forms"
        title="전자결재 양식 관리"
        subtitle="좌측 팔레트의 항목을 캔버스로 끌어 배치합니다. 모든 항목은 필드 키를 가진 스키마로 저장되어, 제출 문서의 값이 분류·정렬·집계 가능한 데이터로 쌓입니다."
      />

      {error && <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>}

      <div className="flex flex-col xl:flex-row gap-4 items-start min-h-0">
        {/* 양식 목록 */}
        <div className="cd-card rounded-3xl p-5 w-full xl:w-[260px] shrink-0 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold cd-text text-sm">양식 목록</h3>
            <button
              type="button"
              className="cd-btn rounded-lg px-2.5 py-1.5 text-[11.5px] border cd-border-c flex items-center gap-1"
              onClick={() => {
                setDraft({ ...NEW_FORM, folderId: folders[0]?.folderId ?? null });
                setSelectedKey(null);
                setPreview(false);
              }}
            >
              <Plus className="w-3.5 h-3.5" /> 새 양식
            </button>
          </div>
          {loading ? (
            <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
          ) : (
            [...folders, { folderId: "__none__", name: "미분류", sortOrder: 999 }].map((fold) => {
              const list = grouped.get(fold.folderId) ?? [];
              if (!list.length) return null;
              return (
                <div key={fold.folderId}>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold cd-text-faint mb-1">
                    <FolderOpen className="w-3.5 h-3.5" /> {fold.name}
                  </div>
                  <div className="flex flex-col gap-1 mb-2">
                    {list.map((f) => (
                      <button
                        key={f.formId}
                        type="button"
                        onClick={() => {
                          setDraft(JSON.parse(JSON.stringify(f)));
                          setSelectedKey(null);
                          setPreview(false);
                          setSavedAt(null);
                        }}
                        className={`text-left rounded-xl border px-3 py-2 text-[12.5px] flex items-center gap-2 ${
                          draft?.formId === f.formId
                            ? "cd-tint-primary border-transparent"
                            : "cd-border-c cd-text hover:bg-[color:var(--cd-surface)]"
                        }`}
                      >
                        <span className="truncate flex-1">{f.name}</span>
                        <span className="text-[10px] cd-text-faint shrink-0">v{f.version}</span>
                        {!f.useYn && (
                          <span className="text-[10px] rounded-full px-1.5 py-0.5 border cd-border-c cd-text-faint shrink-0">중지</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 편집기 */}
        <div className="cd-card rounded-3xl p-5 flex-1 min-w-0 flex flex-col gap-4">
          {!draft ? (
            <p className="text-sm cd-text-faint py-10 text-center">
              좌측에서 양식을 선택하거나 새 양식을 만드세요. 시드된 5종(출장신청·출장보고·초과근무·지출결의·휴가신청)을 여기서 수정할 수 있습니다.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold cd-text flex items-center gap-2">
                  <Pencil className="w-4 h-4 cd-text-primary" />
                  {draft.formId ? `양식 편집 — ${draft.name || "(이름 없음)"}` : "새 양식"}
                  {draft.formId && (
                    <span className="text-[11px] font-normal cd-text-faint">v{draft.version} · 필드 변경 저장 시 버전 증가</span>
                  )}
                </h3>
                <div className="ml-auto flex items-center gap-2">
                  {savedAt && <span className="text-[11px] cd-text-faint">저장됨 {savedAt}</span>}
                  <button
                    type="button"
                    className={`cd-btn rounded-lg px-3 py-1.5 text-xs border cd-border-c flex items-center gap-1.5 ${
                      preview ? "cd-tint-primary border-transparent" : ""
                    }`}
                    onClick={() => setPreview((p) => !p)}
                  >
                    <Eye className="w-3.5 h-3.5" /> 미리보기
                  </button>
                  <button
                    type="button"
                    className="cd-btn cd-btn-primary rounded-lg px-3.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                    disabled={saving || !draft.name.trim()}
                    onClick={save}
                  >
                    <Save className="w-3.5 h-3.5 inline mr-1" />
                    {saving ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>

              {/* 기본 속성 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                  양식 이름
                  <input className="cd-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                  폴더
                  <select
                    className="cd-select"
                    style={{ width: "100%" }}
                    value={draft.folderId ?? ""}
                    onChange={(e) => setDraft({ ...draft, folderId: e.target.value || null })}
                  >
                    <option value="">미분류</option>
                    {folders.map((f) => (
                      <option key={f.folderId} value={f.folderId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                  문서번호 약칭 (예: 출장신청-2026-0001)
                  <input
                    className="cd-input"
                    value={draft.docNoRule ?? ""}
                    onChange={(e) => setDraft({ ...draft, docNoRule: e.target.value || null })}
                  />
                </label>
                <label className="text-[11px] cd-text-faint flex flex-col gap-1">
                  보존연한(년) / 사용
                  <span className="flex items-center gap-2">
                    <input
                      className="cd-input"
                      style={{ width: 70 }}
                      inputMode="numeric"
                      value={draft.retentionYears ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, retentionYears: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })
                      }
                    />
                    <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer">
                      <input type="checkbox" checked={draft.useYn} onChange={(e) => setDraft({ ...draft, useYn: e.target.checked })} /> 사용
                    </label>
                  </span>
                </label>
              </div>

              {preview ? (
                <div className="rounded-2xl border cd-border-c p-4">
                  <p className="text-[11px] cd-text-faint mb-3">기안 화면 미리보기 — 값 입력을 테스트할 수 있습니다(저장되지 않음).</p>
                  <ApprovalFormRenderer
                    fields={draft.fields}
                    header={{ drafterName: "홍길동", deptName: "영업관리본부", draftDate: new Date().toISOString().slice(0, 10) }}
                  />
                </div>
              ) : (
                <div className="flex flex-col lg:flex-row gap-3 items-start">
                  {/* 필드 팔레트 */}
                  <div className="w-full lg:w-[128px] shrink-0 rounded-2xl border cd-border-c p-2 grid grid-cols-4 lg:grid-cols-2 gap-1.5">
                    {PALETTE.map(({ type, icon: Icon }) => (
                      <button
                        key={type}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          setDrag({ kind: "new", type });
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onDragEnd={() => setDrag(null)}
                        onClick={() => addAtEnd(type)}
                        title={`${FIELD_TYPE_LABEL[type]} — 클릭하면 맨 아래에 추가, 끌어서 원하는 위치에 삽입`}
                        className="rounded-xl border cd-border-c px-1 py-2 flex flex-col items-center gap-1 text-[10px] cd-text-muted hover:cd-text hover:border-[color:var(--cd-primary)] cursor-grab active:cursor-grabbing"
                      >
                        <Icon className="w-4 h-4" />
                        {FIELD_TYPE_LABEL[type]}
                      </button>
                    ))}
                  </div>

                  {/* 캔버스 — 실제 양식 모양 위에서 선택·드래그 배치 */}
                  <div className="flex-1 min-w-0">
                    <div className="rounded-xl border cd-border-c overflow-hidden">
                      <RowGap index={0} active={!!drag} onDrop={() => handleDrop({ newRowAt: 0 })} />
                      {rows.map((rowFields, ri) => (
                        <div key={ri}>
                          <div className="flex flex-col md:flex-row border-t cd-border-c">
                            {rowFields.map((f) => (
                              <CanvasCell
                                key={f.key}
                                field={f}
                                selected={selectedKey === f.key}
                                dragging={!!drag}
                                onSelect={() => setSelectedKey(f.key)}
                                onDragStart={() => setDrag({ kind: "move", key: f.key })}
                                onDragEnd={() => setDrag(null)}
                                onDropAfter={() => handleDrop({ afterKey: f.key })}
                              />
                            ))}
                          </div>
                          <RowGap index={ri + 1} active={!!drag} onDrop={() => handleDrop({ newRowAt: ri + 1 })} />
                        </div>
                      ))}
                      {rows.length === 0 && (
                        <p className="p-6 text-sm cd-text-faint text-center">팔레트에서 항목을 끌어오거나 클릭해 추가하세요.</p>
                      )}
                    </div>
                    <p className="text-[10.5px] cd-text-faint mt-1.5">
                      항목 클릭 = 선택·속성 편집 · 끌기 = 위치 이동 · 행 경계선의 파란 띠 = 새 행으로 삽입 · 항목 위에 놓으면 그 항목 오른쪽(같은 행)에 배치
                    </p>
                  </div>

                  {/* 속성 패널 */}
                  <div className="w-full lg:w-[300px] shrink-0">
                    {selected ? (
                      <FieldProps
                        field={selected}
                        onChange={patchSelected}
                        onRemove={removeSelected}
                        allFields={draft.fields}
                      />
                    ) : (
                      <div className="rounded-2xl border border-dashed cd-border-c p-4 text-[12px] cd-text-faint">
                        캔버스에서 항목을 클릭하면 여기서 라벨·필드 키·옵션·폭 등을 편집할 수 있습니다.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- 캔버스 셀 ---------- */
function CanvasCell({
  field: f,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  onDropAfter,
}: {
  field: ApprovalFieldDef;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropAfter: () => void;
}) {
  const [over, setOver] = useState(false);
  const span = Math.max(1, Math.min(3, f.span ?? 1));
  return (
    <div
      draggable
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropAfter();
      }}
      onClick={onSelect}
      className={`flex min-w-0 border-l first:border-l-0 cd-border-c cursor-grab active:cursor-grabbing select-none ${
        selected ? "ring-2 ring-inset ring-[color:var(--cd-primary)]" : ""
      } ${over ? "border-r-4 border-r-[color:var(--cd-primary)]" : ""}`}
      style={{ flex: span }}
      title="클릭 = 속성 편집 · 끌기 = 이동"
    >
      {f.type === "static" ? (
        <div className="px-3 py-2.5 text-[11.5px] cd-text-faint whitespace-pre-wrap flex-1">{f.content ?? ""}</div>
      ) : (
        <>
          <div className="w-28 shrink-0 px-2.5 py-2.5 text-[12px] font-bold cd-surface-bg cd-text flex items-center">
            <span className="truncate">
              {f.required && <span className="text-[color:var(--cd-danger,#FA896B)] mr-0.5">*</span>}
              {f.label}
            </span>
          </div>
          <div className="flex-1 min-w-0 px-2.5 py-2 flex items-center gap-1.5">
            <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary shrink-0">{FIELD_TYPE_LABEL[f.type]}</span>
            <span className="text-[11px] cd-text-faint font-mono truncate">{f.key}</span>
            {f.type === "table" && (
              <span className="text-[10.5px] cd-text-faint truncate">{(f.tableColumns ?? []).map((c) => c.label).join("·")}</span>
            )}
            {["select", "radio", "checkbox"].includes(f.type) && (
              <span className="text-[10.5px] cd-text-faint truncate">{(f.options ?? []).join("/")}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* 행 사이 드롭존 — 드래그 중에만 도톰해지는 파란 띠 */
function RowGap({ index, active, onDrop }: { index: number; active: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false);
  if (!active) return <div className="h-0" data-gap={index} />;
  return (
    <div
      data-gap={index}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`transition-all ${over ? "h-7 bg-[color:var(--cd-primary)]/20 border-2 border-dashed border-[color:var(--cd-primary)]" : "h-2.5 bg-[color:var(--cd-primary)]/8"}`}
    />
  );
}

/* ---------- 선택 필드 속성 패널 ---------- */
function FieldProps({
  field: f,
  onChange,
  onRemove,
  allFields,
}: {
  field: ApprovalFieldDef;
  onChange: (patch: Partial<ApprovalFieldDef>) => void;
  onRemove: () => void;
  allFields: ApprovalFieldDef[];
}) {
  const hasOptions = ["select", "radio", "checkbox"].includes(f.type);
  const dupKey = allFields.filter((x) => x.key === f.key).length > 1;
  return (
    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-bold cd-text">선택 항목 속성</span>
        <button
          type="button"
          className="ml-auto cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] flex items-center gap-1 text-[11.5px]"
          onClick={onRemove}
        >
          <Trash2 className="w-3.5 h-3.5" /> 삭제
        </button>
      </div>
      <label className="text-[11px] cd-text-faint flex flex-col gap-1">
        종류
        <select
          className="cd-select"
          style={{ width: "100%" }}
          value={f.type}
          onChange={(e) => onChange({ type: e.target.value as ApprovalFieldType })}
        >
          {Object.entries(FIELD_TYPE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {f.type !== "static" && (
        <label className="text-[11px] cd-text-faint flex flex-col gap-1">
          라벨
          <input className="cd-input" value={f.label} onChange={(e) => onChange({ label: e.target.value })} />
        </label>
      )}
      <label className="text-[11px] cd-text-faint flex flex-col gap-1">
        필드 키 (구조화 저장 키 — 영문 소문자·숫자·_)
        <input
          className={`cd-input font-mono ${dupKey ? "border-[color:var(--cd-danger,#FA896B)]" : ""}`}
          value={f.key}
          onChange={(e) => onChange({ key: e.target.value })}
        />
        {dupKey && <span className="text-[10.5px] text-[color:var(--cd-danger,#FA896B)]">키가 중복됩니다.</span>}
      </label>
      <div className="flex items-center gap-3">
        <label className="text-[11px] cd-text-faint flex items-center gap-1.5">
          폭
          <select className="cd-select" style={{ width: 60 }} value={f.span ?? 1} onChange={(e) => onChange({ span: Number(e.target.value) })}>
            {[1, 2, 3].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span title="같은 행 항목들과의 폭 비중(1~3)">/ 행 내 비중</span>
        </label>
        {f.type !== "static" && (
          <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer ml-auto">
            <input type="checkbox" checked={f.required === true} onChange={(e) => onChange({ required: e.target.checked })} /> 필수
          </label>
        )}
      </div>
      {hasOptions && (
        <label className="text-[11px] cd-text-faint flex flex-col gap-1">
          옵션(콤마로 구분)
          <textarea
            className="cd-input text-[12px] min-h-[52px]"
            value={(f.options ?? []).join(", ")}
            onChange={(e) => onChange({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
        </label>
      )}
      {["text", "multitext", "number"].includes(f.type) && (
        <label className="text-[11px] cd-text-faint flex flex-col gap-1">
          입력 안내(placeholder)
          <input className="cd-input text-[12px]" value={f.placeholder ?? ""} onChange={(e) => onChange({ placeholder: e.target.value || undefined })} />
        </label>
      )}
      {f.type === "static" && (
        <label className="text-[11px] cd-text-faint flex flex-col gap-1">
          안내문 내용
          <textarea className="cd-input text-[12px] min-h-[84px]" value={f.content ?? ""} onChange={(e) => onChange({ content: e.target.value })} />
        </label>
      )}
      {f.type === "user_select" && (
        <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer">
          <input type="checkbox" checked={f.multiple === true} onChange={(e) => onChange({ multiple: e.target.checked })} />
          복수 인원 선택 허용(동행자 등)
        </label>
      )}
      {(f.type === "company_select" || f.type === "contract_select") && (
        <FillMapEditor field={f} onChange={onChange} allFields={allFields} />
      )}
      {f.type === "leave_type" && (
        <p className="text-[11px] cd-text-faint rounded-lg border border-dashed cd-border-c p-2.5">
          휴가 종류·부여일수는 사규 경조 규정 카탈로그에서 자동 제공됩니다(옵션 편집 불필요). 선택 시 부여 휴가일수가 표시되고, 연차·반차만 연차 대장에서 차감됩니다.
        </p>
      )}
      {f.type === "table" && <TableColumnsEditor field={f} onChange={onChange} />}
    </div>
  );
}

/** 자동 채움 규칙 편집 — 검색 필드 선택 시 [소스 속성 → 대상 필드] 로 값을 주입한다. */
function FillMapEditor({
  field: f,
  onChange,
  allFields,
}: {
  field: ApprovalFieldDef;
  onChange: (patch: Partial<ApprovalFieldDef>) => void;
  allFields: ApprovalFieldDef[];
}) {
  const sources = FILL_SOURCES[f.type] ?? [];
  const rules = f.fillMap ?? [];
  const targets = allFields.filter(
    (x) => x.key !== f.key && ["text", "multitext", "number", "currency", "select", "date"].includes(x.type)
  );
  const setRule = (i: number, patch: Partial<{ source: string; target: string }>) =>
    onChange({ fillMap: rules.map((r, x) => (x === i ? { ...r, ...patch } : r)) });
  return (
    <div className="rounded-lg border border-dashed cd-border-c p-2.5 flex flex-col gap-1.5">
      <span className="text-[11px] cd-text-faint">자동 채움 — 선택 시 다른 필드에 값 주입</span>
      {rules.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select className="cd-select" style={{ width: 110 }} value={r.source} onChange={(e) => setRule(i, { source: e.target.value })}>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] cd-text-faint shrink-0">→</span>
          <select className="cd-select flex-1" style={{ width: "auto" }} value={r.target} onChange={(e) => setRule(i, { target: e.target.value })}>
            <option value="">대상 필드 선택</option>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} ({t.key})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
            title="규칙 삭제"
            onClick={() => onChange({ fillMap: rules.filter((_, x) => x !== i) })}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-[11.5px] cd-text-primary flex items-center gap-1 self-start"
        onClick={() => onChange({ fillMap: [...rules, { source: sources[0]?.key ?? "", target: "" }] })}
      >
        <Plus className="w-3.5 h-3.5" /> 규칙 추가
      </button>
    </div>
  );
}

function TableColumnsEditor({
  field: f,
  onChange,
}: {
  field: ApprovalFieldDef;
  onChange: (patch: Partial<ApprovalFieldDef>) => void;
}) {
  const cols = f.tableColumns ?? [];
  const setCol = (i: number, patch: Partial<ApprovalTableColumn>) =>
    onChange({ tableColumns: cols.map((c, x) => (x === i ? { ...c, ...patch } : c)) });
  return (
    <div className="rounded-lg border border-dashed cd-border-c p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[11px] cd-text-faint">
        표 하위 열
        <span className="ml-auto flex items-center gap-1.5">
          최소 행
          <input
            className="cd-input"
            style={{ width: 44 }}
            inputMode="numeric"
            value={f.minRows ?? 1}
            onChange={(e) => onChange({ minRows: Number(e.target.value.replace(/\D/g, "")) || 1 })}
          />
        </span>
      </div>
      {cols.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-wrap">
          <input className="cd-input font-mono" style={{ width: 84 }} placeholder="col_key" value={c.key} onChange={(e) => setCol(i, { key: e.target.value })} />
          <input className="cd-input flex-1 min-w-[80px]" placeholder="열 라벨" value={c.label} onChange={(e) => setCol(i, { label: e.target.value })} />
          <select className="cd-select" style={{ width: 82 }} value={c.type} onChange={(e) => setCol(i, { type: e.target.value })}>
            {["text", "date", "select", "number", "currency"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
            title="열 삭제"
            onClick={() => onChange({ tableColumns: cols.filter((_, x) => x !== i) })}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {c.type === "select" && (
            <input
              className="cd-input text-[12px] w-full"
              placeholder="옵션(콤마)"
              value={(c.options ?? []).join(", ")}
              onChange={(e) => setCol(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-[11.5px] cd-text-primary flex items-center gap-1"
          onClick={() => onChange({ tableColumns: [...cols, { key: `col_${cols.length + 1}`, label: `열 ${cols.length + 1}`, type: "text" }] })}
        >
          <Plus className="w-3.5 h-3.5" /> 열 추가
        </button>
        <label className="ml-auto text-[11px] cd-text-faint flex items-center gap-1.5">
          합계 열
          <select className="cd-select" style={{ width: 96 }} value={f.sumColumn ?? ""} onChange={(e) => onChange({ sumColumn: e.target.value || undefined })}>
            <option value="">없음</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
