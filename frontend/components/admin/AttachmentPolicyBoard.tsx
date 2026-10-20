"use client";

// 첨부 확장자 정책(/admin/attachment-policy) — 메일·메신저로 보낼 수 있는 파일 형식(262, 2026-09-17).
// 전 사용자 일률 차단이 아니라 전사 기본 정책 위에 인원별 예외를 둔다.
//  - 전사 기본 정책: 위험 확장자 목록(분류·위험도·설명)별 차단 여부, 위험도·분류 단위 일괄 허용/제한, 확장자 추가.
//  - 인원별 설정: 모드(전사 기본 따름 / 모두 허용 / 목록 전체 차단) + 확장자별 허용·차단 규칙. 여러 명 선택 일괄 적용.
// 판정은 서버(메일 발송·메신저 전송 API)가 한다 — 이 화면은 정책만 편집.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RotateCcw, Search, ShieldAlert, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import "@/components/cdash/cdash.css";

type Mode = "default" | "allow_all" | "block_listed";
type Rule = "allow" | "block";

interface ExtRow {
  ext: string;
  category: string;
  risk: "high" | "medium";
  description: string;
  blocked: boolean;
  isCustom: boolean;
  sortOrder: number;
}

interface UserRow {
  userId: string;
  name: string;
  email: string | null;
  deptName: string | null;
  positionName: string | null;
  status: string;
  mode: Mode;
  note: string | null;
  rules: Record<string, Rule>;
}

const MODE_LABEL: Record<Mode, string> = {
  default: "전사 기본 따름",
  allow_all: "모두 허용",
  block_listed: "목록 전체 차단",
};
const MODE_HINT: Record<Mode, string> = {
  default: "전사 기본 정책의 차단 목록을 그대로 적용합니다.",
  allow_all: "목록의 모든 확장자를 허용합니다(IT·개발 담당 등). 확장자별 차단 규칙은 계속 적용됩니다.",
  block_listed: "위험도와 관계없이 목록의 모든 확장자를 차단합니다. 확장자별 허용 규칙은 계속 적용됩니다.",
};

function effectiveBlocked(ext: ExtRow, user: UserRow): boolean {
  const rule = user.rules[ext.ext];
  if (rule) return rule === "block";
  if (user.mode === "allow_all") return false;
  if (user.mode === "block_listed") return true;
  return ext.blocked;
}

export function AttachmentPolicyBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [tab, setTab] = useState<"global" | "users">("global");
  const [catalog, setCatalog] = useState<ExtRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/attachment-policy", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "불러오지 못했습니다.");
      setCatalog(d.catalog ?? []);
      setUsers(d.users ?? []);
      setCategories(d.categories ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>, successText?: string) => {
      setBusy(true);
      try {
        const r = await fetch("/api/admin/attachment-policy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "저장하지 못했습니다.");
        if (successText) toast(successText, "success");
        await load();
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, toast]
  );

  const blockedCount = catalog.filter((c) => c.blocked).length;
  const exceptionUsers = users.filter((u) => u.mode !== "default" || Object.keys(u.rules).length > 0).length;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="첨부 확장자 정책"
        meta={loading ? undefined : `목록 ${catalog.length}종 · 전사 차단 ${blockedCount}종 · 예외 설정 ${exceptionUsers}명`}
        help={
          <div className="text-[12.5px] leading-relaxed space-y-1.5">
            <p>메일 발송과 메신저 전송(개인문서함 전송 포함)에서 보낼 수 있는 파일 형식을 정합니다. 받은 메일에는 적용되지 않습니다.</p>
            <p>판정은 파일명의 마지막 확장자로 합니다(예: 보고서.pdf.exe → exe). 목록에 없는 확장자는 항상 허용됩니다.</p>
            <p>적용 순서: 인원별 확장자 규칙 → 인원 모드(모두 허용·목록 전체 차단) → 전사 기본 정책.</p>
          </div>
        }
      />

      <CdTabs
        items={[
          { key: "global", label: "전사 기본 정책" },
          { key: "users", label: "인원별 설정", count: exceptionUsers || undefined },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "global" | "users")}
      />

      {error && <div className="cd-error-text text-sm mt-3">{error}</div>}
      {loading ? (
        <div className="flex-1 flex items-center justify-center cd-text-faint text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : tab === "global" ? (
        <GlobalTab catalog={catalog} users={users} categories={categories} busy={busy} post={post} />
      ) : (
        <UsersTab catalog={catalog} users={users} categories={categories} busy={busy} post={post} />
      )}
    </div>
  );
}

