"use client";

// 전자결재 기안 작성 — 양식 렌더러(제어) + 제목/긴급 + 결재선 편집(조직도 선택) + 임시저장/상신.
// 값은 field_key 기반 구조화 저장(field_values). 결재선은 순차 단계 리스트(합의/승인)로 구성한다.
// 설계: docs/e-approval-blueprint.md §5-2.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Send, Save, Trash2, Users, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalFormRenderer } from "@/components/approval/ApprovalFormRenderer";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationSnapshot } from "@/components/admin/users/types";
import type { ApprovalFieldDef } from "@/lib/approval/fields";
import "@/components/cdash/cdash.css";

interface FormInfo {
  formId: string;
  name: string;
  fields: ApprovalFieldDef[];
}

interface LineStep {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName: string;
  assigneePosition: string | null;
}

export function ApprovalDraftBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const formId = sp.get("formId") ?? "";
  const editDocId = sp.get("docId");

  const [form, setForm] = useState<FormInfo | null>(null);
  const [docId, setDocId] = useState<string | null>(editDocId);
  const [title, setTitle] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [line, setLine] = useState<LineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [orgModal, setOrgModal] = useState<"agree" | "approve" | null>(null);
  const [orgSnapshot, setOrgSnapshot] = useState<OrganizationSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (editDocId) {
          const res = await fetch(`/api/approval/docs/${encodeURIComponent(editDocId)}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "문서를 불러오지 못했습니다.");
          if (cancelled) return;
          const d = data.doc;
          setForm({ formId: d.formId, name: d.formName, fields: d.fields });
          setTitle(d.title ?? "");
          setUrgent(!!d.urgent);
          setValues(d.fieldValues ?? {});
          setLine(
            (d.steps ?? []).map((s: { stepType: string; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }) => ({
              stepType: s.stepType === "agree" ? "agree" : "approve",
              assigneeUserId: s.assigneeUserId,
              assigneeName: s.assigneeName ?? "",
              assigneePosition: s.assigneePosition,
            }))
          );
        } else {
          if (!formId) throw new Error("양식이 지정되지 않았습니다. 전자결재 홈에서 '새 기안'으로 진입하세요.");
          const res = await fetch(`/api/approval/forms/${encodeURIComponent(formId)}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "양식을 불러오지 못했습니다.");
          if (cancelled) return;
          setForm({ formId: data.form.formId, name: data.form.name, fields: data.form.fields });
          setTitle(data.form.name);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId, editDocId]);

  const openOrgModal = async (stepType: "agree" | "approve") => {
    setOrgModal(stepType);
    if (!orgSnapshot) {
      try {
        const res = await fetch("/api/sales/org", { cache: "no-store" });
        if (res.ok) setOrgSnapshot((await res.json()) as OrganizationSnapshot);
      } catch {
        // 무시
      }
    }
  };

  const send = useCallback(
    async (action: "save" | "submit") => {
      if (!form) return;
      if (action === "submit") {
        const missing = form.fields.filter((f) => f.required && f.type !== "static").filter((f) => {
          const v = values[f.key];
          if (v == null) return true;
          if (typeof v === "string") return !v.trim();
          if (Array.isArray(v)) return v.length === 0;
          if (typeof v === "object") return Object.values(v as Record<string, unknown>).every((x) => !String(x ?? "").trim());
          return false;
        });
        if (missing.length) {
          alert(`필수 항목을 입력하세요: ${missing.map((f) => f.label).join(", ")}`);
          return;
        }
        if (line.length === 0) {
          alert("결재선에 결재자를 1명 이상 추가하세요.");
          return;
        }
      }
      setBusy(action);
      try {
        const res = await fetch("/api/approval/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            docId,
            formId: form.formId,
            title,
            urgent,
            fieldValues: values,
            line,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "저장 실패");
        setDocId(data.docId);
        if (action === "submit") {
          alert(`상신되었습니다. 문서번호: ${data.docNo}`);
          router.push("/approval");
        }
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [form, docId, title, urgent, values, line, router]
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        eyebrow="Approval · Draft"
        title={form ? `기안 작성 — ${form.name}` : "기안 작성"}
        subtitle="입력 값은 항목별 데이터로 저장되어 결재 완료 후 분류·집계에 활용됩니다."
        actions={
          <Link href="/approval" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> 전자결재 홈
          </Link>
        }
      />

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : error ? (
        <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>
      ) : form ? (
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="cd-card rounded-3xl p-5 flex-1 min-w-0 flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-[11px] cd-text-faint flex flex-col gap-1 flex-1 min-w-[260px]">
                제목
                <input className="cd-input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer mt-4">
                <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 긴급
              </label>
            </div>
            <ApprovalFormRenderer
              fields={form.fields}
              values={values}
              onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            />
          </div>

          {/* 결재선 */}
          <div className="cd-card rounded-3xl p-5 w-full xl:w-[320px] shrink-0 flex flex-col gap-3">
            <h3 className="font-bold cd-text text-sm flex items-center gap-2">
              <Users className="w-4 h-4 cd-text-primary" /> 결재선
              <span className="ml-auto text-[11px] font-normal cd-text-faint">기안 → 위에서 아래 순서</span>
            </h3>
            {line.length === 0 && <p className="text-[12px] cd-text-faint">아래 버튼으로 합의/승인 결재자를 추가하세요.</p>}
            <div className="flex flex-col gap-1.5">
              {line.map((s, i) => (
                <div key={`${s.assigneeUserId}-${i}`} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                  <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                  <select
                    className="cd-select"
                    style={{ width: 70 }}
                    value={s.stepType}
                    onChange={(e) =>
                      setLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, stepType: e.target.value as "agree" | "approve" } : x)))
                    }
                  >
                    <option value="agree">합의</option>
                    <option value="approve">승인</option>
                  </select>
                  <span className="text-[12.5px] cd-text truncate flex-1">
                    {s.assigneeName}
                    {s.assigneePosition ? <span className="cd-text-faint text-[11px]"> {s.assigneePosition}</span> : null}
                  </span>
                  <button
                    type="button"
                    className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                    title="제거"
                    onClick={() => setLine((prev) => prev.filter((_, xi) => xi !== i))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint" onClick={() => openOrgModal("approve")}>
              ＋ 조직도에서 결재자 추가
            </button>
            <p className="text-[10.5px] cd-text-faint">
              결재자가 승인된 휴가 기간 중이면 지정된 대결자에게 자동 위임됩니다(대결 표기).
            </p>
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("save")}
              >
                <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "임시저장"}
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("submit")}
              >
                <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 조직도 선택 모달 */}
      {orgModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setOrgModal(null)}>
          <div
            className="cdash cdash-vars cd-fields-white cd-card-bg rounded-2xl border cd-border-c w-full max-w-md max-h-[80vh] overflow-y-auto p-4 flex flex-col gap-2"
            data-theme={theme}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex-1">결재자 추가 — 조직도에서 선택</h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setOrgModal(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {orgSnapshot ? (
              <OrganizationTree
                snapshot={orgSnapshot}
                embedded
                hideHeader
                onSelectEmployee={(emp) => {
                  if (!emp.userId) {
                    alert(`${emp.name} 님은 아직 계정이 연결되지 않아 결재자로 지정할 수 없습니다.`);
                    return;
                  }
                  const userId = emp.userId;
                  setLine((prev) =>
                    prev.some((s) => s.assigneeUserId === userId)
                      ? prev
                      : [...prev, { stepType: orgModal, assigneeUserId: userId, assigneeName: emp.name, assigneePosition: emp.positionName }]
                  );
                }}
              />
            ) : (
              <p className="text-[12px] cd-text-faint py-6 text-center">조직도를 불러오는 중입니다.</p>
            )}
            <p className="text-[10px] cd-text-faint">인원을 클릭하면 결재선 맨 뒤에 추가됩니다. 타입(합의/승인)은 목록에서 변경하세요.</p>
          </div>
        </div>
      )}
    </div>
  );
}
