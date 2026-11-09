"use client";

// 고정 결재선(335, 결재 운영) — 양식별 결재 단계(역할)·역할 담당자(대표이사·관리자·부서별 임원)·임원 취급 인원을 관리하고,
// 재직자별로 결재선이 실제로 누구로 풀리는지 미리 본다. 기안 화면은 이 규칙으로 결재선을 잠그고 서버도 같은 규칙으로 강제한다.
// 모든 양식 고정 참조·열람자(346)도 같은 카드에서 정한다 — 저장·상신 때 서버가 문서에 넣는다.
// 설계: docs/approval-fixed-line-plan-2026-11-03.md.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput, CdSelect } from "@/components/cdash/CdField";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { LINE_ROLE_LABELS, LINE_ROLES, type LineEnforceWhen, type LineRole, type LineTemplateStep } from "@/lib/approval/fixed-line-rules";
import "@/components/cdash/cdash.css";

type RoleKey = "ceo" | "exec" | "manager" | "exec_member";

interface TemplateRow {
  formId: string;
  formName: string;
  steps: LineTemplateStep[];
  enforceWhen: LineEnforceWhen | null;
  enabled: boolean;
}

interface RoleUserRow {
  entryId: string;
  role: RoleKey;
  deptId: string;
  deptName: string | null;
  userId: string;
  userName: string | null;
  active: boolean;
}

interface PreviewRow {
  userId: string;
  name: string;
  deptName: string | null;
  lines: Record<string, { ok: boolean; text: string }>;
}

interface FixedWatcherRow {
  entryId: string;
  formId: string;
  userId: string;
  userName: string | null;
  kind: "ref" | "view";
  active: boolean;
}

interface Snapshot {
  ready: boolean;
  templates: TemplateRow[];
  roleUsers: RoleUserRow[];
  departments: Array<{ deptId: string; deptName: string }>;
  preview?: PreviewRow[];
  /** 고정 참조·열람자(346) — 표가 없으면 watchersReady=false */
  watchersReady?: boolean;
  fixedWatchers?: FixedWatcherRow[];
}

/** 조직도 선택 대상 — 역할 담당자 지정 또는 편집 중 단계의 지정 대결자 추가 */
type PickTarget =
  | { kind: "role"; role: RoleKey; deptId: string }
  | { kind: "proxy"; stepIndex: number }
  | { kind: "watcher"; watchKind: "ref" | "view" };

function stepsText(steps: LineTemplateStep[]): string {
  return steps.length ? steps.map((s) => LINE_ROLE_LABELS[s.role]).join(" → ") : "자유 지정";
}

