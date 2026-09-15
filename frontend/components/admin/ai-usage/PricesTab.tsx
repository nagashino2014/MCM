"use client";

// 단가·모델 탭 — 상단: 모델별 공시 단가(편집·추가, 적용일 이력), 하단: 실측 평균 호출 단가(§3.7, 입력/출력 분해).

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdModal } from "@/components/cdash/CdModal";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import { fmtInt, fmtPct, fmtUsd, fmtUsdSmall, modelLabel, type ModelPriceRow, type SummaryResponse } from "./types";

interface Props {
  data: SummaryResponse;
  canManage: boolean;
  onChanged: () => void;
}

interface FormState {
  modelFamily: string;
  displayName: string;
  effectiveFrom: string;
  inputPerMtok: string;
  cacheWritePerMtok: string;
  cacheReadPerMtok: string;
  outputPerMtok: string;
  supportsVision: boolean;
  contextTokens: string;
  selectable: boolean;
  note: string;
}

const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function toForm(p: ModelPriceRow | null): FormState {
  return {
    modelFamily: p?.modelFamily ?? "",
    displayName: p?.displayName ?? "",
    effectiveFrom: todayKst(),
    inputPerMtok: p ? String(p.inputPerMtok) : "",
    cacheWritePerMtok: p ? String(p.cacheWritePerMtok) : "",
    cacheReadPerMtok: p ? String(p.cacheReadPerMtok) : "",
    outputPerMtok: p ? String(p.outputPerMtok) : "",
    supportsVision: p?.supportsVision ?? true,
    contextTokens: p ? String(p.contextTokens) : "200000",
    selectable: p?.selectable ?? true,
    note: p?.note ?? "",
  };
}

