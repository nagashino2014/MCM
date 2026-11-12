"use client";

// 고정 결재선(335, 결재 운영) — 양식별 결재 단계(역할)·역할 담당자(대표이사·관리자·부서별 임원)·임원 취급 인원을 관리하고,
// 재직자별로 결재선이 실제로 누구로 풀리는지 미리 본다. 기안 화면은 이 규칙으로 결재선을 잠그고 서버도 같은 규칙으로 강제한다.
// 모든 양식 고정 참조·열람자(346)도 같은 카드에서 정한다 — 저장·상신 때 서버가 문서에 넣는다.
// 직원별 추가 결재자·참조·열람(353) — 직원 요청을 받아 그 직원이 기안하는 문서에만 결재자·참조·열람자를 덧붙인다.
// 설계: docs/approval-fixed-line-plan-2026-11-03.md.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdInput, CdSelect } from "@/components/cdash/CdField";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import {
  DRAFTER_RULE_KIND_LABELS,
  EXTRA_POSITION_LABELS,
  EXTRA_POSITIONS,
  LINE_ROLE_LABELS,
  LINE_ROLES,
  type DrafterRuleKind,
  type ExtraPosition,
  type LineEnforceWhen,
  type LineRole,
  type LineTemplateStep,
} from "@/lib/approval/fixed-line-rules";
import "@/components/cdash/cdash.css";

type RoleKey = "ceo" | "exec" | "manager" | "exec_member";

