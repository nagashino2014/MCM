"use client";

import { useCallback, useEffect, useState } from "react";
import { CdBadge, CdButton, CdCheckbox, CdInput, CdModal, CdSelect, CdTable, CdTextarea, useCdToast } from "@/components/cdash";
import type { KosisSeriesConfig, OfficialCollectResult, OfficialSourceUpdate, OfficialSourceView } from "@/lib/intel/official-sources-types";
import { intelApi, intelTime, jsonBody, safeIntelUrl } from "./intelligence-client";

const PERMISSIONS = { collectionAllowed: "자동 수집 허용 확인", storageAllowed: "본문 저장 허용 확인", aiAllowed: "AI 분석 허용 확인", internalReportAllowed: "사내 보고서 이용 허용 확인" } as const;
const blankSeries = (): KosisSeriesConfig => ({ label: "", orgId: "", tblId: "", itmId: "", objL1: "", prdSe: "M" });

export function OfficialSourcesPanel({ canEdit }: { canEdit: boolean }) {
  const { toast } = useCdToast();
  const [sources, setSources] = useState<OfficialSourceView[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<OfficialSourceView | null>(null);
  const [form, setForm] = useState<OfficialSourceUpdate | null>(null);
  const [formError, setFormError] = useState("");
  const reload = useCallback(async () => {
    try { const result = await intelApi<{ sources: OfficialSourceView[]; canManage: boolean }>("/api/sales/intel/official-sources"); setSources(result.sources); setCanManage(result.canManage && canEdit); setError(""); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [canEdit]);
  useEffect(() => { void reload(); }, [reload]);
  function open(source: OfficialSourceView) {
    setSelected(source); setFormError(""); setForm({ providerId: source.providerId, enabled: source.enabled, expectedVersion: source.configVersion, permissions: { ...source.permissions }, config: structuredClone(source.config), authSecret: "" });
  }
  async function save() {
    if (!form) return;
    setBusy(true); setFormError("");
    try { await intelApi("/api/sales/intel/official-sources", { method: "PUT", ...jsonBody(form) }); setSelected(null); setForm(null); await reload(); toast("정보원 설정을 저장했습니다.", "success"); }
    catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  async function collect(source: OfficialSourceView) {
    setBusy(true); setFormError("");
    try {
      const result = await intelApi<OfficialCollectResult | { result: OfficialCollectResult }>(`/api/sales/intel/official-sources/${source.providerId}/collect`, { method: "POST" });
      const data = "result" in result ? result.result : result;
      if (["failed", "waiting", "busy"].includes(data.status)) setFormError(data.error || "현재 수집을 시작할 수 없습니다. 정보원 상태를 확인하세요.");
      else { toast(`수집을 확인했습니다. 신규 ${data.inserted}건 · 수정 ${data.changed}건`, "success"); setSelected(null); setForm(null); }
      await reload();
    } catch (e) { setFormError((e as Error).message); } finally { setBusy(false); }
  }
  function seriesChange(index: number, value: Partial<KosisSeriesConfig>) {
    if (form) setForm({ ...form, config: { ...form.config, series: (form.config.series ?? []).map((series, i) => i === index ? { ...series, ...value } : series) } });
  }
  return <div className="intel-stack">
    {error && <div className="intel-error" role="alert">{error}</div>}
    <section className="cd-card"><div className="p-5 flex flex-wrap justify-between gap-4"><h2 className="intel-section">공식 정보원</h2><CdButton disabled={busy} onClick={() => void reload()}>새로고침</CdButton></div>
      <CdTable bare rows={sources} rowKey={(source) => source.providerId} loading={loading} columns={[
        { key: "name", header: "정보원", render: (source) => <a className="intel-link" href={safeIntelUrl(source.homeUrl)} target="_blank" rel="noreferrer">{source.name}</a> },
        { key: "state", header: "상태", render: (source) => <CdBadge tone={source.state === "active" ? "success" : source.state === "error" ? "error" : "idle"}>{source.stateLabel}</CdBadge> },
        { key: "last", header: "최근 수집 (KST)", render: (source) => intelTime(source.lastSuccessAt) },
        { key: "next", header: "주기", render: (source) => source.referenceOnly ? "원문 참조" : source.intervalHours === 24 ? "매일" : source.intervalHours === 168 ? "매주" : `${source.intervalHours}시간` },
        { key: "action", header: "상세", render: (source) => <CdButton size="sm" onClick={() => open(source)}>{canManage && !source.referenceOnly ? "설정" : "보기"}</CdButton> },
      ]} />
    </section>
    <CdModal open={selected !== null} onClose={() => !busy && setSelected(null)} title={selected?.name ?? "공식 정보원"} size="xl" closeOnBackdrop={false} footer={<>
      <CdButton disabled={busy} onClick={() => setSelected(null)}>닫기</CdButton>
      {canManage && selected && !selected.referenceOnly && <><CdButton disabled={busy} onClick={() => void collect(selected)}>저장값 수집 확인</CdButton><CdButton variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "처리 중…" : "설정 저장"}</CdButton></>}
    </>}>
      {selected && form && <div className="intel-ui intel-form">
        {formError && <div className="intel-error" role="alert">{formError}</div>}
        {selected.lastError && <div className="intel-error" role="alert">최근 수집 오류: {selected.lastError}</div>}
        <p className="intel-prose cd-text-muted">{selected.note}</p>
        <dl className="intel-dl"><dt>현재 상태</dt><dd>{selected.stateLabel}</dd><dt>실수집 검증</dt><dd>{intelTime(selected.verifiedAt)}</dd></dl>
        <div className="flex flex-wrap gap-4">{selected.referenceUrls.map((url, index) => <a key={url} href={safeIntelUrl(url)} className="intel-link intel-compact" target="_blank" rel="noreferrer">공식 이용 안내 {index + 1}</a>)}</div>
        {!selected.referenceOnly && <fieldset disabled={!canManage || busy} className="intel-form">
          <legend className="intel-section mb-3 mt-4">수집 설정</legend>
          <CdCheckbox label="정기 수집 사용" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          {selected.requiresSecret && <CdInput label={selected.providerId === "law" ? "국가법령정보 OC API 인증값" : "인증키"} type="password" autoComplete="new-password" placeholder={selected.hasSecret ? "등록됨 · 변경할 때만 입력" : "발급받은 값 입력"} value={form.authSecret ?? ""} onChange={(event) => setForm({ ...form, authSecret: event.target.value })} />}
          {selected.providerId === "kosis" && <div className="intel-stack">
            {(form.config.series ?? []).map((series, index) => <div key={index} className="intel-subsection"><div className="flex justify-between items-center mb-3"><h3 className="font-medium">통계 지표 {index + 1}</h3><CdButton size="sm" onClick={() => setForm({ ...form, config: { ...form.config, series: form.config.series?.filter((_, i) => index !== i) } })}>제거</CdButton></div>
              <div className="grid sm:grid-cols-2 gap-4">{([["label", "지표 이름"], ["orgId", "기관 코드"], ["tblId", "통계표 코드"], ["itmId", "항목 코드"], ["objL1", "분류 1 코드"], ["objL2", "분류 2 코드 (선택)"]] as const).map(([key, label]) => <CdInput key={key} label={label} value={series[key] ?? ""} onChange={(event) => seriesChange(index, { [key]: event.target.value })} />)}<CdSelect label="통계 주기" value={series.prdSe} onChange={(event) => seriesChange(index, { prdSe: event.target.value as "M" | "Q" | "Y" })}><option value="M">월</option><option value="Q">분기</option><option value="Y">연도</option></CdSelect></div>
            </div>)}
            <CdButton disabled={(form.config.series?.length ?? 0) >= 6} onClick={() => setForm({ ...form, config: { ...form.config, series: [...(form.config.series ?? []), blankSeries()] } })}>통계 지표 추가</CdButton>
          </div>}
          {selected.providerId === "law" && <div className="intel-stack">{(form.config.laws ?? []).map((law, index) => <div key={index} className="grid sm:grid-cols-[1fr_1fr_auto] gap-4 items-end"><CdInput label="법령 ID / 행정규칙 ID(LID)" value={law.id} onChange={(event) => setForm({ ...form, config: { ...form.config, laws: form.config.laws?.map((value, i) => i === index ? { ...value, id: event.target.value } : value) } })} /><CdSelect label="구분" value={law.target} onChange={(event) => setForm({ ...form, config: { ...form.config, laws: form.config.laws?.map((value, i) => i === index ? { ...value, target: event.target.value as "law" | "admrul" } : value) } })}><option value="law">법령</option><option value="admrul">행정규칙</option></CdSelect><CdButton onClick={() => setForm({ ...form, config: { ...form.config, laws: form.config.laws?.filter((_, i) => i !== index) } })}>제거</CdButton></div>)}<CdButton disabled={(form.config.laws?.length ?? 0) >= 25} onClick={() => setForm({ ...form, config: { ...form.config, laws: [...(form.config.laws ?? []), { id: "", target: "law" }] } })}>법령 추가</CdButton></div>}
          {!["kosis", "law"].includes(selected.providerId) && <CdInput label="공식 게시판 주소" type="url" value={form.config.channelUrl ?? ""} onChange={(event) => setForm({ ...form, config: { ...form.config, channelUrl: event.target.value } })} />}
          <h3 className="intel-section mt-4">이용 범위</h3><div className="grid sm:grid-cols-2 gap-4">{Object.entries(PERMISSIONS).map(([key, label]) => <CdCheckbox key={key} label={label} checked={form.permissions[key as keyof typeof PERMISSIONS]} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, [key]: event.target.checked } })} />)}</div>
          <CdInput label="이용 허용 근거 주소" type="url" value={form.permissions.evidenceUrl} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, evidenceUrl: event.target.value } })} />
          <CdTextarea label="검토 메모" rows={3} value={form.permissions.note} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, note: event.target.value } })} />
        </fieldset>}
      </div>}
    </CdModal>
  </div>;
}
