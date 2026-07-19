"use client";

// 발주처 양식 분석·미세조정 패널 — 업로드된 HWPX 양식을 LLM 으로 분석해 표준 문서 타입·셀
// 매핑(form_profile)을 만들고, 항목 추가/삭제·매핑 수정으로 보정한다(변칙 양식 대응).
// docs/bid-package-blueprint.md §1-3 / P2

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { catalogFieldsOf, DOC_TYPE_LABELS, PACKAGE_DOC_CATALOG } from "@/lib/bid/package-catalog";

interface ProfileField {
  field: string;
  label: string;
  table: number | null;
  row: number | null;
  col: number | null;
}

interface ProfileRepeatCol {
  col: number;
  field: string;
  label: string;
}

interface ProfileRepeat {
  table: number;
  fromRow: number;
  columns: ProfileRepeatCol[];
}

interface ProfileDoc {
  docType: string;
  title: string;
  tables: number[];
  fields: ProfileField[];
  repeat: ProfileRepeat | null;
  perPersonTable: boolean;
}

interface FormProfile {
  analyzedAt: string;
  model: string;
  documents: ProfileDoc[];
}

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? "요청 실패");
  return data;
}

export function FormProfilePanel({
  formId,
  hasProfile,
  onProfileChange,
}: {
  formId: string;
  hasProfile: boolean;
  /** 분석/저장으로 매핑 보유 상태가 바뀌면 부모(문서 생성 버튼 활성 조건)에 알림. */
  onProfileChange?: (has: boolean) => void;
}) {
  const [profile, setProfile] = useState<FormProfile | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openDocs, setOpenDocs] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try {
      const data = (await jfetch(`/api/sales/bids/package/form/profile?formId=${encodeURIComponent(formId)}`)) as { profile: FormProfile | null };
      setProfile(data.profile);
    } catch {
      setProfile(null);
    }
  }, [formId]);

  useEffect(() => {
    if (hasProfile) load();
    else setProfile(null);
  }, [hasProfile, load]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const data = (await jfetch("/api/sales/bids/package/form/analyze", {
        method: "POST",
        body: JSON.stringify({ formId }),
      })) as { profile: FormProfile };
      setProfile(data.profile);
      onProfileChange?.(true);
      alert(`양식 분석 완료 — 서류 ${data.profile.documents.length}종을 식별했습니다. 매핑을 확인·보정하세요.`);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const data = (await jfetch("/api/sales/bids/package/form/profile", {
        method: "PUT",
        body: JSON.stringify({ formId, profile }),
      })) as { profile: FormProfile };
      setProfile(data.profile);
      alert("매핑을 저장했습니다.");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setDoc = (i: number, patch: Partial<ProfileDoc>) =>
    setProfile((prev) =>
      prev ? { ...prev, documents: prev.documents.map((d, j) => (j === i ? { ...d, ...patch } : d)) } : prev
    );

  return (
    <div className="mt-3 border-t cd-border-c pt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h4 className="text-[12px] font-bold cd-text">양식 항목 매핑</h4>
        {profile && (
          <span className="text-[10px] cd-text-faint">
            {profile.documents.length}종 식별 · {profile.analyzedAt?.slice(0, 16).replace("T", " ")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {profile && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Save className="w-3.5 h-3.5" /> {saving ? "저장 중..." : "매핑 저장"}
            </button>
          )}
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing}
            className="cd-btn cd-btn-soft rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Wand2 className="w-3.5 h-3.5" /> {analyzing ? "분석 중... (최대 2~3분)" : profile ? "재분석" : "양식 분석"}
          </button>
        </div>
      </div>

      {!profile && !analyzing && (
        <p className="text-[11px] cd-text-faint">
          '양식 분석'을 누르면 업로드된 HWPX 양식의 표·셀을 LLM 이 표준 서류 항목에 매핑합니다.
        </p>
      )}

      {profile?.documents.map((doc, di) => {
        const isOpen = openDocs[di] === true;
        const { fields: catFields, repeatFields: catRepeats } = catalogFieldsOf(doc.docType);
        return (
          <div key={di} className="rounded-xl border cd-border-c">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[color:var(--cd-surface)]"
              onClick={() => setOpenDocs((prev) => ({ ...prev, [di]: !prev[di] }))}
            >
              {isOpen ? <ChevronDown className="w-4 h-4 cd-text-faint shrink-0" /> : <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />}
              <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary shrink-0">
                {DOC_TYPE_LABELS[doc.docType] ?? "미분류"}
              </span>
              <span className="text-xs cd-text truncate flex-1">{doc.title || "(표제 없음)"}</span>
              <span className="text-[10px] cd-text-faint shrink-0">
                필드 {doc.fields.length}
                {doc.repeat ? ` · 반복열 ${doc.repeat.columns.length}` : ""}
                {doc.perPersonTable ? " · 인당 1표" : ""}
              </span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 flex flex-col gap-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="cd-text-faint shrink-0">문서 타입</span>
                  <select
                    className="cd-select"
                    style={{ width: 220 }}
                    value={doc.docType}
                    onChange={(e) => setDoc(di, { docType: e.target.value })}
                  >
                    {PACKAGE_DOC_CATALOG.map((d) => (
                      <option key={d.type} value={d.type}>{d.label}</option>
                    ))}
                    <option value="unknown">미분류</option>
                  </select>
                  <label className="flex items-center gap-1 cd-text-faint ml-2">
                    <input
                      type="checkbox"
                      checked={doc.perPersonTable}
                      onChange={(e) => setDoc(di, { perPersonTable: e.target.checked })}
                    />
                    인당 1표 복제
                  </label>
                  <span className="ml-auto cd-text-faint">표 {doc.tables.join(", ")}</span>
                </div>

                {/* 단일 필드 */}
                {doc.fields.map((f, fi) => (
                  <div key={fi} className="grid grid-cols-[180px_1fr_54px_44px_44px_28px] gap-1.5 items-center">
                    <select
                      className="cd-select !py-1"
                      value={catFields.some((c) => c.key === f.field) ? f.field : "__custom"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDoc(di, {
                          fields: doc.fields.map((x, j) =>
                            j === fi ? { ...x, field: v === "__custom" ? `custom:${x.label || "field"}` : v } : x
                          ),
                        });
                      }}
                    >
                      {catFields.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                      <option value="__custom">직접 항목(custom)</option>
                    </select>
                    <input
                      className="cd-input !py-1"
                      value={f.label}
                      placeholder="양식 라벨"
                      onChange={(e) => setDoc(di, { fields: doc.fields.map((x, j) => (j === fi ? { ...x, label: e.target.value } : x)) })}
                    />
                    <input
                      className="cd-input !py-1 font-mono text-center"
                      title="표 번호"
                      value={f.table ?? ""}
                      onChange={(e) => setDoc(di, { fields: doc.fields.map((x, j) => (j === fi ? { ...x, table: e.target.value === "" ? null : Number(e.target.value) } : x)) })}
                    />
                    <input
                      className="cd-input !py-1 font-mono text-center"
                      title="행"
                      value={f.row ?? ""}
                      onChange={(e) => setDoc(di, { fields: doc.fields.map((x, j) => (j === fi ? { ...x, row: e.target.value === "" ? null : Number(e.target.value) } : x)) })}
                    />
                    <input
                      className="cd-input !py-1 font-mono text-center"
                      title="열"
                      value={f.col ?? ""}
                      onChange={(e) => setDoc(di, { fields: doc.fields.map((x, j) => (j === fi ? { ...x, col: e.target.value === "" ? null : Number(e.target.value) } : x)) })}
                    />
                    <button
                      type="button"
                      className="cd-btn cd-btn-ghost rounded p-1"
                      onClick={() => setDoc(di, { fields: doc.fields.filter((_, j) => j !== fi) })}
                    >
                      <Trash2 className="w-3 h-3 cd-text-faint" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="cd-btn cd-btn-soft rounded-lg px-2.5 py-1 text-[11px] self-start inline-flex items-center gap-1"
                  onClick={() => setDoc(di, { fields: [...doc.fields, { field: catFields[0]?.key ?? "custom:field", label: "", table: doc.tables[0] ?? 0, row: 0, col: 0 }] })}
                >
                  <Plus className="w-3 h-3" /> 항목 추가
                </button>

                {/* 반복 행 */}
                {doc.repeat && (
                  <div className="rounded-lg border cd-border-c p-2 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold cd-text">반복 행 (표 {doc.repeat.table})</span>
                      <span className="cd-text-faint">데이터 시작 행</span>
                      <input
                        className="cd-input !py-0.5 font-mono text-center"
                        style={{ width: 48 }}
                        value={doc.repeat.fromRow}
                        onChange={(e) => setDoc(di, { repeat: { ...doc.repeat!, fromRow: Number(e.target.value) || 0 } })}
                      />
                    </div>
                    {doc.repeat.columns.map((c, ci) => (
                      <div key={ci} className="grid grid-cols-[44px_180px_1fr_28px] gap-1.5 items-center">
                        <input
                          className="cd-input !py-1 font-mono text-center"
                          title="열"
                          value={c.col}
                          onChange={(e) => setDoc(di, { repeat: { ...doc.repeat!, columns: doc.repeat!.columns.map((x, j) => (j === ci ? { ...x, col: Number(e.target.value) || 0 } : x)) } })}
                        />
                        <select
                          className="cd-select !py-1"
                          value={catRepeats.some((r) => r.key === c.field) ? c.field : "__custom"}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDoc(di, { repeat: { ...doc.repeat!, columns: doc.repeat!.columns.map((x, j) => (j === ci ? { ...x, field: v === "__custom" ? `custom:${x.label || "col"}` : v } : x)) } });
                          }}
                        >
                          {catRepeats.map((r) => (
                            <option key={r.key} value={r.key}>{r.label}</option>
                          ))}
                          <option value="__custom">직접 항목(custom)</option>
                        </select>
                        <input
                          className="cd-input !py-1"
                          value={c.label}
                          placeholder="양식 열 라벨"
                          onChange={(e) => setDoc(di, { repeat: { ...doc.repeat!, columns: doc.repeat!.columns.map((x, j) => (j === ci ? { ...x, label: e.target.value } : x)) } })}
                        />
                        <button
                          type="button"
                          className="cd-btn cd-btn-ghost rounded p-1"
                          onClick={() => setDoc(di, { repeat: { ...doc.repeat!, columns: doc.repeat!.columns.filter((_, j) => j !== ci) } })}
                        >
                          <Trash2 className="w-3 h-3 cd-text-faint" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="cd-btn cd-btn-soft rounded-lg px-2.5 py-1 text-[11px] self-start inline-flex items-center gap-1"
                      onClick={() => setDoc(di, { repeat: { ...doc.repeat!, columns: [...doc.repeat!.columns, { col: 0, field: catRepeats[0]?.key ?? "custom:col", label: "" }] } })}
                    >
                      <Plus className="w-3 h-3" /> 반복 열 추가
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
