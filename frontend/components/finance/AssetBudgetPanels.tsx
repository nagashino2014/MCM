"use client";

// 자산·예산 패널 3종 (accounting-expansion 블루프린트 §5 P6)
// - FixedAssetPanel: 고정자산 대장 + 정액/정률 월할 상각 스케줄 — 전표(감가상각 818/누계액)는 재생성이 자동 기표.
// - TripLogPanel: 운행기록부 — 승인 출장신청서에서 초안 파생 + 거리 수기 보완 + xlsx.
// - BudgetPanel: 계정과목별 연간 예산 + 전표 기준 집행 현황 — 지출결의 기안 시 사전검토 경고와 연동.
// FinanceBoard 의 소메뉴 "자산·예산" 그룹에서 렌더된다(JournalPanels 스타일 관례 동일).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, RefreshCw, Trash2, XCircle } from "lucide-react";

const won = (n: number) => n.toLocaleString("ko-KR");
const thisYear = () => new Date().getFullYear();

const post = async (url: string, body: Record<string, unknown>) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

/** YYYYMMDD 숫자 입력 → YYYY-MM-DD (JournalPanels DigitDateInput 관례). */
function DigitDate({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      className="cd-input"
      style={{ width: 118 }}
      inputMode="numeric"
      placeholder={placeholder ?? "YYYYMMDD"}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
    />
  );
}
const toDash = (digits: string) => `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;

// ─────────────────────────────────────────────
// 고정자산 대장
// ─────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = { building: "건물", machine: "기계장치", vehicle: "차량운반구", fixture: "비품" };

interface FixedAssetRow {
  faId: string;
  name: string;
  category: string;
  acquisitionDate: string;
  acquisitionCost: number;
  method: string;
  usefulLifeYears: number;
  openingAccum: number;
  openingAsOf: string | null;
  disposedAt: string | null;
  memo: string | null;
  isActive: boolean;
  totalAccum: number;
  bookValue: number;
  schedule?: Array<{ month: string; amount: number; accumAfter: number; bookValueAfter: number }>;
}

export function FixedAssetPanel() {
  const [assets, setAssets] = useState<FixedAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "fixture",
    acquisitionDate: "",
    acquisitionCost: "",
    method: "straight",
    usefulLifeYears: "5",
    openingAccum: "",
    openingAsOf: "",
  });

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/finance/fixed-assets?schedule=1", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(String(data.error));
        else setAssets(Array.isArray(data.assets) ? data.assets : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await post("/api/finance/fixed-assets", body);
      setNotice(ok);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void act(
      {
        action: "save",
        asset: {
          name: form.name,
          category: form.category,
          acquisitionDate: toDash(form.acquisitionDate),
          acquisitionCost: Number(form.acquisitionCost),
          method: form.method,
          usefulLifeYears: Number(form.usefulLifeYears),
          openingAccum: form.openingAccum ? Number(form.openingAccum) : 0,
          openingAsOf: form.openingAsOf.length === 8 ? toDash(form.openingAsOf) : null,
        },
      },
      "자산을 등록했습니다 — 전표·장부에서 재생성하면 월할 상각이 기표됩니다.",
    ).then(() => setForm({ name: "", category: "fixture", acquisitionDate: "", acquisitionCost: "", method: "straight", usefulLifeYears: "5", openingAccum: "", openingAsOf: "" }));

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">고정자산 대장 — 월할 상각</div>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={loading} onClick={load}>
          <RefreshCw className="w-3.5 h-3.5" /> 새로고침
        </button>
      </div>
      <div className="text-xs cd-text-muted mb-3">
        등록하면 매월 말 감가상각 전표(818/누계액)가 자동 기표됩니다(전표·장부 재생성 시). 기존 자산은 세무법인 감가상각명세서의
        누계액을 "기초 누계"로 넣고 기준일 다음 달부터 앱이 이어서 상각합니다. 건물은 정액법만 허용됩니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">자산</th>
              <th className="py-1.5 pr-3 font-normal">구분</th>
              <th className="py-1.5 pr-3 font-normal">취득일</th>
              <th className="py-1.5 pr-3 font-normal text-right">취득가액</th>
              <th className="py-1.5 pr-3 font-normal">방법</th>
              <th className="py-1.5 pr-3 font-normal text-right">상각누계</th>
              <th className="py-1.5 pr-3 font-normal text-right">장부가</th>
              <th className="py-1.5 font-normal">처리</th>
            </tr>
          </thead>
          <tbody>
            {assets.filter((a) => a.isActive).map((a) => (
              <>
                <tr key={a.faId} className={`border-t cd-hairline-row-c ${a.disposedAt ? "opacity-50" : ""}`}>
                  <td className="py-2 pr-3">
                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => setOpenId(openId === a.faId ? null : a.faId)}>
                      {a.name}
                    </button>
                    {a.disposedAt && <span className="cd-pill cd-pill-idle ml-1">처분 {a.disposedAt}</span>}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{CATEGORY_LABEL[a.category] ?? a.category}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{a.acquisitionDate}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{won(a.acquisitionCost)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {a.method === "declining" ? "정률" : "정액"} {a.usefulLifeYears}년
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{won(a.totalAccum)}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">{won(a.bookValue)}</td>
                  <td className="py-2 whitespace-nowrap">
                    {!a.disposedAt && (
                      <button
                        type="button"
                        className="cd-btn cd-btn-ghost cd-btn-sm"
                        disabled={busy}
                        title="처분(매각·폐기) — 처분월부터 상각 중단. 처분 손익 분개는 확정 큐에서 수동 처리"
                        onClick={() => {
                          const d = prompt("처분일 (YYYY-MM-DD)");
                          if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) void act({ action: "dispose", faId: a.faId, disposedAt: d }, "처분 처리했습니다.");
                        }}
                      >
                        <XCircle className="w-3.5 h-3.5" /> 처분
                      </button>
                    )}
                    <button
                      type="button"
                      className="cd-btn cd-btn-ghost cd-btn-sm"
                      disabled={busy}
                      title="대장에서 제외(전표 기표 중단)"
                      onClick={() => void act({ action: "deactivate", faId: a.faId }, "대장에서 제외했습니다.")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {openId === a.faId && a.schedule && (
                  <tr key={`${a.faId}-schedule`} className="border-t cd-hairline-row-c">
                    <td colSpan={8} className="py-2 pl-4">
                      <div className="text-xs cd-text-muted mb-1">앱 기표 상각 스케줄 (올해 말까지)</div>
                      <div className="flex gap-2 flex-wrap text-xs">
                        {a.schedule.slice(-12).map((s) => (
                          <span key={s.month} className="cd-chip cd-chip-sm">
                            {s.month} · {won(s.amount)} (장부가 {won(s.bookValueAfter)})
                          </span>
                        ))}
                        {!a.schedule.length && <span className="text-xs cd-text-muted">기표 대상 월이 없습니다.</span>}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!loading && assets.filter((a) => a.isActive).length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center cd-text-muted text-sm">
                  등록된 고정자산이 없습니다 — 세무법인 감가상각명세서 기준으로 아래에서 등록하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input className="cd-input" style={{ width: 180 }} placeholder="자산명" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
        <select className="cd-select" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value, method: e.target.value === "building" ? "straight" : p.method }))}>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <DigitDate value={form.acquisitionDate} onChange={(v) => setForm((p) => ({ ...p, acquisitionDate: v }))} placeholder="취득일" />
        <input className="cd-input text-right" style={{ width: 140 }} inputMode="numeric" placeholder="취득가액(원)" value={form.acquisitionCost ? won(Number(form.acquisitionCost)) : ""} onChange={(e) => setForm((p) => ({ ...p, acquisitionCost: e.target.value.replace(/[^0-9]/g, "") }))} />
        <select className="cd-select" value={form.method} disabled={form.category === "building"} onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}>
          <option value="straight">정액법</option>
          <option value="declining">정률법</option>
        </select>
        <input className="cd-input text-right" style={{ width: 70 }} inputMode="numeric" title="내용연수(년)" value={form.usefulLifeYears} onChange={(e) => setForm((p) => ({ ...p, usefulLifeYears: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) }))} />
        <span className="text-xs cd-text-muted">년</span>
        <input className="cd-input text-right" style={{ width: 140 }} inputMode="numeric" placeholder="기초 누계(기존 자산)" title="세무법인 명세서상 기왕 상각누계액" value={form.openingAccum ? won(Number(form.openingAccum)) : ""} onChange={(e) => setForm((p) => ({ ...p, openingAccum: e.target.value.replace(/[^0-9]/g, "") }))} />
        <DigitDate value={form.openingAsOf} onChange={(v) => setForm((p) => ({ ...p, openingAsOf: v }))} placeholder="기초 기준일" />
        <button
          type="button"
          className="cd-btn cd-btn-primary cd-btn-sm"
          disabled={busy || !form.name.trim() || form.acquisitionDate.length !== 8 || !form.acquisitionCost || !Number(form.usefulLifeYears)}
          onClick={save}
        >
          <Check className="w-3.5 h-3.5" /> 등록
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 운행기록부
// ─────────────────────────────────────────────

interface TripLogRow {
  logId: string;
  assetId: string;
  assetName: string;
  driveDate: string;
  driverName: string | null;
  useKind: string;
  purpose: string | null;
  distanceKm: number | null;
  docId: string | null;
  source: string;
}

interface TripSummaryRow {
  assetId: string;
  assetName: string;
  totalDays: number;
  businessDays: number;
  totalKm: number;
  businessKm: number;
  businessRatio: number | null;
}

export function TripLogPanel() {
  const [year, setYear] = useState(thisYear());
  const [assetId, setAssetId] = useState<string>("");
  const [logs, setLogs] = useState<TripLogRow[]>([]);
  const [summary, setSummary] = useState<TripSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [distanceDraft, setDistanceDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ year: String(year) });
    if (assetId) params.set("assetId", assetId);
    fetch(`/api/finance/trip-logs?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(String(data.error));
        else {
          setLogs(Array.isArray(data.logs) ? data.logs : []);
          setSummary(Array.isArray(data.summary) ? data.summary : []);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [year, assetId]);
  useEffect(load, [load]);

  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await post("/api/finance/trip-logs", body);
      setNotice(ok);
      load();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const assetOptions = useMemo(() => summary.map((s) => ({ id: s.assetId, name: s.assetName })), [summary]);

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">운행기록부 — 업무용승용차</div>
        <select className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear() - 1, thisYear()].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select className="cd-select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
          <option value="">전체 차량</option>
          {assetOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button
          type="button"
          className="cd-btn cd-btn-primary cd-btn-sm"
          disabled={busy}
          title="승인된 출장신청서(법인차량)에서 운행 초안을 다시 만듭니다"
          onClick={() => void act({ action: "sync", year }, "출장 문서에서 초안을 동기화했습니다 — 주행거리를 채워 주세요.")}
        >
          <RefreshCw className="w-3.5 h-3.5" /> 출장 문서 동기화
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => window.open(`/api/finance/trip-logs?year=${year}${assetId ? `&assetId=${assetId}` : ""}&format=xlsx`, "_blank")}>
          <Download className="w-3.5 h-3.5" /> 운행기록부 엑셀
        </button>
      </div>
      <div className="flex gap-2 flex-wrap mb-2 text-xs">
        {summary.map((s) => (
          <span key={s.assetId} className="cd-chip cd-chip-sm">
            {s.assetName}: {s.totalDays}일{s.totalKm > 0 ? ` · ${won(s.totalKm)}km` : ""}
            {s.businessRatio != null ? ` · 업무 ${(s.businessRatio * 100).toFixed(0)}%` : ""}
          </span>
        ))}
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">일자</th>
              <th className="py-1.5 pr-3 font-normal">차량</th>
              <th className="py-1.5 pr-3 font-normal">운전자</th>
              <th className="py-1.5 pr-3 font-normal">용무</th>
              <th className="py-1.5 pr-3 font-normal">근거</th>
              <th className="py-1.5 pr-3 font-normal text-right">주행거리(km)</th>
              <th className="py-1.5 font-normal">처리</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.logId} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{l.driveDate}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{l.assetName}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{l.driverName ?? "-"}</td>
                <td className="py-1.5 pr-3 max-w-[220px]"><div className="truncate" title={l.purpose ?? ""}>{l.purpose ?? "-"}</div></td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{l.docId ? "출장신청서" : "수기"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                  <input
                    className="cd-input text-right"
                    style={{ width: 90 }}
                    inputMode="numeric"
                    value={distanceDraft[l.logId] ?? (l.distanceKm != null ? String(l.distanceKm) : "")}
                    placeholder="—"
                    onChange={(e) => setDistanceDraft((p) => ({ ...p, [l.logId]: e.target.value.replace(/[^0-9.]/g, "") }))}
                    onBlur={() => {
                      const raw = distanceDraft[l.logId];
                      if (raw === undefined) return;
                      const val = raw === "" ? null : Number(raw);
                      if (val === (l.distanceKm ?? null)) return;
                      void act({ action: "update_distance", logId: l.logId, distanceKm: val }, "주행거리를 저장했습니다.");
                    }}
                  />
                </td>
                <td className="py-1.5 whitespace-nowrap">
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void act({ action: "delete", logId: l.logId }, "삭제했습니다.")}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">
                  운행기록이 없습니다 — "출장 문서 동기화"로 승인된 출장신청서에서 초안을 만드세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 예산