export function PricesTab({ data, canManage, onChanged }: Props) {
  const [editing, setEditing] = useState<{ row: ModelPriceRow | null; form: FormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 입력 단가를 바꾸면 캐시 단가 기본 비율(×1.25 / ×0.1)을 따라가게 — 비워 둔 경우에만.
  useEffect(() => {
    if (!editing) return;
    const inp = Number(editing.form.inputPerMtok);
    if (!Number.isFinite(inp) || inp <= 0) return;
    setEditing((e) =>
      e && !e.form.cacheWritePerMtok && !e.form.cacheReadPerMtok
        ? { ...e, form: { ...e.form, cacheWritePerMtok: String(Math.round(inp * 125) / 100), cacheReadPerMtok: String(Math.round(inp * 10) / 100) } }
        : e
    );
  }, [editing?.form.inputPerMtok]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    if (!/^claude-[a-z0-9-]+$/.test(f.modelFamily.trim())) return setErr("모델 ID 는 claude-… 형식(정규형, 날짜 접미사 없음)이어야 합니다.");
    if (!isValidDateString(f.effectiveFrom)) return setErr("적용일을 확인하세요.");
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/ai-usage/prices", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modelFamily: f.modelFamily.trim(),
          displayName: f.displayName.trim(),
          effectiveFrom: f.effectiveFrom,
          inputPerMtok: Number(f.inputPerMtok),
          cacheWritePerMtok: Number(f.cacheWritePerMtok),
          cacheReadPerMtok: Number(f.cacheReadPerMtok),
          outputPerMtok: Number(f.outputPerMtok),
          supportsVision: f.supportsVision,
          contextTokens: Number(f.contextTokens),
          selectable: f.selectable,
          note: f.note,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "저장하지 못했습니다.");
      setEditing(null);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setF = (patch: Partial<FormState>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const numField = (key: keyof FormState, label: string) => (
    <label className="flex flex-col gap-1">
      <span className="cd-label">{label}</span>
      <input className="cd-input" inputMode="decimal" value={String(editing?.form[key] ?? "")} onChange={(e) => setF({ [key]: e.target.value.replace(/[^0-9.]/g, "") } as Partial<FormState>)} />
    </label>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="cd-card-title">모델 단가표 (USD / 1M 토큰)</h3>
          <span className="text-[11px] cd-text-faint">모델별 최신 적용일 행이 현재 단가 · 적용일을 새로 주면 이전 단가는 이력으로 남습니다</span>
          {canManage && (
            <CdButton size="sm" variant="soft" className="ml-auto" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing({ row: null, form: toForm(null) })}>
              모델 추가
            </CdButton>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left">모델</th>
                <th className="py-2 px-2 text-left">적용일</th>
                <th className="py-2 px-2 text-right">입력</th>
                <th className="py-2 px-2 text-right">캐시 쓰기</th>
                <th className="py-2 px-2 text-right">캐시 읽기</th>
                <th className="py-2 px-2 text-right">출력</th>
                <th className="py-2 px-2 text-center">비전</th>
                <th className="py-2 px-2 text-right">컨텍스트</th>
                <th className="py-2 px-2 text-center">선택 가능</th>
                <th className="py-2 px-2 text-left">메모</th>
                <th className="py-2 px-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {data.prices.map((p) => (
                <tr key={p.modelFamily} className="border-b cd-border-c cd-row-hover">
                  <td className="py-2 px-2">
                    <div className="font-medium">{p.displayName}</div>
                    <div className="text-[10px] cd-text-faint font-mono">{p.modelFamily}</div>
                  </td>
                  <td className="py-2 px-2 text-xs tabular-nums cd-text-faint">{p.effectiveFrom}</td>
                  <td className="py-2 px-2 text-right tabular-nums">${p.inputPerMtok}</td>
                  <td className="py-2 px-2 text-right tabular-nums cd-text-faint">${p.cacheWritePerMtok}</td>
                  <td className="py-2 px-2 text-right tabular-nums cd-text-faint">${p.cacheReadPerMtok}</td>
                  <td className="py-2 px-2 text-right tabular-nums">${p.outputPerMtok}</td>
                  <td className="py-2 px-2 text-center">{p.supportsVision ? "○" : <span className="cd-text-faint">–</span>}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-xs">{(p.contextTokens / 1000).toLocaleString()}K</td>
                  <td className="py-2 px-2 text-center">{p.selectable ? <span className="cd-pill cd-pill-success text-[10px]">노출</span> : <span className="cd-pill cd-pill-idle text-[10px]">숨김</span>}</td>
                  <td className="py-2 px-2 text-xs cd-text-faint">{p.note ?? ""}</td>
                  <td className="py-2 px-2 text-right">
                    {canManage && (
                      <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" title="단가 수정(새 적용일)" onClick={() => setEditing({ row: p, form: toForm(p) })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3 className="cd-card-title">모델별 실측 평균 호출 단가</h3>
          <span className="text-[11px] cd-text-faint">{data.range.from} ~ {data.range.to} · 로그 기준 · 입력비/출력비는 현재 단가로 재계산 · 표본 5건 미만은 참고만</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-faint text-xs border-b cd-border-c">
                <th className="py-2 px-2 text-left">모델</th>
                <th className="py-2 px-2 text-right">호출</th>
                <th className="py-2 px-2 text-right">평균 입력 tok</th>
                <th className="py-2 px-2 text-right">평균 출력 tok</th>
                <th className="py-2 px-2 text-right">캐시 적중률</th>
                <th className="py-2 px-2 text-right">호출당 입력비</th>
                <th className="py-2 px-2 text-right">호출당 출력비</th>
                <th className="py-2 px-2 text-right">호출당 합계</th>
                <th className="py-2 px-2 text-right">입력:출력</th>
                <th className="py-2 px-2 text-right">기간 합계</th>
                <th className="py-2 px-2 text-right">최대 단건</th>
              </tr>
            </thead>
            <tbody>
              {data.models.length === 0 ? (
                <tr><td colSpan={11} className="py-8 text-center cd-text-faint">기간 내 호출이 없습니다.</td></tr>
              ) : (
                data.models.map((m) => {
                  const ratio = m.avgCostIn != null && m.avgCostOut != null && m.avgCostIn + m.avgCostOut > 0 ? (m.avgCostIn / (m.avgCostIn + m.avgCostOut)) * 100 : null;
                  return (
                    <tr key={m.modelFamily} className="border-b cd-border-c">
                      <td className="py-2 px-2">
                        <span className="font-medium">{modelLabel(m.modelFamily, data.prices)}</span>
                        {m.calls < 5 && <span className="ml-1.5 cd-pill cd-pill-idle text-[10px]">표본 부족</span>}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtInt(m.calls)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtInt(m.avgInputTokens)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtInt(m.avgOutputTokens)}</td>
                      <td className="py-2 px-2 text-right tabular-nums cd-text-faint">{fmtPct(m.cacheHitRate)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtUsdSmall(m.avgCostIn)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtUsdSmall(m.avgCostOut)}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-semibold">{fmtUsdSmall(m.avgCost)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs cd-text-faint">{ratio != null ? `${Math.round(ratio)} : ${100 - Math.round(ratio)}` : "-"}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtUsd(m.cost, 3)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs">{fmtUsdSmall(m.maxCost)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CdModal open={!!editing} onClose={() => (saving ? undefined : setEditing(null))} title={editing?.row ? `단가 수정 — ${editing.row.displayName}` : "모델 추가"} size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <CdButton variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}>취소</CdButton>
            <CdButton variant="primary" size="sm" onClick={save} disabled={saving} icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>저장</CdButton>
          </div>
        }
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="cd-label">모델 ID (정규형)</span>
              <input className="cd-input font-mono" placeholder="claude-sonnet-5" value={editing.form.modelFamily} onChange={(e) => setF({ modelFamily: e.target.value.trim() })} disabled={!!editing.row} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="cd-label">표시명</span>
              <input className="cd-input" value={editing.form.displayName} onChange={(e) => setF({ displayName: e.target.value })} />
            </label>
            <CdDateInput label="적용일" value={editing.form.effectiveFrom} onChange={(v) => setF({ effectiveFrom: v })} hint="같은 적용일이면 덮어쓰고, 새 적용일이면 이력이 남습니다" />
            <label className="flex flex-col gap-1">
              <span className="cd-label">컨텍스트(토큰)</span>
              <input className="cd-input" inputMode="numeric" value={editing.form.contextTokens} onChange={(e) => setF({ contextTokens: e.target.value.replace(/\D/g, "") })} />
            </label>
            {numField("inputPerMtok", "입력 $/1M")}
            {numField("outputPerMtok", "출력 $/1M")}
            {numField("cacheWritePerMtok", "캐시 쓰기 $/1M (기본 입력×1.25)")}
            {numField("cacheReadPerMtok", "캐시 읽기 $/1M (기본 입력×0.1)")}
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editing.form.supportsVision} onChange={(e) => setF({ supportsVision: e.target.checked })} /> 이미지·PDF 입력 지원
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editing.form.selectable} onChange={(e) => setF({ selectable: e.target.checked })} /> 기능별 모델 셀렉트에 노출
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="cd-label">메모</span>
              <input className="cd-input" value={editing.form.note} onChange={(e) => setF({ note: e.target.value })} />
            </label>
            {err && <div className="col-span-2 text-xs cd-error-text">{err}</div>}
          </div>
        )}
      </CdModal>
    </div>
  );
}