interface TemplateRow {
  formId: string;
  formName: string;
  steps: LineTemplateStep[];
  enforceWhen: LineEnforceWhen | null;
  enabled: boolean;
  /** 부서장이 기안하면 사다리를 이 역할까지 채움(347) */
  headDrafterTo?: "exec" | "ceo" | null;
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

interface UserRuleRow {
  ruleId: string;
  drafterUserId: string;
  drafterName: string | null;
  drafterActive: boolean;
  formId: string;
  formName: string | null;
  kind: DrafterRuleKind;
  targetUserId: string;
  targetName: string | null;
  targetActive: boolean;
  position: ExtraPosition | null;
  note: string | null;
}

/** 직원별 규칙 입력 중 값 */
interface RuleDraft {
  drafterUserId: string;
  drafterName: string;
  formId: string;
  kind: DrafterRuleKind;
  position: ExtraPosition;
  targetUserId: string;
  targetName: string;
  note: string;
}

const EMPTY_RULE: RuleDraft = {
  drafterUserId: "",
  drafterName: "",
  formId: "*",
  kind: "approve",
  position: "first",
  targetUserId: "",
  targetName: "",
  note: "",
};

const RULE_DONE_LABELS: Record<DrafterRuleKind, string> = { approve: "결재자로", ref: "참조자로", view: "열람자로" };

interface Snapshot {
  ready: boolean;
  templates: TemplateRow[];
  roleUsers: RoleUserRow[];
  departments: Array<{ deptId: string; deptName: string }>;
  preview?: PreviewRow[];
  /** 고정 참조·열람자(346) — 표가 없으면 watchersReady=false */
  watchersReady?: boolean;
  fixedWatchers?: FixedWatcherRow[];
  /** 직원별 추가 결재자·참조·열람(353) — 표가 없으면 userRulesReady=false */
  userRulesReady?: boolean;
  userRules?: UserRuleRow[];
}

/** 조직도 선택 대상 — 역할 담당자 지정 또는 편집 중 단계의 지정 대결자 추가 */
type PickTarget =
  | { kind: "role"; role: RoleKey; deptId: string }
  | { kind: "proxy"; stepIndex: number }
  | { kind: "watcher"; watchKind: "ref" | "view" }
  | { kind: "ruleDrafter" }
  | { kind: "ruleTarget" };

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
  // 위 줄 두 카드 높이 상한(2026-11-12 사용자 요청: 40% 줄이기 → 같은 날 30% 다시 늘림) — xl 이상에서 두 카드 중 큰 내용 높이의 78%. 그 아래 폭은 상한 없음.
  const topRowRef = useRef<HTMLDivElement>(null);
  const [topCap, setTopCap] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewForm, setPreviewForm] = useState("");
  const [rule, setRule] = useState<RuleDraft>(EMPTY_RULE);

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

  const userRules = data?.userRules ?? [];
  // 결재자 추가는 고정 결재선이 있는 양식에만 들어간다 — 양식 목록도 그에 맞춘다
  const ruleForms = rule.kind === "approve" ? fixedTemplates : templates;
  const addRule = async () => {
    const ok = await call(
      "PUT",
      {
        kind: "userRule",
        drafterUserId: rule.drafterUserId,
        formId: rule.formId,
        ruleKind: rule.kind,
        targetUserId: rule.targetUserId,
        position: rule.kind === "approve" ? rule.position : null,
        note: rule.note,
      },
      undefined,
      `${rule.drafterName}님 기안 문서에 ${rule.targetName}님을 ${RULE_DONE_LABELS[rule.kind]} 넣었습니다.`
    );
    if (ok) setRule((prev) => ({ ...prev, targetUserId: "", targetName: "", note: "" }));
  };

  const saveEditing = async () => {
    if (!editing) return;
    const ok = await call(
      "PUT",
      {
        kind: "template",
        formId: editing.formId,
        steps: editing.steps,
        enforceWhen: editing.enforceWhen,
        enabled: editing.enabled,
        headDrafterTo: editing.headDrafterTo ?? null,
      },
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

  // 위 줄 상한 재기 — 카드 높이를 고정해도 scrollHeight 는 내용 전체 높이라 상한이 스스로 바뀌지 않는다(되먹임 없음).
  // 담당자·양식 목록이 바뀌거나 창 폭이 바뀌면(줄바꿈 변화) 다시 잰다. xl(1280px) 미만은 위아래로 쌓이므로 상한을 두지 않는다.
  useLayoutEffect(() => {
    const row = topRowRef.current;
    if (!row) return;
    const measure = () => {
      if (!window.matchMedia("(min-width: 1280px)").matches) {
        setTopCap(null);
        return;
      }
      const natural = Math.max(0, ...Array.from(row.children).map((c) => (c as HTMLElement).scrollHeight));
      const next = natural > 0 ? Math.round(natural * 0.78) : null;
      setTopCap((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data, loading]);

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

      {/* 위 줄(역할 담당자·양식별 결재선) — 넓은 화면(xl)에서 두 카드 높이를 내용 높이의 78%로 줄이고 카드 안에서 스크롤한다
          (2026-11-12 사용자 요청: 40% 줄이기). 내용이 바뀌면 다시 잰다. */}
      <div ref={topRowRef} className="grid gap-5 xl:grid-cols-2">
        {/* 역할 담당자 */}
        <div className="cd-card rounded-lg p-5 flex flex-col gap-3 xl:overflow-y-auto" style={topCap ? { height: topCap } : undefined}>
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
                <span className="w-12 cd-label-text">{k === "ref" ? "참조" : "열람"}</span>
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
        <div className="cd-card rounded-lg p-5 flex flex-col gap-3 xl:overflow-y-auto" style={topCap ? { height: topCap } : undefined}>
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
                        {t.steps.length > 0 && t.headDrafterTo === "ceo" && (
                          <span className="block text-[11px] cd-text-faint">부서장이 기안하면 대표이사까지</span>
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

      {/* 아래 줄(2026-11-12 사용자 요청) — 왼쪽 칸(역할 담당자와 같은 폭): 직원별 추가 결재선·참조·열람 + 결재선 편집,
          오른쪽 칸: 직원별 결재선 미리보기. 미리보기는 내용 높이 그대로 두고, 직원별 추가 카드만 늘려 왼쪽 두 카드 합을 맞춘다. */}
      <div className="grid gap-5 xl:grid-cols-2 items-stretch">
      <div className="flex flex-col gap-5 min-w-0">
      {/* 직원별 추가 결재자·참조·열람(353) */}
      <div className="cd-card rounded-lg p-5 flex flex-col gap-3 flex-1">
        <h2 className="text-[14px] font-semibold cd-text">직원별 추가 결재선·참조·열람</h2>
        <p className="text-[11px] cd-text-faint">
          직원이 요청하면 그 직원이 기안하는 문서에만 결재자를 덧붙이거나 참조·열람자를 넣습니다. 양식별 고정 결재선은 그대로이고, 결재자 추가는 고정 결재선이 있는 양식에만 들어갑니다. 결과는 미리보기에서 확인하세요.
        </p>
        {data && data.userRulesReady === false ? (
          <p className="text-[12px] cd-error-text">직원별 결재선 표(마이그레이션 353)가 아직 적용되지 않았습니다.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="cd-label">기안자(요청한 직원)</span>
                <CdButton onClick={() => setPicker({ kind: "ruleDrafter" })}>
                  {rule.drafterName || "직원 선택"}
                </CdButton>
              </div>
              <div className="w-40">
                <CdSelect
                  label="구분"
                  value={rule.kind}
                  onChange={(e) => {
                    const kind = e.target.value as DrafterRuleKind;
                    setRule((prev) => ({
                      ...prev,
                      kind,
                      // 결재자 추가로 바꾸면 고정 결재선이 없는 양식 선택은 '모든 양식'으로 되돌린다
                      formId: kind === "approve" && prev.formId !== "*" && !fixedTemplates.some((t) => t.formId === prev.formId) ? "*" : prev.formId,
                    }));
                  }}
                >
                  {(["approve", "ref", "view"] as const).map((k) => (
                    <option key={k} value={k}>
                      {DRAFTER_RULE_KIND_LABELS[k]}
                    </option>
                  ))}
                </CdSelect>
              </div>
              <div className="w-52">
                <CdSelect label="양식" value={rule.formId} onChange={(e) => setRule((prev) => ({ ...prev, formId: e.target.value }))}>
                  <option value="*">모든 양식</option>
                  {ruleForms.map((t) => (
                    <option key={t.formId} value={t.formId}>
                      {t.formName}
                    </option>
                  ))}
                </CdSelect>
              </div>
              {rule.kind === "approve" && (
                <div className="w-48">
                  <CdSelect
                    label="넣을 자리"
                    value={rule.position}
                    onChange={(e) => setRule((prev) => ({ ...prev, position: e.target.value as ExtraPosition }))}
                  >
                    {EXTRA_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {EXTRA_POSITION_LABELS[p]}
                      </option>
                    ))}
                  </CdSelect>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="cd-label">넣을 사람</span>
                <CdButton onClick={() => setPicker({ kind: "ruleTarget" })}>
                  {rule.targetName || "직원 선택"}
                </CdButton>
              </div>
              <div className="w-56">
                <CdInput
                  label="메모(요청 내용)"
                  value={rule.note}
                  maxLength={200}
                  placeholder="예: 팀장 결재 추가 요청"
                  onChange={(e) => setRule((prev) => ({ ...prev, note: e.target.value }))}
                />
              </div>
              <CdButton
                variant="primary"
                icon={<Plus className="w-3.5 h-3.5" />}
                disabled={saving || !rule.drafterUserId || !rule.targetUserId}
                onClick={addRule}
              >
                추가
              </CdButton>
            </div>
            {rule.kind === "approve" && rule.position === "last" && (
              <p className="text-[11px] cd-error-text">맨 뒤에 넣으면 이 사람이 최종 결재자가 됩니다.</p>
            )}
            {userRules.length === 0 ? (
              <p className="text-[12px] cd-text-faint">없음 — 모든 직원이 양식별 고정 결재선과 모든 양식 고정 참조·열람만 씁니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="cd-table-head">
                    <tr className="text-left cd-text-faint text-[11px]">
                      <th className="py-1.5 pr-3 font-semibold">기안자</th>
                      <th className="py-1.5 pr-3 font-semibold">양식</th>
                      <th className="py-1.5 pr-3 font-semibold">구분</th>
                      <th className="py-1.5 pr-3 font-semibold">넣을 사람</th>
                      <th className="py-1.5 pr-3 font-semibold">자리</th>
                      <th className="py-1.5 pr-3 font-semibold">메모</th>
                      <th className="py-1.5 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {userRules.map((r, i) => (
                      <tr key={r.ruleId} className="border-t cd-border-c">
                        <td className="py-1.5 pr-3 cd-text whitespace-nowrap">
                          {i > 0 && userRules[i - 1].drafterUserId === r.drafterUserId ? "" : r.drafterName ?? r.drafterUserId}
                          {!r.drafterActive && <span className="cd-error-text text-[11px]"> (퇴사·계정 없음)</span>}
                        </td>
                        <td className="py-1.5 pr-3 cd-text whitespace-nowrap">{r.formId === "*" ? "모든 양식" : r.formName ?? r.formId}</td>
                        <td className="py-1.5 pr-3 cd-text whitespace-nowrap">{DRAFTER_RULE_KIND_LABELS[r.kind]}</td>
                        <td className="py-1.5 pr-3 cd-text whitespace-nowrap">
                          {r.targetName ?? r.targetUserId}
                          {!r.targetActive && <span className="cd-error-text text-[11px]"> (퇴사·계정 없음 — 적용 안 됨)</span>}
                        </td>
                        <td className="py-1.5 pr-3 cd-text-faint whitespace-nowrap">{r.position ? EXTRA_POSITION_LABELS[r.position] : "-"}</td>
                        <td className="py-1.5 pr-3 cd-text-faint">{r.note ?? ""}</td>
                        <td className="py-1.5 text-right">
                          <CdButton
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => {
                              if (confirm(`${r.drafterName ?? r.drafterUserId}님 기안 문서의 ${DRAFTER_RULE_KIND_LABELS[r.kind]}(${r.targetName ?? r.targetUserId}) 설정을 지울까요?`)) {
                                void call("DELETE", null, `/api/approval/fixed-lines?userRuleId=${encodeURIComponent(r.ruleId)}`, "직원별 설정을 지웠습니다.");
                              }
                            }}
                          >
                            삭제
                          </CdButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
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
                  <span className="cd-label-text">본인 기안 시</span>
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
            <legend className="mb-1 cd-label-text">강제 조건</legend>
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
              <input
                type="checkbox"
                checked={editing.headDrafterTo === "ceo"}
                onChange={(e) => setEditing((prev) => (prev ? { ...prev, headDrafterTo: e.target.checked ? "ceo" : null } : prev))}
              />
              부서장이 기안하면 대표이사까지 올림(일반 직원 결재선은 그대로)
            </label>
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
      </div>

      {/* 해석 미리보기 */}
      <div className="cd-card rounded-lg p-5 flex flex-col gap-3 min-w-0">
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
      </div>

      <OrgPickerModal
        open={picker != null}
        title={
          picker?.kind === "proxy"
            ? "지정 대결자 선택 — 조직도에서 선택"
            : picker?.kind === "watcher"
              ? `모든 양식 고정 ${picker.watchKind === "ref" ? "참조자" : "열람자"} 선택 — 조직도에서 선택`
              : picker?.kind === "ruleDrafter"
                ? "기안자(요청한 직원) 선택 — 조직도에서 선택"
                : picker?.kind === "ruleTarget"
                  ? "넣을 사람 선택 — 조직도에서 선택"
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
          if (target.kind === "ruleDrafter") {
            setRule((prev) => ({ ...prev, drafterUserId: emp.userId!, drafterName: emp.name }));
            return;
          }
          if (target.kind === "ruleTarget") {
            setRule((prev) => ({ ...prev, targetUserId: emp.userId!, targetName: emp.name }));
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
