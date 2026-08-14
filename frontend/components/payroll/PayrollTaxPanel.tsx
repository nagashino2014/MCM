"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, RefreshCw, Save } from "lucide-react";

/**
 * 세액 설정 패널 (PL-P4, §6-2 B)
 * - 직원별 원천징수 비율(80/100/120)·공제대상가족수·8~20세 자녀수 — 소득세 간이세액표 lookup 축.
 * - 세무사 소득세액공제신고서 엑셀 업로드로 초기 적재(성명 매칭·부양가족 명부 파싱).
 * - 간이세액표 버전 카드: 국세청 개정 감지·원클릭 갱신(공공데이터포털 메타 기반).
 */

interface ProfileRow {
  employeeId: string;
  employeeName: string;
  withholdingRate: number;
  dependents: number;
  childDeduction: number;
  specialRelation: boolean;
  source: string | null;
  dirty?: boolean;
}

interface TaxTableState {
  local: { yearVersion: number | null; rows: number };
  remote: { stdrYear: number | null; stdrDe: string | null; nextRegist: string | null } | null;
  updateAvailable: boolean;
}

interface RateRow {
  rateId: string;
  kind: string;
  validFrom: string;
  rate: number;
  source: string;
  note: string | null;
}

const RATE_KIND_LABELS: Record<string, string> = {
  ei: "고용보험(과세급여 대비 %)",
  ltc: "장기요양(건보료 대비 %)",
  "ei-exempt-age": "고용보험 면제 연령(만)",
  "nps-max-age": "국민연금 제외 연령(만)",
};
const RATE_SOURCE_LABELS: Record<string, string> = { seed: "초기값", "edi-derived": "EDI 자동 역산", manual: "수동" };

