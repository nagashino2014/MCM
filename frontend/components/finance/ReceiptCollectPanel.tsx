"use client";

/* ================= 쇼핑몰 전표 수집 =================
 *
 * 11번가·G마켓·옥션·네이버페이·쿠팡의 신용카드 매출전표를 PDF 로 모아 온다.
 * 실제 수집은 `scraper/` 의 CLI 가 하고, 이 화면은 그것을 실행하고 진행 상황을 보여준다.
 *
 * 로그인 세션과 브라우저가 이 PC 에 있어야 하므로 **로컬에서 띄운 앱에서만** 동작한다
 * (배포 서버에는 세션도 브라우저도 없다). 실행은 바탕화면의 '전표 수집' 바로가기로 한다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LogIn, Loader2, RefreshCw, FolderOpen, AlertTriangle } from "lucide-react";

interface ShopStatus {
  key: string;
  name: string;
  mode: "collect" | "bulk";
  hint?: string;
  loggedIn: boolean;
  sessionAt: string | null;
  collected: number;
  lastCollectedAt: string | null;
}

/** 분기 프리셋 — 부가세 신고 단위로 고르는 일이 대부분이다 */
function quarterRange(year: number, q: number): { from: string; to: string } {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${p(startMonth)}-01`, to: `${year}-${p(endMonth)}-${p(lastDay)}` };
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("ko-KR");
}

export function ReceiptCollectPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [range, setRange] = useState(() => quarterRange(now.getFullYear(), Math.floor(now.getMonth() / 3) + 1));

  const [shops, setShops] = useState<ShopStatus[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [requestId, setRequestId] = useState("");
  const [receiptsDir, setReceiptsDir] = useState("");

  const [loading, setLoading] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const logRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/receipts/shop/status", { cache: "no-store" });
      const data = await res.json();

      if (res.status === 403 && data?.localOnly) {
        setLocalOnly(true);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "상태를 불러오지 못했습니다.");

      setShops(data.shops ?? []);
      setReceiptsDir(data.receiptsDir ?? "");
      // 로그인된 곳을 기본 선택
      setSelected(new Set((data.shops ?? []).filter((s: ShopStatus) => s.loggedIn).map((s: ShopStatus) => s.key)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const applyQuarter = (y: number, q: number) => {
    setYear(y);
    setQuarter(q);
    setRange(quarterRange(y, q));
  };

  const appendLog = (line: string) => setLog((prev) => [...prev.slice(-500), line]);

  /** CLI 한 번 실행 — 로그를 흘려받아 화면에 붙인다 */
  const runCommand = async (body: Record<string, unknown>, label: string): Promise<boolean> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(label);
    appendLog(`▶ ${label}`);

    try {
      const res = await fetch("/api/receipts/shop/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        appendLog(`✖ ${data?.error ?? "실행에 실패했습니다."}`);
        return false;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let code: number | null = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          const dataLine = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!event || !dataLine) continue;

          const payload = JSON.parse(dataLine);
          if (event === "log") appendLog(payload.line);
          if (event === "done") code = payload.code;
        }
      }

      if (code !== 0) appendLog(`✖ ${label} — 종료 코드 ${code}`);
      return code === 0;
    } catch (err) {
      if ((err as Error).name !== "AbortError") appendLog(`✖ ${(err as Error).message}`);
      return false;
    } finally {
      setRunning(null);
      abortRef.current = null;
    }
  };

  const login = async (shop: ShopStatus) => {
    appendLog(`— ${shop.name}: 브라우저가 열립니다. 로그인 후 목록 화면까지 이동한 뒤 창을 닫으세요.`);
    await runCommand({ command: "login", site: shop.key }, `${shop.name} 로그인`);
    await loadStatus();
  };

  /** 선택한 몰을 차례로 수집한다(같은 브라우저 프로필을 동시에 쓰면 안 되므로 순차 실행) */
  const collectSelected = async () => {
    const targets = shops.filter((s) => selected.has(s.key));
    if (targets.length === 0) {
      appendLog("✖ 수집할 쇼핑몰을 선택하세요.");
      return;
    }

    setLog([]);
    for (const shop of targets) {
      if (!shop.loggedIn) {
        appendLog(`— ${shop.name}: 로그인이 필요합니다. 건너뜁니다.`);
        continue;
      }

      if (shop.mode === "bulk") {
        if (!requestId.trim()) {
          appendLog(`— ${shop.name}: 신청 ID 가 없어 건너뜁니다(쿠팡 화면에서 일괄 신청 후 ID 를 입력하세요).`);
          continue;
        }
        await runCommand({ command: "bulk", site: shop.key, requestId: requestId.trim() }, `${shop.name} 묶음 전표`);
        continue;
      }

      await runCommand(
        { command: "collect", site: shop.key, from: range.from, to: range.to },
        `${shop.name} ${range.from} ~ ${range.to}`
      );
    }

    appendLog("● 수집이 끝났습니다.");
    await loadStatus();
  };

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  if (localOnly) {
    return (
      <div className="cd-card p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: "var(--cd-warning)" }} />
          <div className="space-y-2">
            <div className="cd-card-title">이 기능은 내 PC 에서 실행한 앱에서만 쓸 수 있습니다</div>
            <p className="text-sm cd-text-muted leading-relaxed">
              쇼핑몰 로그인 상태와 브라우저가 각자 PC 에 있어야 전표를 받을 수 있습니다.
              서버에 올라간 앱에는 그 둘이 없어 수집을 실행할 수 없습니다.
            </p>
            <p className="text-sm cd-text-muted leading-relaxed">
              바탕화면의 <b>전표 수집</b> 바로가기로 앱을 띄운 뒤 이 화면을 열어 주세요.
              바로가기가 없으면 <code className="cd-text">scripts/install-receipts-shortcut.ps1</code> 을 한 번 실행하면 만들어집니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 기간 + 실행 */}
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="cd-card-title mr-auto">쇼핑몰 전표 수집</div>

          <select className="cd-select" value={year} onChange={(e) => applyQuarter(Number(e.target.value), quarter)}>
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>

          {[1, 2, 3, 4].map((q) => (
            <button
              key={q}
              type="button"
              className={`cd-chip ${quarter === q ? "" : "cd-text-muted"}`}
              data-active={quarter === q || undefined}
              onClick={() => applyQuarter(year, q)}
            >
              {q}분기
            </button>
          ))}

          <input
            type="date"
            className="cd-input"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
          <span className="cd-text-faint">~</span>
          <input
            type="date"
            className="cd-input"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />

          <button type="button" className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => void loadStatus()}>
            <RefreshCw size={14} /> 새로고침
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-sm cd-btn-primary"
            onClick={() => void collectSelected()}
            disabled={Boolean(running) || loading}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {running ? "수집 중…" : "선택한 몰 수집"}
          </button>
        </div>

        <p className="text-xs cd-text-muted">
          선택한 쇼핑몰을 차례로 돌며 신용카드 매출전표를 PDF 로 받아 <code className="cd-text">{receiptsDir || "data/receipts"}</code> 아래에 쌓습니다.
          이미 받은 건은 건너뜁니다.
        </p>
      </div>

      {/* 사이트 목록 */}
      <div className="cd-card p-4">
        {error && <div className="cd-error-text text-sm mb-3">{error}</div>}
        {loading && <div className="text-sm cd-text-muted">불러오는 중…</div>}

        {!loading && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shops.map((shop) => {
              const checked = selected.has(shop.key);
              return (
                <div key={shop.key} className="border cd-border-c rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(shop.key);
                          else next.delete(shop.key);
                          return next;
                        });
                      }}
                    />
                    <span className="cd-text font-semibold mr-auto">{shop.name}</span>
                    <span className={shop.loggedIn ? "cd-pill cd-pill-success" : "cd-pill cd-pill-warn"}>
                      {shop.loggedIn ? "로그인됨" : "로그인 필요"}
                    </span>
                  </div>

                  <div className="text-xs cd-text-muted space-y-0.5">
                    <div>수집 {shop.collected.toLocaleString()}건 · 최근 {formatDate(shop.lastCollectedAt)}</div>
                    <div>세션 확인 {formatDate(shop.sessionAt)}</div>
                    {shop.hint && <div className="cd-text-faint">{shop.hint}</div>}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="cd-btn cd-btn-sm cd-btn-soft"
                      onClick={() => void login(shop)}
                      disabled={Boolean(running)}
                    >
                      <LogIn size={14} /> {shop.loggedIn ? "다시 로그인" : "로그인"}
                    </button>
                    {shop.mode === "bulk" && (
                      <input
                        className="cd-input flex-1"
                        placeholder="쿠팡 신청 ID"
                        value={requestId}
                        onChange={(e) => setRequestId(e.target.value)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 진행 로그 */}
      {log.length > 0 && (
        <div className="cd-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="cd-card-title mr-auto">진행 상황</div>
            {receiptsDir && (
              <span className="text-xs cd-text-faint inline-flex items-center gap-1">
                <FolderOpen size={13} /> {receiptsDir}
              </span>
            )}
            <button type="button" className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => setLog([])}>
              지우기
            </button>
          </div>

          <div
            ref={logRef}
            className="text-xs leading-relaxed max-h-80 overflow-auto rounded-lg p-3"
            style={{ background: "var(--cd-surface)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {log.map((line, i) => (
              <div key={i} className="cd-text whitespace-pre-wrap break-all">{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
