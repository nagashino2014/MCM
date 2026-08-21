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

import { CdDateInput, isValidDateString } from "@/components/cdash";

interface ShopStatus {
  key: string;
  name: string;
  mode: "collect" | "bulk";
  hint?: string;
  loggedIn: boolean;
  sessionAt: string | null;
  /** 실제 접근으로 확인한 세션 상태 — true 유효 / false 만료 / null 미확인 */
  sessionOk: boolean | null;
  sessionCheckedAt: string | null;
  sessionReason: string | null;
  collected: number;
  lastCollectedAt: string | null;
  inboxCount: number;
  inboxPath: string;
}

/** 분기 프리셋 — 부가세 신고 단위로 고르는 일이 대부분이다 */
function quarterRange(year: number, q: number): { from: string; to: string } {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${p(startMonth)}-01`, to: `${year}-${p(endMonth)}-${p(lastDay)}` };
}

/** 쿠팡 매출전표 일괄 신청을 하는 화면 */
const COUPANG_REQUEST_URL = "https://mc.coupang.com/ssr/desktop/payment-receipt";

/**
 * 쿠팡 신청 ID 는 신청 결과 주소에 들어 있다.
 *   https://payment.coupang.com/card-receipt-requests/5320399?page=0  →  5320399
 * 주소를 통째로 붙여넣어도 되도록 숫자만 뽑아낸다.
 */
function extractRequestId(input: string): string {
  const text = input.trim();
  const fromUrl = /card-receipt-requests\/(\d+)/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(text) ? text : "";
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("ko-KR");
}

/** 세션은 하루 남짓이면 풀린다 — 확인 시각은 분 단위까지 보여 준다 */
function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString("ko-KR")} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** 화면에 보여 줄 세션 상태 — 쿠키 존재가 아니라 실제 접근 결과를 기준으로 한다 */
function sessionBadge(shop: ShopStatus): { label: string; className: string } {
  if (!shop.loggedIn) return { label: "로그인 필요", className: "cd-pill cd-pill-warn" };
  if (shop.sessionOk === true) return { label: "세션 유효", className: "cd-pill cd-pill-success" };
  if (shop.sessionOk === false) return { label: "세션 만료", className: "cd-pill cd-pill-warn" };
  return { label: "확인 필요", className: "cd-pill" };
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

  const [origin, setOrigin] = useState("");

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

  // localOnly 안내에서 "지금 보고 있는 주소" 를 알려 주려고 쓴다(원인 구분용).
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

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

  /** 실제로 접근해 세션이 살아 있는지 본다(결과는 수집기가 파일로 남기고 상태에 반영된다) */
  const checkSession = async (shop: ShopStatus) => {
    appendLog(`— ${shop.name}: 세션을 확인합니다. 창이 잠깐 열릴 수 있습니다.`);
    await runCommand({ command: "check", site: shop.key }, `${shop.name} 세션 확인`);
    await loadStatus();
  };

  /** 손으로 받아 inbox 에 넣어 둔 전표 PDF 를 대장에 올린다(쿠팡처럼 자동 수집이 막힌 몰) */
  const importInbox = async (shop: ShopStatus) => {
    appendLog(`— ${shop.name}: ${shop.inboxPath} 의 PDF 를 읽습니다.`);
    await runCommand({ command: "import", site: shop.key }, `${shop.name} PDF 가져오기`);
    await loadStatus();
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

    if (!isValidDateString(range.from) || !isValidDateString(range.to)) {
      appendLog("✖ 기간을 YYYYMMDD 8자리로 채워 주세요.");
      return;
    }

    setLog([]);
    for (const shop of targets) {
      if (!shop.loggedIn) {
        appendLog(`— ${shop.name}: 로그인이 필요합니다. 건너뜁니다.`);
        continue;
      }

      if (shop.sessionOk === false) {
        appendLog(`— ${shop.name}: 지난번에 세션이 만료돼 있었습니다. 실패하면 [다시 로그인] 후 재시도하세요.`);
      }

      if (shop.mode === "bulk") {
        if (!requestId.trim()) {
          appendLog(`— ${shop.name}: 신청 ID 가 없어 건너뜁니다(쿠팡 화면에서 일괄 신청 후 ID 를 입력하세요).`);
          continue;
        }
        const id = extractRequestId(requestId);
        if (!id) {
          appendLog(`— ${shop.name}: 신청 ID 를 찾지 못했습니다. 신청 결과 주소(.../card-receipt-requests/5320399?page=0)나 그 숫자를 넣어 주세요.`);
          continue;
        }
        await runCommand({ command: "bulk", site: shop.key, requestId: id }, `${shop.name} 묶음 전표`);
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

  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

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
            {isLocalOrigin ? (
              <>
                <p className="text-sm cd-text-muted leading-relaxed">
                  주소({origin})는 로컬이 맞는데도 이 메시지가 보인다면, <b>지금 붙어 있는 dev 서버가 바로가기로 띄운 것이 아닙니다.</b>
                  다른 창에서 <code className="cd-text">npm run dev</code> 가 이미 떠 있으면 바로가기로 띄운 앱은 다른 포트(3001 등)로 밀리고,
                  브라우저는 먼저 떠 있던 쪽에 붙습니다.
                </p>
                <p className="text-sm cd-text-muted leading-relaxed">
                  기존 dev 서버 창을 모두 닫고 바탕화면의 <b>전표 수집</b> 바로가기로 다시 띄워 주세요.
                  바로가기 창에 찍힌 포트 번호도 확인해 보시면 됩니다.
                </p>
              </>
            ) : (
              <p className="text-sm cd-text-muted leading-relaxed">
                지금 보고 있는 주소는 <code className="cd-text">{origin || "(확인 중)"}</code> — 서버에 올라간 앱입니다.
                바탕화면의 <b>전표 수집</b> 바로가기로 앱을 띄운 뒤 <code className="cd-text">http://localhost:3000/finance?tab=shopreceipt</code> 를 열어 주세요.
                바로가기가 없으면 <code className="cd-text">scripts\install-receipts-shortcut.ps1</code> 을 한 번 실행하면 만들어집니다.
              </p>
            )}
            <button className="cd-btn cd-btn-sm" onClick={() => void loadStatus()}>
              <RefreshCw size={14} /> 다시 확인
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 기간 + 실행 2 : 쇼핑몰 목록 9 (items-stretch 기본값이라 두 카드 높이가 맞는다) */}
      <div className="grid gap-4 lg:grid-cols-11">
        <div className="cd-card p-4 lg:col-span-2 space-y-3">
          <div className="cd-card-title">쇼핑몰 전표 수집</div>

          <select
            className="cd-select w-full"
            value={year}
            onChange={(e) => applyQuarter(Number(e.target.value), quarter)}
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>

          <div className="flex items-center gap-2 flex-wrap">
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
          </div>

          <div className="flex items-center gap-2">
            <CdDateInput
              className="flex-1 min-w-0"
              value={range.from}
              onChange={(v) => setRange((r) => ({ ...r, from: v }))}
            />
            <span className="cd-text-faint">~</span>
            <CdDateInput
              className="flex-1 min-w-0"
              value={range.to}
              onChange={(v) => setRange((r) => ({ ...r, to: v }))}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="cd-btn cd-btn-sm cd-btn-ghost" onClick={() => void loadStatus()}>
              <RefreshCw size={14} /> 새로고침
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-sm cd-btn-primary ml-auto"
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
        <div className="cd-card p-4 lg:col-span-9">
          {error && <div className="cd-error-text text-sm mb-3">{error}</div>}
          {loading && <div className="text-sm cd-text-muted">불러오는 중…</div>}

          {!loading && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 items-stretch">
            {shops.map((shop) => {
              const checked = selected.has(shop.key);
              return (
                <div key={shop.key} className="border cd-border-c rounded-xl p-3 flex flex-col">
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
                    <span className={sessionBadge(shop).className}>{sessionBadge(shop).label}</span>
                  </div>

                  <div className="text-xs cd-text-muted space-y-0.5">
                    <div>수집 {shop.collected.toLocaleString()}건 · 최근 {formatDate(shop.lastCollectedAt)}</div>
                    <div>
                      {shop.sessionCheckedAt
                        ? `세션 확인 ${formatDateTime(shop.sessionCheckedAt)}`
                        : `로그인 기록 ${formatDate(shop.sessionAt)} · 세션은 아직 확인 전`}
                    </div>
                    {shop.sessionOk === false && shop.sessionReason && (
                      <div className="cd-error-text">{shop.sessionReason}</div>
                    )}
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
                    {shop.loggedIn && (
                      <button
                        type="button"
                        className="cd-btn cd-btn-sm"
                        onClick={() => void checkSession(shop)}
                        disabled={Boolean(running)}
                      >
                        <RefreshCw size={14} /> 세션 확인
                      </button>
                    )}
                  </div>

                  {shop.mode === "bulk" && (
                    <div className="mt-2 space-y-1">
                      <input
                        className="cd-input w-full"
                        placeholder="신청 ID 또는 신청 결과 주소 붙여넣기"
                        value={requestId}
                        onChange={(e) => setRequestId(e.target.value)}
                      />
                      {requestId.trim() && (
                        <div className="text-xs cd-text-faint">
                          {extractRequestId(requestId)
                            ? `신청 ID: ${extractRequestId(requestId)}`
                            : "숫자로 된 신청 ID 를 찾지 못했습니다."}
                        </div>
                      )}
                      <ol className="text-xs cd-text-muted list-decimal pl-4 space-y-0.5">
                        <li>
                          <a
                            className="cd-text-primary underline"
                            href={COUPANG_REQUEST_URL}
                            target="_blank"
                            rel="noreferrer"
                          >
                            쿠팡 영수증 화면
                          </a>
                          에서 기간을 정해 <b>매출전표 일괄 신청</b>
                        </li>
                        <li>처리에 몇 분 걸립니다. 끝나면 신청 내역에서 결과를 엽니다</li>
                        <li>그 주소(…/card-receipt-requests/<b>5320399</b>?page=0)를 위 칸에 붙여넣기</li>
                      </ol>

                      <div className="border-t cd-border-c pt-2 mt-2 space-y-1">
                        <div className="text-xs cd-text-muted">
                          쿠팡 로그인 화면이 자동화를 막아 위 방법이 실패하면, 결과 페이지를 브라우저에서
                          <b> Ctrl+P → PDF 저장</b> 한 뒤 아래로 가져오면 됩니다.
                        </div>
                        <div className="text-xs cd-text-faint break-all">
                          넣는 곳: <code className="cd-text">{shop.inboxPath}</code>
                        </div>
                        <button
                          type="button"
                          className="cd-btn cd-btn-sm cd-btn-soft"
                          onClick={() => void importInbox(shop)}
                          disabled={Boolean(running)}
                        >
                          <FolderOpen size={14} /> PDF 가져오기
                          {shop.inboxCount > 0 && <span className="cd-pill">{shop.inboxCount}</span>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          )}
        </div>
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
