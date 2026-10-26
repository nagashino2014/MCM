"use client";

// 일러스트 더하기 — ① 묶음 폴더: 관리자 PC 매처(asset_matcher.py export)가 만든 폴더를 통째로 고르면 영역마다 meta.json·illust.svg·thumb.png 를 찾아
// 목록으로 보여 주고, 고른 것만 한 건씩 올린다(같은 키는 새 판으로 교체). ② SVG 한 장: 이미 벡터로 정리한 SVG 를 올리고 글자 자리는 상세에서 그린다.
// .ai·.eps 는 브라우저에서 열 수 없어 매처를 거친다(Illustrator 변환·글자 레이어 걷기·색 변수화).

import { useEffect, useRef, useState } from "react";
import { FileUp, FolderUp, Loader2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { INFO_TYPES, INFO_TYPE_META, type InfoType } from "@/lib/catalog/render/infographic/types";
import { catalogFetch } from "../catalogFetch";

interface Bundle {
  dir: string;
  meta: Record<string, unknown>;
  svg: File;
  thumb: File | null;
  state: "ready" | "uploading" | "done" | "error";
  message?: string;
  pick: boolean;
}

export const LICENSE_KINDS = ["Standard", "Extended", "Enhanced", "무료(상업 이용 가능)", "자체 제작", "기타"];

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

async function readBundles(files: FileList): Promise<{ bundles: Bundle[]; skipped: string[] }> {
  const byDir = new Map<string, Record<string, File>>();
  for (const f of Array.from(files)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split("/");
    const name = parts.pop()!;
    if (!["meta.json", "illust.svg", "thumb.png"].includes(name)) continue;
    const dir = parts.join("/");
    (byDir.get(dir) ?? byDir.set(dir, {}).get(dir)!)[name] = f;
  }
  const bundles: Bundle[] = [];
  const skipped: string[] = [];
  for (const [dir, got] of [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!got["meta.json"] || !got["illust.svg"]) {
      skipped.push(`${dir || "(폴더)"} — ${!got["meta.json"] ? "meta.json" : "illust.svg"} 없음`);
      continue;
    }
    try {
      const meta = JSON.parse(await got["meta.json"].text()) as Record<string, unknown>;
      bundles.push({ dir, meta, svg: got["illust.svg"], thumb: got["thumb.png"] ?? null, state: "ready", pick: got["illust.svg"].size <= 3 * 1048576 });
    } catch {
      skipped.push(`${dir} — meta.json 을 읽지 못함`);
    }
  }
  return { bundles, skipped };
}

export function IllustrationImportModal({ mode, onClose, onDone }: { mode: "folder" | "svg" | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  // SVG 한 장
  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<InfoType>("process");
  const [count, setCount] = useState(4);
  const [provider, setProvider] = useState("Adobe Stock");
  const [stockId, setStockId] = useState("");
  const [licenseKind, setLicenseKind] = useState("Standard");

  useEffect(() => {
    if (!mode) return;
    setBundles([]);
    setSkipped([]);
    setError(null);
    setSvgFile(null);
    setTitle("");
    setStockId("");
  }, [mode]);
  // 폴더 고르기 입력은 비표준 속성(webkitdirectory)이라 DOM 에 직접 단다
  useEffect(() => {
    const el = dirRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  });

  const close = () => {
    if (!running) onClose();
  };

  const pickFolder = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const r = await readBundles(files);
    setBundles(r.bundles);
    setSkipped(r.skipped);
    if (!r.bundles.length) setError("이 폴더에서 meta.json·illust.svg 묶음을 찾지 못했습니다. 매처 export 의 --out 폴더를 고르세요.");
  };

  const runFolder = async () => {
    setRunning(true);
    let ok = 0;
    let replaced = 0;
    for (let i = 0; i < bundles.length; i++) {
      const b = bundles[i];
      if (!b.pick || b.state === "done") continue;
      setBundles((list) => list.map((x, j) => (j === i ? { ...x, state: "uploading" } : x)));
      const form = new FormData();
      form.set("meta", JSON.stringify(b.meta));
      form.set("svg", b.svg);
      if (b.thumb) form.set("thumb", b.thumb);
      try {
        const out = await catalogFetch<{ replaced: Array<{ action: string }> }>("/api/catalog/illustrations", { method: "POST", body: form });
        ok += 1;
        replaced += out.replaced.length;
        setBundles((list) => list.map((x, j) => (j === i ? { ...x, state: "done", message: out.replaced.length ? `이전 판 ${out.replaced.length}건 교체` : "추가" } : x)));
      } catch (e) {
        setBundles((list) => list.map((x, j) => (j === i ? { ...x, state: "error", message: (e as Error).message } : x)));
      }
    }
    setRunning(false);
    const failed = bundles.filter((b) => b.pick).length - ok;
    if (ok && !failed) onDone(`일러스트 ${ok}점을 가져왔습니다${replaced ? `(이전 판 ${replaced}건 교체)` : ""}.`);
    else if (ok) setError(`${ok}점은 가져왔고 ${failed}점은 실패했습니다. 사유를 확인하세요.`);
  };

  const runSvg = async () => {
    if (!svgFile) return;
    setRunning(true);
    setError(null);
    const form = new FormData();
    form.set(
      "meta",
      JSON.stringify({
        key: `upload:${svgFile.name}`,
        title: title || svgFile.name.replace(/\.svg$/i, ""),
        type,
        count,
        quality: 3,
        slots: [],
        license: { provider, stockId, license: licenseKind, file: svgFile.name },
      })
    );
    form.set("svg", svgFile);
    try {
      await catalogFetch("/api/catalog/illustrations", { method: "POST", body: form });
      onDone("SVG 를 올렸습니다. 카드를 열어 글자 자리를 그려 주세요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const picked = bundles.filter((b) => b.pick && b.state !== "done").length;
  return (
    <CdModal
      open={mode != null}
      onClose={close}
      title={mode === "svg" ? "SVG 한 장 올리기" : "묶음 폴더 가져오기"}
      size="xl"
      closeOnBackdrop={!running}
      footer={
        <>
          {running ? (
            <span className="text-xs cd-text-muted mr-auto inline-flex items-center gap-1" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 올리는 중 — SVG 를 정리해 저장합니다
            </span>
          ) : null}
          <button type="button" className="cd-btn cd-btn-ghost" onClick={close} disabled={running}>
            닫기
          </button>
          {mode === "svg" ? (
            <button type="button" className="cd-btn cd-btn-primary" onClick={() => void runSvg()} disabled={running || !svgFile}>
              올리기
            </button>
          ) : (
            <button type="button" className="cd-btn cd-btn-primary" onClick={() => void runFolder()} disabled={running || !picked}>
              가져오기 {picked ? `${picked}점` : ""}
            </button>
          )}
        </>
      }
    >
      <div className="p-4 flex flex-col gap-3 text-sm">
        {error ? <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-sm">{error}</div> : null}
        {mode === "folder" ? (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <label className={`cd-btn cd-btn-soft cd-action cursor-pointer ${running ? "opacity-50 pointer-events-none" : ""}`}>
                <FolderUp className="w-4 h-4" /> 폴더 고르기
                <input ref={dirRef} type="file" multiple className="sr-only" onChange={(e) => void pickFolder(e.target.files)} />
              </label>
              <span className="text-xs cd-text-muted flex items-center gap-1">
                관리자 PC 에서 <code>asset_matcher.py export --out &lt;폴더&gt;</code> 로 만든 폴더 <CdHelp topic="catalog.illustrations-import" />
              </span>
            </div>
            {bundles.length ? (
              <div className="overflow-x-auto">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          aria-label="모두 고르기"
                          checked={bundles.every((b) => b.pick)}
                          onChange={(e) => setBundles((list) => list.map((b) => ({ ...b, pick: e.target.checked })))}
                          disabled={running}
                        />
                      </th>
                      <th>일러스트</th>
                      <th>유형·항목</th>
                      <th className="text-right">글자 자리</th>
                      <th className="text-right">SVG</th>
                      <th>출처</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundles.map((b, i) => {
                      const t = typeof b.meta.type === "string" && b.meta.type in INFO_TYPE_META ? INFO_TYPE_META[b.meta.type as InfoType].label : String(b.meta.type ?? "—");
                      const lic = (b.meta.license ?? {}) as Record<string, string>;
                      const warns = Array.isArray(b.meta.warnings) ? (b.meta.warnings as string[]) : [];
                      return (
                        <tr key={b.dir}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${String(b.meta.title ?? b.dir)} 고르기`}
                              checked={b.pick}
                              onChange={(e) => setBundles((list) => list.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))}
                              disabled={running || b.state === "done"}
                            />
                          </td>
                          <td className="cd-text">
                            {String(b.meta.title ?? b.dir)}
                            <span className="block text-[11px] cd-text-faint">{String(b.meta.key ?? b.dir)}</span>
                            {warns.length ? <span className="block text-[11px] cd-text-muted">{warns.join(" · ")}</span> : null}
                          </td>
                          <td className="text-xs whitespace-nowrap">
                            {t} · {String(b.meta.count ?? "?")}항목
                          </td>
                          <td className="text-right tabular-nums text-xs">{Array.isArray(b.meta.slots) ? b.meta.slots.length : 0}</td>
                          <td className="text-right tabular-nums text-xs">
                            {kb(b.svg.size)}
                            {b.svg.size > 3 * 1048576 ? <span className="block cd-error-text">3MB 초과</span> : null}
                          </td>
                          <td className="text-xs">{[lic.provider, lic.stockId ? `#${lic.stockId}` : "", lic.license].filter(Boolean).join(" · ") || "—"}</td>
                          <td className="text-xs" style={{ minWidth: 120 }}>
                            {b.state === "uploading" ? (
                              <span className="inline-flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> 올리는 중
                              </span>
                            ) : b.state === "done" ? (
                              <span className="cd-pill cd-pill-success">{b.message}</span>
                            ) : b.state === "error" ? (
                              <span className="cd-error-text">{b.message}</span>
                            ) : (
                              <span className="cd-text-faint">대기</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs cd-text-faint">
                폴더 안 영역마다 <code>meta.json</code>(판정 유형·항목 수·글자 자리·색·라이선스) · <code>illust.svg</code>(정리한 벡터) · <code>thumb.png</code> 가 있어야 합니다. 같은 키를 다시 올리면 새 판으로 바뀌고, 이미 쪽에 쓰인 이전 판은 보관됩니다.
              </p>
            )}
            {skipped.length ? <p className="text-[11px] cd-text-muted">건너뜀: {skipped.join(" · ")}</p> : null}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <label className={`cd-btn cd-btn-soft cd-action cursor-pointer ${running ? "opacity-50 pointer-events-none" : ""}`}>
                <FileUp className="w-4 h-4" /> SVG 고르기
                <input type="file" accept=".svg,image/svg+xml" className="sr-only" onChange={(e) => setSvgFile(e.target.files?.[0] ?? null)} />
              </label>
              <span className="text-xs cd-text-muted">{svgFile ? `${svgFile.name} · ${kb(svgFile.size)}` : "3MB 이하 · 글자는 지운 그림이 좋습니다(글은 앱이 얹습니다)"}</span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              <label className="text-xs cd-text-muted flex flex-col gap-1">
                이름
                <input className="cd-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 5단계 화살 띠" />
              </label>
              <label className="text-xs cd-text-muted flex flex-col gap-1">
                유형(기본 인포그래픽과의 관계)
                <select className="cd-select" value={type} onChange={(e) => setType(e.target.value as InfoType)}>
                  {INFO_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs cd-text-muted flex flex-col gap-1">
                항목 수(그림에 고정)
                <input className="cd-input" type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
              </label>
              <label className="text-xs cd-text-muted flex flex-col gap-1">
                출처
                <input className="cd-input" value={provider} onChange={(e) => setProvider(e.target.value)} />
              </label>
              <label className="text-xs cd-text-muted flex flex-col gap-1">
                스톡 번호
                <input className="cd-input" value={stockId} onChange={(e) => setStockId(e.target.value.replace(/[^\w-]/g, ""))} placeholder="예: 1998385985" />
              </label>
              <label className="text-xs cd-text-muted flex flex-col gap-1">
                라이선스
                <select className="cd-select" value={licenseKind} onChange={(e) => setLicenseKind(e.target.value)}>
                  {LICENSE_KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-xs cd-text-faint">스크립트·외부 참조는 지우고, 색은 바꿔 칠할 수 있게 변수로 바꿔 저장합니다. 올린 뒤 카드를 열어 글자 자리(제목·설명·숫자)를 그려야 스튜디오 후보로 뜹니다.</p>
          </>
        )}
      </div>
    </CdModal>
  );
}