// ─────────────────────────────────────────────

interface BudgetRow {
  budgetId: string;
  categoryKey: string;
  categoryLabel: string;
  amount: number;
  spent: number;
  remaining: number;
}

export function BudgetPanel() {
  const [year, setYear] = useState(thisYear());
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [categories, setCategories] = useState<Array<{ key: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ categoryKey: "", amount: "" });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/finance/budget?year=${year}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(String(data.error));
        else {
          setBudgets(Array.isArray(data.budgets) ? data.budgets : []);
          setCategories(Array.isArray(data.categories) ? data.categories : []);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [year]);
  useEffect(load, [load]);

  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await post("/api/finance/budget", body);
      setNotice(ok);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unbudgeted = categories.filter((c) => !budgets.some((b) => b.categoryKey === c.key));

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">연간 예산 — 계정과목별</div>
        <select className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear() - 1, thisYear(), thisYear() + 1].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>
      <div className="text-xs cd-text-muted mb-3">
        예산을 등록한 계정과목은 지출결의·출장경비 기안 시 잔액이 표시되고 초과하면 경고합니다(사전검토). 집행액은 전표(자동+확정)
        기준이라 법인카드·계좌 지출이 모두 반영됩니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-sm max-w-[760px]">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">계정과목</th>
              <th className="py-1.5 pr-3 font-normal text-right">예산</th>
              <th className="py-1.5 pr-3 font-normal text-right">집행</th>
              <th className="py-1.5 pr-3 font-normal text-right">잔액</th>
              <th className="py-1.5 pr-3 font-normal" style={{ width: 180 }}>집행률</th>
              <th className="py-1.5 font-normal">처리</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => {
              const ratio = b.amount > 0 ? Math.min(1, b.spent / b.amount) : 0;
              const over = b.remaining < 0;
              return (
                <tr key={b.budgetId} className="border-t cd-hairline-row-c">
                  <td className="py-2 pr-3">{b.categoryLabel}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{won(b.amount)}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">{won(b.spent)}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap font-medium" style={over ? { color: "var(--cd-danger,#FA896B)" } : undefined}>
                    {won(b.remaining)}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="h-2 rounded-full overflow-hidden border cd-border-c">
                      <div
                        className="h-full"
                        style={{ width: `${Math.round(ratio * 100)}%`, background: over ? "var(--cd-danger,#FA896B)" : "var(--cd-primary,#5D87FF)" }}
                      />
                    </div>
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void act({ action: "delete", budgetId: b.budgetId }, "예산을 삭제했습니다.")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && budgets.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center cd-text-muted text-sm">등록된 예산이 없습니다 — 통제할 계정과목만 아래에서 등록하세요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select className="cd-select" value={form.categoryKey} onChange={(e) => setForm((p) => ({ ...p, categoryKey: e.target.value }))}>
          <option value="">계정과목 선택…</option>
          {unbudgeted.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <input
          className="cd-input text-right"
          style={{ width: 150 }}
          inputMode="numeric"
          placeholder="연간 예산(원)"
          value={form.amount ? won(Number(form.amount)) : ""}
          onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value.replace(/[^0-9]/g, "") }))}
        />
        <button
          type="button"
          className="cd-btn cd-btn-primary cd-btn-sm"
          disabled={busy || !form.categoryKey || !form.amount}
          onClick={() =>
            void act({ action: "save", year, categoryKey: form.categoryKey, amount: Number(form.amount) }, "예산을 등록했습니다.").then(() =>
              setForm({ categoryKey: "", amount: "" }),
            )
          }
        >
          <Check className="w-3.5 h-3.5" /> 등록
        </button>
      </div>
    </div>
  );
}