/* ───────────── 전사 기본 정책 ───────────── */

function GlobalTab({
  catalog,
  users,
  categories,
  busy,
  post,
}: {
  catalog: ExtRow[];
  users: UserRow[];
  categories: Record<string, string>;
  busy: boolean;
  post: (payload: Record<string, unknown>, successText?: string) => Promise<boolean>;
}) {
  const [category, setCategory] = useState("");
  const [risk, setRisk] = useState("");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState({ ext: "", description: "", risk: "high" as "high" | "medium", blocked: true });

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase().replace(/^\./, "");
    return catalog.filter(
      (c) =>
        (!category || c.category === category) &&
        (!risk || c.risk === risk) &&
        (!kw || c.ext.includes(kw) || c.description.toLowerCase().includes(kw))
    );
  }, [catalog, category, risk, q]);

  const groups = useMemo(() => {
    const map = new Map<string, ExtRow[]>();
    for (const c of shown) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return [...map.entries()];
  }, [shown]);

  /** 확장자별 인원 예외 수 */
  const exceptions = useMemo(() => {
    const m = new Map<string, { allow: number; block: number }>();
    for (const u of users) {
      for (const [ext, rule] of Object.entries(u.rules)) {
        const cur = m.get(ext) ?? { allow: 0, block: 0 };
        cur[rule] += 1;
        m.set(ext, cur);
      }
    }
    return m;
  }, [users]);

  const bulk = (exts: string[], blocked: boolean, label: string) => {
    if (!exts.length) return;
    if (!window.confirm(`${label} — 확장자 ${exts.length}종을 전사 기본 ${blocked ? "차단" : "허용"}으로 바꿉니다. 계속할까요?`)) return;
    void post({ action: "setGlobal", exts, blocked }, `${exts.length}종을 ${blocked ? "차단" : "허용"}으로 바꿨습니다.`);
  };

  const high = catalog.filter((c) => c.risk === "high").map((c) => c.ext);
  const medium = catalog.filter((c) => c.risk === "medium").map((c) => c.ext);
  const all = catalog.map((c) => c.ext);

  const addExt = async () => {
    if (!draft.ext.trim()) return;
    if (await post({ action: "addExt", ...draft }, `.${draft.ext.replace(/^\./, "")} 를 목록에 추가했습니다.`)) {
      setDraft({ ext: "", description: "", risk: "high", blocked: true });
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 mt-3">
      {/* 일괄 허용/제한 */}
      <div className="cd-card p-3 rounded-2xl flex flex-col gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold cd-text mr-1">일괄 설정</span>
          <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => bulk(high, true, "고위험 전체 차단")}>고위험 전체 차단</button>
          <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => bulk(medium, true, "중위험 전체 차단")}>중위험 전체 차단</button>
          <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => bulk(medium, false, "중위험 전체 허용")}>중위험 전체 허용</button>
          <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => bulk(all, true, "목록 전체 차단")}>목록 전체 차단</button>
          <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => bulk(all, false, "목록 전체 허용")}>목록 전체 허용</button>
          <button
            type="button"
            className="cd-btn cd-btn-sm"
            disabled={busy}
            title="고위험 차단 · 중위험 허용(최초 설치 상태)"
            onClick={async () => {
              if (!window.confirm("권장 기본값(고위험 차단 · 중위험 허용)으로 되돌립니다. 계속할까요?")) return;
              if (await post({ action: "setGlobal", exts: high, blocked: true })) {
                await post({ action: "setGlobal", exts: medium, blocked: false }, "권장 기본값으로 되돌렸습니다.");
              }
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" /> 권장 기본값
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="cd-select text-sm" style={{ width: 170 }} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="분류">
            <option value="">모든 분류</option>
            {Object.entries(categories).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className="cd-select text-sm" style={{ width: 120 }} value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="위험도">
            <option value="">모든 위험도</option>
            <option value="high">고위험</option>
            <option value="medium">중위험</option>
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint" />
            <input className="cd-input text-sm" style={{ width: 200, paddingLeft: 28 }} placeholder="확장자·설명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="mx-1 h-5 border-l cd-border-c" />
          <span className="text-xs cd-text-faint">확장자 추가</span>
          <input className="cd-input text-sm" style={{ width: 90 }} placeholder="예: xyz" value={draft.ext} onChange={(e) => setDraft({ ...draft, ext: e.target.value })} />
          <input className="cd-input text-sm" style={{ width: 180 }} placeholder="설명" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <select className="cd-select text-sm" style={{ width: 100 }} value={draft.risk} onChange={(e) => setDraft({ ...draft, risk: e.target.value as "high" | "medium" })} aria-label="추가 위험도">
            <option value="high">고위험</option>
            <option value="medium">중위험</option>
          </select>
          <label className="text-xs cd-text flex items-center gap-1">
            <input type="checkbox" checked={draft.blocked} onChange={(e) => setDraft({ ...draft, blocked: e.target.checked })} /> 차단
          </label>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || !draft.ext.trim()} onClick={() => void addExt()}>
            <Plus className="w-3.5 h-3.5" /> 추가
          </button>
        </div>
      </div>

      {/* 분류별 목록 */}
      <div className="cd-card rounded-2xl flex-1 min-h-0 overflow-auto">
        <table className="w-full text-sm">
          <thead className="cd-table-head sticky top-0 z-[1]" style={{ background: "var(--cd-surface)" }}>
            <tr className="cd-text-faint text-[11px] border-b cd-border-c">
              <th className="text-left font-semibold p-2 pl-4 w-[130px]">확장자</th>
              <th className="text-left font-semibold p-2 w-[80px]">위험도</th>
              <th className="text-left font-semibold p-2">설명</th>
              <th className="text-left font-semibold p-2 w-[150px] whitespace-nowrap">인원 예외</th>
              <th className="text-center font-semibold p-2 w-[90px]">전사 차단</th>
              <th className="p-2 w-[40px]" />
            </tr>
          </thead>
          <tbody>
            {groups.map(([cat, rows]) => {
              const exts = rows.map((r) => r.ext);
              const nBlocked = rows.filter((r) => r.blocked).length;
              return (
                <FragmentGroup key={cat}>
                  <tr className="border-b cd-border-c" style={{ background: "var(--cd-surface-2, var(--cd-hairline))" }}>
                    <td colSpan={6} className="px-4 py-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold cd-text">{categories[cat] ?? cat}</span>
                        <span className="text-[11px] cd-text-faint">{rows.length}종 · 차단 {nBlocked}</span>
                        <span className="ml-auto flex items-center gap-1">
                          <button type="button" className="cd-btn cd-btn-sm" disabled={busy || nBlocked === rows.length} onClick={() => bulk(exts, true, `${categories[cat] ?? cat} 분류 차단`)}>이 분류 차단</button>
                          <button type="button" className="cd-btn cd-btn-sm" disabled={busy || nBlocked === 0} onClick={() => bulk(exts, false, `${categories[cat] ?? cat} 분류 허용`)}>이 분류 허용</button>
                        </span>
                      </div>
                    </td>
                  </tr>
                  {rows.map((c) => {
                    const ex = exceptions.get(c.ext);
                    return (
                      <tr key={c.ext} className="border-b cd-border-c last:border-0">
                        <td className="p-2 pl-4 font-mono text-[13px] cd-text font-semibold">.{c.ext}</td>
                        <td className="p-2">
                          <span className={`cd-pill ${c.risk === "high" ? "cd-pill-error" : "cd-pill-warn"}`}>{c.risk === "high" ? "고위험" : "중위험"}</span>
                        </td>
                        <td className="p-2 cd-text-muted text-[12.5px]">{c.description}</td>
                        <td className="p-2 text-[12px] whitespace-nowrap">
                          {ex ? (
                            <span className="cd-text-muted">
                              {ex.allow ? `허용 ${ex.allow}명` : ""}
                              {ex.allow && ex.block ? " · " : ""}
                              {ex.block ? `차단 ${ex.block}명` : ""}
                            </span>
                          ) : (
                            <span className="cd-text-faint">—</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer text-[12px]">
                            <input
                              type="checkbox"
                              checked={c.blocked}
                              disabled={busy}
                              onChange={(e) => void post({ action: "setGlobal", exts: [c.ext], blocked: e.target.checked })}
                              aria-label={`.${c.ext} 전사 차단`}
                            />
                            <span style={{ color: c.blocked ? "var(--cd-error)" : "var(--cd-success)" }}>{c.blocked ? "차단" : "허용"}</span>
                          </label>
                        </td>
                        <td className="p-2 text-right">
                          {c.isCustom && (
                            <button
                              type="button"
                              className="cd-btn rounded-lg p-1.5"
                              title="직접 추가한 확장자 삭제"
                              style={{ color: "var(--cd-error)" }}
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm(`.${c.ext} 를 목록에서 삭제할까요? 인원별 규칙도 함께 지워집니다.`)) void post({ action: "deleteExt", ext: c.ext }, "삭제했습니다.");
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </FragmentGroup>
              );
            })}
          </tbody>
        </table>
        {!groups.length && <p className="p-6 text-center text-sm cd-text-faint">조건에 맞는 확장자가 없습니다.</p>}
      </div>
    </div>
  );
}

function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/* ───────────── 인원별 설정 ───────────── */

function UsersTab({
  catalog,
  users,
  categories,
  busy,
  post,
}: {
  catalog: ExtRow[];
  users: UserRow[];
  categories: Record<string, string>;
  busy: boolean;
  post: (payload: Record<string, unknown>, successText?: string) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [onlyException, setOnlyException] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [extCategory, setExtCategory] = useState("");
  const [extQ, setExtQ] = useState("");
  const [extOnlyRule, setExtOnlyRule] = useState(false);
  const [extChecked, setExtChecked] = useState<Set<string>>(new Set());

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return users.filter(
      (u) =>
        (showInactive || u.status === "active") &&
        (!onlyException || u.mode !== "default" || Object.keys(u.rules).length > 0) &&
        (!kw || u.name.toLowerCase().includes(kw) || (u.deptName ?? "").toLowerCase().includes(kw) || (u.email ?? "").toLowerCase().includes(kw))
    );
  }, [users, q, showInactive, onlyException]);

  const focus = users.find((u) => u.userId === focusId) ?? null;
  // 적용 대상 — 체크한 인원이 있으면 그 인원들, 없으면 선택(포커스)한 1명
  const targets = checked.size ? [...checked] : focus ? [focus.userId] : [];
  const multi = checked.size > 1;
  const targetLabel = checked.size ? `선택한 ${checked.size}명` : focus ? focus.name : "";

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const extRows = useMemo(() => {
    const kw = extQ.trim().toLowerCase().replace(/^\./, "");
    return catalog.filter(
      (c) =>
        (!extCategory || c.category === extCategory) &&
        (!kw || c.ext.includes(kw) || c.description.toLowerCase().includes(kw)) &&
        (!extOnlyRule || (focus && !multi && focus.rules[c.ext]))
    );
  }, [catalog, extCategory, extQ, extOnlyRule, focus, multi]);

  const setMode = (mode: Mode) => {
    if (!targets.length) return;
    if (multi && !window.confirm(`${targetLabel}의 모드를 '${MODE_LABEL[mode]}'(으)로 바꿉니다. 계속할까요?`)) return;
    void post({ action: "setUserMode", userIds: targets, mode }, `${targetLabel} — ${MODE_LABEL[mode]}`);
  };
  const setRules = (exts: string[], rule: Rule | "inherit") => {
    if (!targets.length || !exts.length) return;
    if ((multi || exts.length > 1) && !window.confirm(`${targetLabel}에게 확장자 ${exts.length}종을 '${rule === "allow" ? "허용" : rule === "block" ? "차단" : "기본 따름"}'으로 설정합니다. 계속할까요?`)) return;
    void post({ action: "setUserRules", userIds: targets, exts, rule }).then((ok) => ok && setExtChecked(new Set()));
  };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(320px,2fr)_3fr] gap-3 mt-3">
      {/* 좌 — 인원 목록 */}
      <div className="cd-card rounded-2xl flex flex-col min-h-0">
        <div className="p-3 border-b cd-border-c flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint" />
              <input className="cd-input text-sm w-full" style={{ paddingLeft: 28 }} placeholder="이름·부서·메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <label className="text-xs cd-text flex items-center gap-1 whitespace-nowrap">
              <input type="checkbox" checked={onlyException} onChange={(e) => setOnlyException(e.target.checked)} /> 예외만
            </label>
            <label className="text-xs cd-text flex items-center gap-1 whitespace-nowrap">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 비활성 계정
            </label>
          </div>
          {checked.size > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="font-bold cd-text">선택 {checked.size}명</span>
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <button key={m} type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
              ))}
              <button
                type="button"
                className="cd-btn cd-btn-sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`선택한 ${checked.size}명의 개인 설정(모드·확장자 규칙)을 모두 지웁니다. 계속할까요?`)) {
                    void post({ action: "resetUsers", userIds: [...checked] }, "개인 설정을 초기화했습니다.");
                  }
                }}
              >
                <RotateCcw className="w-3.5 h-3.5" /> 초기화
              </button>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setChecked(new Set())}>선택 해제</button>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="cd-table-head sticky top-0 z-[1]" style={{ background: "var(--cd-surface)" }}>
              <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                <th className="p-2 pl-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="목록 전체 선택"
                    checked={list.length > 0 && list.every((u) => checked.has(u.userId))}
                    onChange={(e) => setChecked(e.target.checked ? new Set(list.map((u) => u.userId)) : new Set())}
                  />
                </th>
                <th className="text-left font-semibold p-2">이름</th>
                <th className="text-left font-semibold p-2">부서</th>
                <th className="text-left font-semibold p-2 whitespace-nowrap">설정</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => {
                const nRules = Object.keys(u.rules).length;
                const active = focusId === u.userId;
                return (
                  <tr
                    key={u.userId}
                    className="border-b cd-border-c last:border-0 cursor-pointer cd-row-hover"
                    style={active ? { background: "var(--cd-primary-soft)" } : undefined}
                    onClick={() => setFocusId(u.userId)}
                  >
                    <td className="p-2 pl-3" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(u.userId)} onChange={() => toggle(u.userId)} aria-label={`${u.name} 선택`} />
                    </td>
                    <td className="p-2 cd-text font-semibold whitespace-nowrap">
                      {u.name}
                      {u.status !== "active" && <span className="cd-pill cd-pill-idle ml-1">비활성</span>}
                    </td>
                    <td className="p-2 cd-text-faint text-[12px] whitespace-nowrap">{[u.deptName, u.positionName].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="p-2 whitespace-nowrap">
                      {u.mode !== "default" ? (
                        <span className={`cd-pill ${u.mode === "allow_all" ? "cd-pill-success" : "cd-pill-error"}`}>{MODE_LABEL[u.mode]}</span>
                      ) : (
                        <span className="text-[12px] cd-text-faint">기본</span>
                      )}
                      {nRules > 0 && <span className="cd-pill cd-pill-info ml-1">규칙 {nRules}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.length && <p className="p-6 text-center text-sm cd-text-faint">조건에 맞는 인원이 없습니다.</p>}
        </div>
      </div>

      {/* 우 — 대상 설정 */}
      <div className="cd-card rounded-2xl flex flex-col min-h-0">
        {!targets.length ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 cd-text-faint text-sm p-6 text-center">
            <ShieldAlert className="w-6 h-6" />
            왼쪽에서 인원을 누르면 개인 설정을, 여러 명을 체크하면 일괄 설정을 할 수 있습니다.
          </div>
        ) : (
          <>
            <div className="p-3 border-b cd-border-c flex flex-col gap-2 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[15px] font-bold cd-text">{targetLabel}</span>
                {!multi && focus && checked.size === 0 && focus.email && <span className="text-xs cd-text-faint">{focus.email}</span>}
                {multi && <span className="text-xs cd-text-faint">체크한 인원 전체에 같은 설정이 적용됩니다.</span>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs cd-text-faint">모드</span>
                <CdHelp topic="admin.attach-user-mode" />
                {(Object.keys(MODE_LABEL) as Mode[]).map((m) => {
                  const on = !multi && (checked.size ? users.find((u) => u.userId === [...checked][0]) : focus)?.mode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={busy}
                      data-active={on}
                      aria-pressed={on}
                      onClick={() => setMode(m)}
                      className={`cd-btn cd-btn-sm ${on ? "cd-btn-primary" : ""}`}
                      title={MODE_HINT[m]}
                    >
                      {MODE_LABEL[m]}
                    </button>
                  );
                })}
              </div>
              {!multi && <p className="text-[11px] cd-text-faint">{MODE_HINT[(checked.size ? users.find((u) => u.userId === [...checked][0]) : focus)?.mode ?? "default"]}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <select className="cd-select text-sm" style={{ width: 160 }} value={extCategory} onChange={(e) => setExtCategory(e.target.value)} aria-label="확장자 분류">
                  <option value="">모든 분류</option>
                  {Object.entries(categories).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <input className="cd-input text-sm" style={{ width: 150 }} placeholder="확장자 검색" value={extQ} onChange={(e) => setExtQ(e.target.value)} />
                {!multi && (
                  <label className="text-xs cd-text flex items-center gap-1">
                    <input type="checkbox" checked={extOnlyRule} onChange={(e) => setExtOnlyRule(e.target.checked)} /> 개인 규칙만
                  </label>
                )}
                {extChecked.size > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-xs">
                    <span className="cd-text font-bold">확장자 {extChecked.size}종</span>
                    <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => setRules([...extChecked], "allow")}>허용</button>
                    <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => setRules([...extChecked], "block")}>차단</button>
                    <button type="button" className="cd-btn cd-btn-sm" disabled={busy} onClick={() => setRules([...extChecked], "inherit")}>기본 따름</button>
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-sm">
                <thead className="cd-table-head sticky top-0 z-[1]" style={{ background: "var(--cd-surface)" }}>
                  <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                    <th className="p-2 pl-3 w-8">
                      <input
                        type="checkbox"
                        aria-label="확장자 전체 선택"
                        checked={extRows.length > 0 && extRows.every((r) => extChecked.has(r.ext))}
                        onChange={(e) => setExtChecked(e.target.checked ? new Set(extRows.map((r) => r.ext)) : new Set())}
                      />
                    </th>
                    <th className="text-left font-semibold p-2">확장자</th>
                    <th className="text-left font-semibold p-2">분류</th>
                    <th className="text-left font-semibold p-2 whitespace-nowrap">전사 기본</th>
                    <th className="text-left font-semibold p-2 whitespace-nowrap">개인 규칙</th>
                    {!multi && <th className="text-left font-semibold p-2 whitespace-nowrap">적용 결과</th>}
                  </tr>
                </thead>
                <tbody>
                  {extRows.map((c) => {
                    const subject = !multi ? (checked.size ? users.find((u) => u.userId === [...checked][0]) : focus) : null;
                    const rule = subject?.rules[c.ext];
                    const eff = subject ? effectiveBlocked(c, subject) : null;
                    return (
                      <tr key={c.ext} className="border-b cd-border-c last:border-0">
                        <td className="p-2 pl-3">
                          <input
                            type="checkbox"
                            checked={extChecked.has(c.ext)}
                            onChange={() =>
                              setExtChecked((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.ext)) next.delete(c.ext);
                                else next.add(c.ext);
                                return next;
                              })
                            }
                            aria-label={`.${c.ext} 선택`}
                          />
                        </td>
                        <td className="p-2 font-mono text-[13px] cd-text font-semibold whitespace-nowrap" title={c.description}>
                          .{c.ext}
                          <span className={`cd-pill ml-1.5 ${c.risk === "high" ? "cd-pill-error" : "cd-pill-warn"}`}>{c.risk === "high" ? "고" : "중"}</span>
                        </td>
                        <td className="p-2 text-[12px] cd-text-faint whitespace-nowrap">{categories[c.category] ?? c.category}</td>
                        <td className="p-2 text-[12px] whitespace-nowrap" style={{ color: c.blocked ? "var(--cd-error)" : "var(--cd-success)" }}>{c.blocked ? "차단" : "허용"}</td>
                        <td className="p-1.5">
                          <select
                            className="cd-select text-xs"
                            style={{ width: 110 }}
                            value={multi ? "" : rule ?? "inherit"}
                            disabled={busy}
                            onChange={(e) => {
                              const v = e.target.value as Rule | "inherit" | "";
                              if (v) setRules([c.ext], v);
                            }}
                            aria-label={`.${c.ext} 개인 규칙`}
                          >
                            {multi && <option value="">일괄 적용…</option>}
                            <option value="inherit">기본 따름</option>
                            <option value="allow">허용</option>
                            <option value="block">차단</option>
                          </select>
                        </td>
                        {!multi && (
                          <td className="p-2 whitespace-nowrap">
                            <span className={`cd-pill ${eff ? "cd-pill-error" : "cd-pill-success"}`}>{eff ? "차단" : "허용"}</span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!extRows.length && <p className="p-6 text-center text-sm cd-text-faint">조건에 맞는 확장자가 없습니다.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