export default function PayrollTaxPanel() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [table, setTable] = useState<TaxTableState | null>(null);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [rateDraft, setRateDraft] = useState({ kind: "ltc", validFrom: "", rate: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/payroll/tax-profiles", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => setProfiles([]));
    fetch("/api/payroll/tax-table", { cache: "no-store" })
      .then((r) => r.json())
      .then(setTable)
      .catch(() => setTable(null));
    fetch("/api/payroll/rates", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRates(d.rates ?? []))
      .catch(() => setRates([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (employeeId: string, p: Partial<ProfileRow>) =>
    setProfiles((prev) => prev.map((x) => (x.employeeId === employeeId ? { ...x, ...p, dirty: true } : x)));

  const saveDirty = async () => {
    const dirty = profiles.filter((p) => p.dirty);
    if (!dirty.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const p of dirty) {
        const res = await fetch("/api/payroll/tax-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: p.employeeId,
            withholdingRate: p.withholdingRate,
            dependents: p.dependents,
            childDeduction: p.childDeduction,
            specialRelation: p.specialRelation,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? `${p.employeeName} 저장 실패`);
      }
      setMsg(`${dirty.length}명 저장 완료`);
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadForms = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const res = await fetch("/api/payroll/tax-profiles", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드 실패");
      const results = (data.results ?? []) as Array<{ file: string; employeeName?: string; matched?: boolean; dependents?: number; ratePct?: number; error?: string }>;
      const ok = results.filter((r) => !r.error && r.matched);
      const fail = results.filter((r) => r.error || !r.matched);
      setMsg(
        `공제신고서 ${ok.length}건 반영` +
          (fail.length ? ` · 실패/미매칭 ${fail.length}건: ${fail.map((f) => f.employeeName ?? f.file).join(", ")}` : "")
      );
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const updateTable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/payroll/tax-table", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업데이트 실패");
      setMsg(data.updated ? `간이세액표 ${data.yearVersion}년 개정본 ${Number(data.rows).toLocaleString()}행 시딩 완료` : String(data.message ?? "변경 없음"));
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRate = async () => {
    if (!rateDraft.validFrom || !rateDraft.rate) {
      setMsg("적용 시작(YYYY-MM)과 요율(%)을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/payroll/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: rateDraft.kind, validFrom: rateDraft.validFrom, rate: Number(rateDraft.rate) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      setRateDraft((p) => ({ ...p, validFrom: "", rate: "" }));
      setMsg("요율이 저장되었습니다.");
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const currentRate = (kind: string): RateRow | undefined => rates.find((r) => r.kind === kind);

  const dirtyCount = profiles.filter((p) => p.dirty).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 pb-4">
      <div className="flex items-center gap-3 flex-wrap">
        {/* 간이세액표 버전 카드 */}
        <div className="border cd-border-c rounded-2xl px-4 py-2.5 text-xs cd-text-faint flex items-center gap-3">
          <div>
            <p className="font-bold cd-text">근로소득 간이세액표</p>
            <p>
              현재 {table?.local.yearVersion ?? "-"}년 개정본 · {Number(table?.local.rows ?? 0).toLocaleString()}행
              {table?.remote?.stdrDe && ` · 국세청 기준일 ${table.remote.stdrDe}`}
            </p>
          </div>
          {table?.updateAvailable ? (
            <button type="button" disabled={busy} className="cd-fill-primary text-white rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40" onClick={updateTable}>
              개정본 적용
            </button>
          ) : (
            <button type="button" disabled={busy} className="cd-btn rounded-xl px-3 py-1.5 text-xs font-semibold flex items-center gap-1" onClick={updateTable} title="공공데이터포털에서 개정 여부 확인 후 필요 시 갱신">
              <RefreshCw className="w-3.5 h-3.5" /> 개정 확인
            </button>
          )}
        </div>
        {/* 보험요율 카드 — 고용·장기요양(자체 산정 2종). 건보·국민연금은 EDI 고지액 전기라 요율 무관 */}
        <div className="border cd-border-c rounded-2xl px-4 py-2.5 text-xs cd-text-faint flex items-center gap-3 flex-wrap">
          <div>
            <p className="font-bold cd-text">보험요율 (고용·장기요양)</p>
            <p title="목록 순 최신 적용분. 장기요양은 EDI 업로드 시 자동 역산 갱신됩니다.">
              {(["ei", "ltc"] as const).map((k) => {
                const r = currentRate(k);
                return (
                  <span key={k} className="mr-2">
                    {k === "ei" ? "고용" : "요양"} {r ? `${r.rate}% (${r.validFrom}~, ${RATE_SOURCE_LABELS[r.source] ?? r.source})` : "-"}
                  </span>
                );
              })}
            </p>
          </div>
          <div className="flex items-end gap-1.5">
            <select className="cd-select text-xs" style={{ width: 190 }} value={rateDraft.kind} onChange={(e) => setRateDraft((p) => ({ ...p, kind: e.target.value }))}>
              {Object.entries(RATE_KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <input className="cd-input text-xs" style={{ width: 104 }} placeholder="2027-01" value={rateDraft.validFrom} onChange={(e) => setRateDraft((p) => ({ ...p, validFrom: e.target.value }))} />
            <input className="cd-input text-xs text-right" style={{ width: 80 }} placeholder="%" inputMode="decimal" value={rateDraft.rate} onChange={(e) => setRateDraft((p) => ({ ...p, rate: e.target.value.replace(/[^\d.]/g, "") }))} />
            <button type="button" disabled={busy} className="cd-btn rounded-xl px-2.5 py-1.5 text-xs font-semibold" onClick={saveRate}>
              요율 등록
            </button>
          </div>
        </div>
        {msg && <span className="text-xs cd-text-faint">{msg}</span>}
        <div className="ml-auto flex items-center gap-2">
          <label className="cd-btn rounded-xl px-3.5 py-2 text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
            <FileUp className="w-4 h-4" /> 공제신고서 업로드
            <input ref={fileRef} type="file" accept=".xlsx" multiple className="hidden" onChange={(e) => uploadForms(e.target.files)} />
          </label>
          <button
            type="button"
            disabled={busy || !dirtyCount}
            className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40"
            onClick={saveDirty}
          >
            <Save className="w-4 h-4" /> 저장{dirtyCount ? ` (${dirtyCount})` : ""}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl px-2 pb-2">
        {/* 인원이 많아 반폭 2열로 흘린다(항목 사전과 동일 관례 — 스크롤 최소화) */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 items-start">
          {[profiles.slice(0, Math.ceil(profiles.length / 2)), profiles.slice(Math.ceil(profiles.length / 2))]
            .filter((half) => half.length)
            .map((half, hi) => (
              <table key={hi} className="w-full text-sm">
                <thead>
                  <tr className="cd-text-faint text-[11px] border-b cd-border-c sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
                    <th className="text-left font-semibold p-2" style={{ width: "15%" }}>직원</th>
                    <th className="text-left font-semibold p-2" style={{ width: "20%" }}>원천징수 비율</th>
                    <th className="text-right font-semibold p-2" style={{ width: "17%" }} title="본인 포함 기본공제 대상 인원 — 간이세액표 축">가족수</th>
                    <th className="text-right font-semibold p-2" style={{ width: "19%" }} title="간이세액표 세액에서 자녀수별 정액 차감(1명 12,500 / 2명 29,160 / 3명+ 추가 25,000)">8~20세 자녀</th>
                    <th className="text-center font-semibold p-2" style={{ width: "14%" }} title="대표 친족 등 — 고용·산재 가입 제외 관행이라 고용보험 공제를 산출하지 않음">특수관계인</th>
                    <th className="text-left font-semibold p-2" style={{ width: "15%" }}>출처</th>
                  </tr>
                </thead>
                <tbody>
                  {half.map((p) => (
                    <tr key={p.employeeId} className="border-b cd-border-c last:border-0">
                      <td className="p-2 cd-text font-semibold whitespace-nowrap">{p.employeeName}</td>
                      <td className="p-1.5">
                        <select className="cd-select text-sm" style={{ width: 90 }} value={p.withholdingRate} onChange={(e) => patch(p.employeeId, { withholdingRate: Number(e.target.value) })}>
                          {[80, 100, 120].map((r) => (
                            <option key={r} value={r}>{r}%</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1.5 text-right">
                        <input type="number" min={1} max={11} className="cd-input text-sm text-right" style={{ width: 70 }} value={p.dependents} onChange={(e) => patch(p.employeeId, { dependents: Number(e.target.value) })} />
                      </td>
                      <td className="p-1.5 text-right">
                        <input type="number" min={0} max={9} className="cd-input text-sm text-right" style={{ width: 70 }} value={p.childDeduction} onChange={(e) => patch(p.employeeId, { childDeduction: Number(e.target.value) })} />
                      </td>
                      <td className="p-1.5 text-center">
                        <input type="checkbox" checked={p.specialRelation} onChange={(e) => patch(p.employeeId, { specialRelation: e.target.checked })} />
                      </td>
                      <td className="p-2 cd-text-faint text-xs whitespace-nowrap">
                        {p.source === "tax-form-import" ? "공제신고서" : p.source === "manual" ? "수기" : "기본값"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
        </div>
        {!profiles.length && <p className="p-6 text-center text-sm cd-text-faint">재직자 목록을 불러오는 중…</p>}
      </div>
    </div>
  );
}