export function ApprovalFixedLinesBoard() {
  const { theme } = useCdashTheme();
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickTarget | null>(null);
  const [execDept, setExecDept] = useState("");
  // 편집 중 템플릿(한 번에 하나)
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewForm, setPreviewForm] = useState("");

  const load = useCallback(async (withPreview = true) => {
    setError(null);
    try {
      const res = await fetch(`/api/approval/fixed-lines${withPreview ? "?preview=1" : ""}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "불러오지 못했습니다.");
      setData((prev) => ({ ...d, preview: d.preview ?? prev?.preview }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (method: "PUT" | "DELETE", body: unknown, url = "/api/approval/fixed-lines", done = "저장했습니다.") => {
    setMsg(null);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PUT" ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "저장하지 못했습니다.");
      setMsg(done);
      await load();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const roleUsers = data?.roleUsers ?? [];
  const defaultOf = (role: RoleKey) => roleUsers.find((r) => r.role === role && r.deptId === "*") ?? null;
  const deptExecs = roleUsers.filter((r) => r.role === "exec" && r.deptId !== "*");
  const execMembers = roleUsers.filter((r) => r.role === "exec_member");
  const allFormWatchers = (data?.fixedWatchers ?? []).filter((w) => w.formId === "*");
  const templates = data?.templates ?? [];
  const fixedTemplates = templates.filter((t) => t.steps.length > 0);
  const previewFormId = previewForm || fixedTemplates[0]?.formId || "";
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roleUsers) if (r.userName) m.set(r.userId, r.userName);
    for (const p of data?.preview ?? []) m.set(p.userId, p.name);
    return m;
  }, [roleUsers, data?.preview]);

  const saveEditing = async () => {
    if (!editing) return;
    const ok = await call(
      "PUT",
      { kind: "template", formId: editing.formId, steps: editing.steps, enforceWhen: editing.enforceWhen, enabled: editing.enabled },
      undefined,
      editing.steps.length ? `'${editing.formName}' 결재선을 저장했습니다.` : `'${editing.formName}'을 자유 지정으로 되돌렸습니다.`
    );
    if (ok) setEditing(null);
  };

  const updateStep = (i: number, patch: Partial<LineTemplateStep>) =>
    setEditing((prev) => (prev ? { ...prev, steps: prev.steps.map((s, si) => (si === i ? { ...s, ...patch } : s)) } : prev));
  const moveStep = (i: number, d: -1 | 1) =>
    setEditing((prev) => {
      if (!prev) return prev;
      const j = i + d;
      if (j < 0 || j >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...prev, steps };
    });

  const roleCell = (role: RoleKey, label: string, hint: string) => {
    const row = defaultOf(role);
    return (
      <tr className="border-t cd-border-c">
        <td className="py-2 pr-3 cd-text font-semibold whitespace-nowrap">{label}</td>
        <td className="py-2 pr-3 cd-text">
          {row ? (
            <>
              {row.userName ?? row.userId}
              {!row.active && <span className="cd-error-text text-[11px]"> (퇴사·계정 없음 — 다시 지정하세요)</span>}
            </>
          ) : (
            <span className="cd-error-text">미지정</span>
          )}
          <span className="block text-[11px] cd-text-faint">{hint}</span>
        </td>
        <td className="py-2 text-right">
          <CdButton size="sm" disabled={!data?.ready} onClick={() => setPicker({ kind: "role", role, deptId: "*" })}>
            {row ? "변경" : "지정"}
          </CdButton>
        </td>
      </tr>
    );
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-lg overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<Lock className="w-5 h-5" />}
        eyebrow="Approval · Fixed lines"
        title="고정 결재선"
        help="양식마다 결재 단계를 역할(부서장·임원·대표이사·관리자)로 정해 두면, 기안 화면이 기안자 소속에 맞는 사람으로 결재선을 채우고 바꿀 수 없게 잠급니다. 서버도 같은 규칙으로 저장·상신을 강제합니다. 기안자 본인 자리의 단계는 빠지고 다음 단계로 올라갑니다. 결재자를 찾지 못하면(부서장 공석 등) 상신이 막히고 이유가 표시됩니다. 사람이 바뀌면 여기서 담당자를 바꾸고, 부서장은 직원 상세의 '겸직·부서장 보직'에서 바꿉니다."
      />

      {data && !data.ready && (
        <div className="cd-card rounded-lg p-4 text-[13px] cd-error-text">
          고정 결재선 표(마이그레이션 335)가 아직 적용되지 않아 모든 양식이 자유 지정으로 동작합니다.
        </div>
      )}
      {msg && <p className="text-[12px] cd-text">{msg}</p>}
      {error && <p className="text-[12px] cd-error-text">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-2">
        {/* 역할 담당자 */}
        <div className="cd-card rounded-lg p-5 flex flex-col gap-3">
          <h2 className="text-[14px] font-semibold cd-text">역할 담당자</h2>
          <table className="w-full text-[13px]">
            <tbody>
              {roleCell("ceo", "대표이사", "대표이사 단계의 결재자. 대표이사 본인 기안은 관리자 양식 외에는 본인 1단계입니다.")}
              {roleCell("manager", "관리자", "관리자 단계의 결재자(지출 결의서 등). 본인이 기안하면 양식에 정한 대체 역할로 올라갑니다.")}
              {roleCell("exec", "임원(기본)", "부서별 임원을 따로 정하지 않은 부서의 임원 단계 결재자.")}
            </tbody>
          </table>

          <h3 className="text-[13px] font-semibold cd-text mt-2">부서별 임원</h3>
          {deptExecs.length === 0 ? (
            <p className="text-[12px] cd-text-faint">없음 — 모든 부서가 기본 임원을 씁니다.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {deptExecs.map((r) => (
                <li key={r.entryId} className="flex items-center gap-2 text-[13px] cd-text">
                  <span className="font-semibold">{r.deptName}</span>
                  <span>→ {r.userName ?? r.userId}</span>
                  {!r.active && <span className="cd-error-text text-[11px]">(퇴사·계정 없음)</span>}
                  <CdButton
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                    onClick={() => {
                      if (confirm(`${r.deptName}의 부서별 임원 지정을 지우고 기본 임원을 쓸까요?`)) {
                        void call("DELETE", null, `/api/approval/fixed-lines?entryId=${encodeURIComponent(r.entryId)}`, "부서별 임원 지정을 지웠습니다.");
                      }
                    }}
                  >
                    삭제
                  </CdButton>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-xs">
              <CdSelect label="부서" value={execDept} onChange={(e) => setExecDept(e.target.value)}>
                <option value="">부서 선택</option>
                {(data?.departments ?? []).map((d) => (
                  <option key={d.deptId} value={d.deptId}>
                    {d.deptName}
                  </option>
                ))}
              </CdSelect>
            </div>
            <CdButton disabled={!execDept || !data?.ready} onClick={() => setPicker({ kind: "role", role: "exec", deptId: execDept })}>
              임원 지정
            </CdButton>
          </div>

          <h3 className="text-[13px] font-semibold cd-text mt-2">임원으로 취급할 사람</h3>
          <p className="text-[11px] cd-text-faint">
            여기 있는 사람이 기안하면 부서장·임원 단계를 빼고 대표이사에게 올립니다. 결재 담당 임원은 위에서 지정합니다.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {execMembers.map((r) => (
              <span key={r.entryId} className="cd-action inline-flex items-center rounded-full border cd-border-c overflow-hidden">
                <span className="text-[12px] px-2 py-0.5 cd-text">{r.userName ?? r.userId}</span>
                <button
                  type="button"
                  className="text-[11px] px-1.5 cd-text-faint hover:text-[color:var(--cd-error)]"
                  title="임원 취급 해제"
                  onClick={() => {
                    if (confirm(`${r.userName ?? r.userId}님을 임원 취급에서 뺄까요?`)) {
                      void call("DELETE", null, `/api/approval/fixed-lines?entryId=${encodeURIComponent(r.entryId)}`, "임원 취급을 해제했습니다.");
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <CdButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} disabled={!data?.ready} onClick={() => setPicker({ kind: "role", role: "exec_member", deptId: "*" })}>
              추가
            </CdButton>
          </div>

          <h3 className="text-[13px] font-semibold cd-text mt-2">모든 양식 고정 참조·열람</h3>
          <p className="text-[11px] cd-text-faint">
            여기 있는 사람은 모든 결재 문서에 참조·열람자로 자동으로 들어갑니다(기안자 본인·결재선에 있는 사람 제외). 기안자는 뺄 수 없고, 공문·계약서 발송 메일 Cc 는 받지 않습니다.
          </p>
          {data && data.watchersReady === false ? (
            <p className="text-[12px] cd-error-text">고정 참조·열람자 표(마이그레이션 346)가 아직 적용되지 않았습니다.</p>
          ) : (
            (["ref", "view"] as const).map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] cd-text font-semibold w-12">{k === "ref" ? "참조" : "열람"}</span>
                {allFormWatchers
                  .filter((w) => w.kind === k)
                  .map((w) => (
                    <span key={w.entryId} className="cd-action inline-flex items-center rounded-full border cd-border-c overflow-hidden">
                      <span className="text-[12px] px-2 py-0.5 cd-text">
                        {w.userName ?? w.userId}
                        {!w.active && <span className="cd-error-text text-[11px]"> (퇴사·계정 없음)</span>}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] px-1.5 cd-text-faint hover:text-[color:var(--cd-error)]"
                        title={k === "ref" ? "고정 참조 해제" : "고정 열람 해제"}
                        onClick={() => {
                          if (confirm(`${w.userName ?? w.userId}님을 모든 양식 고정 ${k === "ref" ? "참조" : "열람"}에서 뺄까요?`)) {
                            void call("DELETE", null, `/api/approval/fixed-lines?watcherEntryId=${encodeURIComponent(w.entryId)}`, "고정 참조·열람에서 뺐습니다.");
                          }
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                <CdButton
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  disabled={!data?.watchersReady}
                  onClick={() => setPicker({ kind: "watcher", watchKind: k })}
                >
                  {k === "ref" ? "참조자 추가" : "열람자 추가"}
                </CdButton>
              </div>
            ))
          )}
        </div>

        {/* 양식별 결재선 */}
        <div className="cd-card rounded-lg p-5 flex flex-col gap-3">
          <h2 className="text-[14px] font-semibold cd-text">양식별 결재선</h2>
          {loading ? (
            <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="cd-table-head">
                  <tr className="text-left cd-text-faint text-[11px]">
                    <th className="py-1.5 pr-3 font-semibold">양식</th>
                    <th className="py-1.5 pr-3 font-semibold">결재 단계</th>
                    <th className="py-1.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.formId} className="border-t cd-border-c align-top">
                      <td className="py-2 pr-3 cd-text whitespace-nowrap">{t.formName}</td>
                      <td className="py-2 pr-3 cd-text">
                        <span className={t.steps.length && t.enabled ? "" : "cd-text-faint"}>{stepsText(t.steps)}</span>
                        {t.steps.length > 0 && !t.enabled && <span className="text-[11px] cd-text-faint"> (사용 안 함)</span>}
                        {t.enforceWhen && (
                          <span className="block text-[11px] cd-text-faint">
                            {t.enforceWhen.field} = {t.enforceWhen.equals}일 때만
                            {t.enforceWhen.whenMissing === "enforce" ? " · 값이 없으면 강제" : " · 값이 없으면 자유 지정"}
                          </span>
                        )}
                        {t.steps.some((s) => s.proxyUserIds?.length) && (
                          <span className="block text-[11px] cd-text-faint">
                            부재 시 대결 {t.steps.flatMap((s) => s.proxyUserIds ?? []).map((id) => nameOf.get(id) ?? id).join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <CdButton size="sm" disabled={!data?.ready} onClick={() => setEditing({ ...t, steps: t.steps.map((s) => ({ ...s })) })}>
                          편집
                        </CdButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 편집 */}
      {editing && (
        <div className="cd-card rounded-lg p-5 flex flex-col gap-3">
          <h2 className="text-[14px] font-semibold cd-text">결재선 편집 — {editing.formName}</h2>
          {editing.steps.length === 0 && <p className="text-[12px] cd-text-faint">단계가 없으면 이 양식은 기안자가 결재선을 자유롭게 지정합니다.</p>}
          <div className="flex flex-col gap-2">
            {editing.steps.map((s, i) => (
              <div key={i} className="rounded-lg border cd-border-c px-3 py-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono cd-text-faint w-4">{i + 1}</span>
                <select
                  className="cd-select"
                  style={{ width: 110 }}
                  aria-label="역할"
                  value={s.role}
                  onChange={(e) => updateStep(i, { role: e.target.value as LineRole })}
                >
                  {LINE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {LINE_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[12px] cd-text-faint">
                  본인 기안 시
                  <select
                    className="cd-select"
                    style={{ width: 130 }}
                    value={s.fallbackRole ?? ""}
                    onChange={(e) => updateStep(i, { fallbackRole: (e.target.value || null) as LineRole | null })}
                  >
                    <option value="">한 단계 위로</option>
                    {LINE_ROLES.filter((r) => r !== "manager").map((r) => (
                      <option key={r} value={r}>
                        {LINE_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-[12px] cd-text-faint">
                  부재 시 대결:{" "}
                  {(s.proxyUserIds ?? []).length ? (
                    (s.proxyUserIds ?? []).map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="cd-text hover:text-[color:var(--cd-error)] mr-1"
                        title="대결자 빼기"
                        onClick={() => updateStep(i, { proxyUserIds: (s.proxyUserIds ?? []).filter((x) => x !== id) })}
                      >
                        {nameOf.get(id) ?? id} ×
                      </button>
                    ))
                  ) : (
                    "없음"
                  )}
                </span>
                <CdButton size="sm" variant="ghost" onClick={() => setPicker({ kind: "proxy", stepIndex: i })}>
                  대결자 추가
                </CdButton>
                <span className="ml-auto flex items-center gap-1">
                  <CdButton size="sm" variant="ghost" aria-label="위로" icon={<ArrowUp className="w-3.5 h-3.5" />} onClick={() => moveStep(i, -1)} />
                  <CdButton size="sm" variant="ghost" aria-label="아래로" icon={<ArrowDown className="w-3.5 h-3.5" />} onClick={() => moveStep(i, 1)} />
                  <CdButton
                    size="sm"
                    variant="ghost"
                    aria-label="단계 삭제"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                    onClick={() => setEditing((prev) => (prev ? { ...prev, steps: prev.steps.filter((_, si) => si !== i) } : prev))}
                  />
                </span>
              </div>
            ))}
          </div>
          <div>
            <CdButton
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setEditing((prev) => (prev ? { ...prev, steps: [...prev.steps, { role: "dept_head" }] } : prev))}
            >
              단계 추가
            </CdButton>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[12px] font-semibold cd-text mb-1">강제 조건</legend>
            <label className="flex items-center gap-2 text-[13px] cd-text">
              <input
                type="checkbox"
                checked={!!editing.enforceWhen}
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, enforceWhen: e.target.checked ? { field: "doc_stage", equals: "final", whenMissing: "enforce" } : null } : prev
                  )
                }
              />
              문서 항목 값이 맞을 때만 강제(예: 계약서·견적서 최종안)
            </label>
            {editing.enforceWhen && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <CdInput
                    label="항목 키"
                    value={editing.enforceWhen.field}
                    onChange={(e) => setEditing((prev) => (prev && prev.enforceWhen ? { ...prev, enforceWhen: { ...prev.enforceWhen, field: e.target.value } } : prev))}
                  />
                </div>
                <div className="w-32">
                  <CdInput
                    label="값"
                    value={editing.enforceWhen.equals}
                    onChange={(e) => setEditing((prev) => (prev && prev.enforceWhen ? { ...prev, enforceWhen: { ...prev.enforceWhen, equals: e.target.value } } : prev))}
                  />
                </div>
                <div className="w-44">
                  <CdSelect
                    label="값이 없을 때"
                    value={editing.enforceWhen.whenMissing}
                    onChange={(e) =>
                      setEditing((prev) =>
                        prev && prev.enforceWhen ? { ...prev, enforceWhen: { ...prev.enforceWhen, whenMissing: e.target.value === "skip" ? "skip" : "enforce" } } : prev
                      )
                    }
                  >
                    <option value="enforce">강제</option>
                    <option value="skip">자유 지정</option>
                  </CdSelect>
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px] cd-text">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing((prev) => (prev ? { ...prev, enabled: e.target.checked } : prev))} />
              사용(끄면 이 양식은 자유 지정)
            </label>
          </fieldset>
          <div className="flex items-center gap-2">
            <CdButton variant="primary" disabled={saving} onClick={saveEditing}>
              {saving ? "저장 중..." : "결재선 저장"}
            </CdButton>
            <CdButton variant="ghost" onClick={() => setEditing(null)}>
              취소
            </CdButton>
          </div>
        </div>
      )}

      {/* 해석 미리보기 */}
      <div className="cd-card rounded-lg p-5 flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold cd-text">직원별 결재선 미리보기</h2>
        <div className="max-w-sm">
          <CdSelect label="양식" value={previewFormId} onChange={(e) => setPreviewForm(e.target.value)}>
            {fixedTemplates.map((t) => (
              <option key={t.formId} value={t.formId}>
                {t.formName}
              </option>
            ))}
          </CdSelect>
        </div>
        {!data?.preview ? (
          <p className="text-sm cd-text-faint">{loading ? "불러오는 중입니다." : "미리보기가 없습니다."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="cd-table-head">
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">기안자</th>
                  <th className="py-1.5 pr-3 font-semibold">부서</th>
                  <th className="py-1.5 font-semibold">결재선(최종안 기준)</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.map((p) => {
                  const l = p.lines[previewFormId];
                  return (
                    <tr key={p.userId} className="border-t cd-border-c">
                      <td className="py-1.5 pr-3 cd-text whitespace-nowrap">{p.name}</td>
                      <td className="py-1.5 pr-3 cd-text-faint whitespace-nowrap">{p.deptName ?? "-"}</td>
                      <td className={"py-1.5 " + (l && !l.ok ? "cd-error-text" : "cd-text")}>{l ? l.text : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OrgPickerModal
        open={picker != null}
        title={
          picker?.kind === "proxy"
            ? "지정 대결자 선택 — 조직도에서 선택"
            : picker?.kind === "watcher"
              ? `모든 양식 고정 ${picker.watchKind === "ref" ? "참조자" : "열람자"} 선택 — 조직도에서 선택`
              : "결재자 선택 — 조직도에서 선택"
        }
        hint="인원을 클릭하면 지정됩니다."
        onClose={() => setPicker(null)}
        onSelect={(emp) => {
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          const target = picker;
          setPicker(null);
          if (!target) return;
          if (target.kind === "proxy") {
            const s = editing?.steps[target.stepIndex];
            if (s && !(s.proxyUserIds ?? []).includes(emp.userId)) updateStep(target.stepIndex, { proxyUserIds: [...(s.proxyUserIds ?? []), emp.userId] });
            return;
          }
          if (target.kind === "watcher") {
            void call("PUT", { kind: "watcher", watchKind: target.watchKind, userId: emp.userId }, undefined, `${emp.name}님을 모든 양식 고정 ${target.watchKind === "ref" ? "참조자" : "열람자"}로 지정했습니다.`);
            return;
          }
          void call("PUT", { kind: "role", role: target.role, deptId: target.deptId, userId: emp.userId }, undefined, `${emp.name}님을 지정했습니다.`);
        }}
      />
    </div>
  );
}
