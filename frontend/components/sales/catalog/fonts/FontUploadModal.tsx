"use client";

// 서체 올리기 창(블루프린트 §5-3) — ① 파일 고르기(TTF·OTF·WOFF·WOFF2, 굵기 여러 개 한 번에) → 서버가 바로 분석(저장 안 함)
// → ② 패밀리·굵기·용도(본문 가능/제목 전용)·포함 허용·글자 범위를 보고 → ③ 라이선스(출처·종류·허용 범위)를 적고 확인해야 [등록].
// 포함 제한(Restricted) 등 거부된 파일은 빼고 등록한다. 등록하면 서버가 다시 분석하고 converter 로 TrueType 윤곽 WOFF 를 만든다.

import { useMemo, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  EMBED_LABEL,
  FONT_CLASS_LABEL,
  LICENSE_SCOPES,
  LICENSE_TYPES,
  MAX_FONT_FILE_BYTES,
  type FontClass,
  type FontFamilyVerdict,
  type FontFileAnalysis,
  type LicenseScope,
} from "@/lib/catalog/font-types";
import { catalogFetch } from "../catalogFetch";

interface Analysis {
  files: FontFileAnalysis[];
  families: FontFamilyVerdict[];
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;

export function FontUploadModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classification, setClassification] = useState<"" | FontClass>("");
  const [displayName, setDisplayName] = useState("");
  const [licType, setLicType] = useState("");
  const [licSource, setLicSource] = useState("");
  const [licScope, setLicScope] = useState<LicenseScope[]>([]);
  const [licNote, setLicNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const reset = () => {
    setFiles([]);
    setAnalysis(null);
    setError(null);
    setClassification("");
    setDisplayName("");
    setLicType("");
    setLicSource("");
    setLicScope([]);
    setLicNote("");
    setConfirmed(false);
  };
  const close = () => {
    if (registering) return;
    reset();
    onClose();
  };

  const pick = async (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    if (!chosen.length) return;
    setFiles(chosen);
    setAnalysis(null);
    setError(null);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      // 20MB 넘는 파일은 보내지 않고 이름만(서버가 크기로 거부 사유를 단다) — 업로드 낭비 방지
      for (const f of chosen) fd.append("files", f.size > MAX_FONT_FILE_BYTES ? new File([new Uint8Array(0)], f.name) : f);
      const res = await catalogFetch<Analysis>("/api/catalog/fonts/analyze", { method: "POST", body: fd });
      res.files = res.files.map((a, i) =>
        chosen[i] && chosen[i].size > MAX_FONT_FILE_BYTES ? { ...a, bytes: chosen[i].size, errors: [`파일이 ${mb(chosen[i].size)} 로 상한(20MB)을 넘습니다.`] } : a
      );
      res.families = res.families.filter((f) => f.fileIndexes.every((i) => !res.files[i].errors.length));
      setAnalysis(res);
      // 서체 파일 안 라이선스 문구가 OFL 이면 미리 채운다(확인은 사람이 한다)
      const hint = res.files.find((a) => a.licenseHint)?.licenseHint ?? "";
      if (/open font license|\bOFL\b/i.test(hint)) {
        setLicType("ofl");
        setLicScope(["print", "pdf", "web"]);
      }
      const url = res.files.find((a) => a.licenseUrl)?.licenseUrl;
      if (url) setLicSource(url);
      if (res.families.length === 1) setDisplayName(res.families[0].displayName);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  // 장식·손글씨로 지정하면 화면에서 바로 제목 전용으로 보여 준다(서버도 등록 때 같은 규칙으로 판정)
  const families = useMemo(
    () =>
      (analysis?.families ?? []).map((f) => {
        const cls = classification || f.classification;
        if (cls !== "decorative" || !f.bodyCapable) return { ...f, classification: cls };
        return { ...f, classification: cls, bodyCapable: false, roles: f.roles.filter((r) => r !== "body"), reasons: [...f.reasons, "장식·손글씨체"] };
      }),
    [analysis, classification]
  );
  const accepted = (analysis?.files ?? []).map((a, i) => (a.errors.length ? -1 : i)).filter((i) => i >= 0);
  const rejected = (analysis?.files.length ?? 0) - accepted.length;
  const licenseProblems: string[] = [];
  if (!licType) licenseProblems.push("라이선스 종류를 고르세요.");
  if (!licSource.trim()) licenseProblems.push("출처(내려받은 곳·구입처)를 적으세요.");
  if (!licScope.includes("pdf")) licenseProblems.push("PDF 포함(임베딩)이 허용되어야 회사소개서에 쓸 수 있습니다.");
  if (licType === "purchased" && !licNote.trim()) licenseProblems.push("구매 서체는 증빙 메모를 적으세요.");
  if (!confirmed) licenseProblems.push("라이선스 확인 항목에 표시하세요.");
  const canRegister = Boolean(analysis) && accepted.length > 0 && licenseProblems.length === 0 && !registering && !analyzing;

  // 파일 하나씩(가변 서체는 굵기 하나씩) 등록한다 — 한 요청이 converter 변환 한 번(운영 converter 에서 한 굵기 수십 초)
  const register = async () => {
    if (!analysis || !canRegister) return;
    const jobs = accepted.flatMap((i) => {
      const a = analysis.files[i];
      return a.variable
        ? a.instanceWeights.map((w) => ({ i, weight: w as number | null, label: `${a.fileName} · 굵기 ${w}` }))
        : [{ i, weight: null as number | null, label: a.fileName }];
    });
    setRegistering(true);
    setError(null);
    const done: Record<string, { displayName: string; weights: Set<number> }> = {};
    try {
      for (const [k, job] of jobs.entries()) {
        setProgress({ done: k, total: jobs.length, label: job.label });
        const fd = new FormData();
        fd.append("files", files[job.i]);
        if (job.weight) fd.append("instanceWeight", String(job.weight));
        fd.append("licenseType", licType);
        fd.append("licenseSource", licSource.trim());
        for (const s of licScope) fd.append("licenseScope", s);
        fd.append("licenseNote", licNote.trim());
        fd.append("licenseConfirmed", confirmed ? "1" : "0");
        if (classification) fd.append("classification", classification);
        if (families.length === 1 && displayName.trim()) fd.append("displayName", displayName.trim());
        let res: { fonts: Array<{ fontId: string; displayName: string; weights: number[] }> };
        try {
          res = await catalogFetch("/api/catalog/fonts", { method: "POST", body: fd });
        } catch (e) {
          throw new Error(`${job.label}: ${(e as Error).message}${k ? ` (앞의 ${k}개는 등록됐습니다 — 남은 파일만 다시 올리세요)` : ""}`);
        }
        for (const f of res.fonts) {
          const d = (done[f.fontId] ??= { displayName: f.displayName, weights: new Set<number>() });
          for (const w of f.weights) d.weights.add(w);
        }
      }
      const msg = Object.values(done)
        .map((f) => `${f.displayName}(${Array.from(f.weights).sort((a, b) => a - b).join("·")})`)
        .join(", ");
      reset();
      onDone(`서체를 등록했습니다: ${msg}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegistering(false);
      setProgress(null);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={close}
      title="서체 올리기"
      size="xl"
      closeOnBackdrop={!registering}
      footer={
        <>
          {registering ? (
            <span className="text-xs cd-text-muted mr-auto inline-flex items-center gap-1" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> PDF 용 파일을 만드는 중{progress ? ` ${progress.done + 1}/${progress.total} — ${progress.label}` : ""} · 한 굵기에 1분 안팎
            </span>
          ) : analysis && licenseProblems.length && accepted.length ? (
            <span className="text-xs cd-text-muted mr-auto">{licenseProblems[0]}</span>
          ) : null}
          <button type="button" className="cd-btn cd-btn-ghost" onClick={close} disabled={registering}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary" onClick={register} disabled={!canRegister}>
            등록{rejected && accepted.length ? `(거부 ${rejected}개 빼고)` : ""}
          </button>
        </>
      }
    >
      <div className="p-4 flex flex-col gap-4 text-sm">
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className={`cd-btn cd-btn-soft cd-action cursor-pointer ${analyzing || registering ? "opacity-50 pointer-events-none" : ""}`}>
              <FileUp className="w-4 h-4" /> 서체 파일 고르기
              <input
                ref={inputRef}
                type="file"
                multiple
                className="sr-only"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                onChange={(e) => {
                  void pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-xs cd-text-muted">TTF·OTF·WOFF·WOFF2 · 굵기별 파일을 한 번에 여러 개 · 파일당 20MB</span>
            <CdHelp topic="catalog.fonts-upload" />
            <label className="flex items-center gap-1 text-xs ml-auto">
              분류
              <select className="cd-select" style={{ width: 130 }} value={classification} onChange={(e) => setClassification(e.target.value as "" | FontClass)} aria-label="서체 분류">
                <option value="">자동 판별</option>
                {(Object.keys(FONT_CLASS_LABEL) as FontClass[]).map((c) => (
                  <option key={c} value={c}>
                    {FONT_CLASS_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {analyzing ? (
            <p className="text-xs cd-text-muted inline-flex items-center gap-1" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 분석 중…
            </p>
          ) : null}
          {error ? (
            <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs" role="alert">
              {error}
            </div>
          ) : null}
        </section>

        {analysis ? (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="cd-text font-semibold text-base">파일 분석</h3>
              <div className="overflow-x-auto">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>파일</th>
                      <th>패밀리</th>
                      <th className="text-right">굵기</th>
                      <th>윤곽</th>
                      <th>포함 허용</th>
                      <th className="text-right">한글 완성형</th>
                      <th>판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.files.map((a, i) => (
                      <tr key={`${a.fileName}-${i}`}>
                        <td className="cd-text">
                          {a.fileName}
                          <span className="block text-[11px] cd-text-faint">
                            {a.format.toUpperCase()} · {mb(a.bytes)}
                          </span>
                        </td>
                        <td className="cd-text">{a.errors.length && !a.postscriptName ? "—" : a.familyLocal || a.family}</td>
                        <td className="text-right tabular-nums">{a.variable ? `${a.variable.min}–${a.variable.max}` : a.weight}{a.italic ? " 기울임" : ""}</td>
                        <td className="text-xs">{a.outline === "truetype" ? "TrueType" : a.outline ? "CFF" : "—"}{a.variable ? " · 가변" : ""}</td>
                        <td>
                          <span className={`cd-pill ${a.embed === "restricted" || a.embed === "bitmap" ? "cd-pill-error" : a.embed === "print" ? "cd-pill-warn" : "cd-pill-idle"}`}>{EMBED_LABEL[a.embed]}</span>
                        </td>
                        <td className="text-right tabular-nums">{a.errors.length && !a.coverage.hangul2350 ? "—" : `${a.coverage.hangul2350.toLocaleString()}자`}</td>
                        <td className="text-xs" style={{ minWidth: 220 }}>
                          {a.errors.length ? (
                            <span className="cd-error-text">거부 — {a.errors.join(" ")}</span>
                          ) : a.warnings.length ? (
                            <ul className="list-disc pl-4 cd-text-muted">
                              {a.warnings.map((w) => (
                                <li key={w}>{w}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="cd-text-muted">문제 없음</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {families.length ? (
              <section className="flex flex-col gap-2">
                <h3 className="cd-text font-semibold text-base flex items-center gap-1">
                  등록될 서체 <CdHelp topic="catalog.fonts-verdict" />
                </h3>
                {families.map((f) => (
                  <div key={f.family} className="rounded-lg border cd-border-c p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <b className="cd-text">{f.displayName}</b>
                      <span className="text-xs cd-text-faint">{f.family}</span>
                      {f.bodyCapable ? <span className="cd-pill cd-pill-success">본문 가능</span> : <span className="cd-pill cd-pill-warn">제목 전용</span>}
                      <span className="cd-pill cd-pill-idle">{FONT_CLASS_LABEL[f.classification]}</span>
                      {f.existingFontId ? <span className="cd-pill cd-pill-info">등록된 서체에 굵기 추가</span> : null}
                    </div>
                    <p className="text-xs cd-text">
                      굵기 {f.weights.join("·")} · 한글 완성형 {f.coverage.hangul2350.toLocaleString()}/2,350자 · 크기 보정 {f.sizeAdjust.sizeAdjust}%
                      {f.coverage.symbolsMissing ? ` · 없는 기호 ${f.coverage.symbolsMissing}` : ""}
                    </p>
                    {f.reasons.length ? <p className="text-xs cd-text-muted">제목 전용인 이유: {f.reasons.join(" · ")}</p> : null}
                    {f.coverage.hangulMissing ? (
                      <p className="text-xs cd-text-muted break-all" lang="ko">
                        빠진 완성형 글자: {f.coverage.hangulMissing.slice(0, 80)}
                        {f.coverage.hangulMissing.length > 80 ? " …" : ""}
                      </p>
                    ) : null}
                    {f.warnings.map((w) => (
                      <p key={w} className="text-xs cd-text-muted">
                        {w}
                      </p>
                    ))}
                  </div>
                ))}
                {families.length === 1 ? (
                  <label className="flex items-center gap-2 text-xs">
                    표시 이름
                    <input className="cd-input" style={{ maxWidth: 260 }} value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
                  </label>
                ) : (
                  <p className="text-xs cd-text-muted">패밀리 {families.length}개가 같은 라이선스로 등록됩니다. 라이선스가 다르면 나눠서 올리세요.</p>
                )}
              </section>
            ) : null}

            {accepted.length ? (
              <section className="flex flex-col gap-2">
                <h3 className="cd-text font-semibold text-base flex items-center gap-1">
                  라이선스 <CdHelp topic="catalog.fonts-license" />
                </h3>
                {analysis.files.find((a) => a.licenseHint) ? (
                  <p className="text-xs cd-text-muted">서체 파일 안 라이선스 문구: {analysis.files.find((a) => a.licenseHint)?.licenseHint}</p>
                ) : null}
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                  <label className="flex flex-col gap-1 text-xs">
                    종류
                    <select className="cd-select" value={licType} onChange={(e) => setLicType(e.target.value)}>
                      <option value="">고르세요</option>
                      {LICENSE_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    출처(내려받은 곳·구입처)
                    <input className="cd-input" value={licSource} maxLength={300} onChange={(e) => setLicSource(e.target.value)} placeholder="https://… 또는 구입처" />
                  </label>
                </div>
                <fieldset className="flex items-center gap-3 flex-wrap text-xs">
                  <legend className="sr-only">허용 범위</legend>
                  <span className="cd-text-muted">허용 범위</span>
                  {LICENSE_SCOPES.map((sc) => (
                    <label key={sc.id} className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={licScope.includes(sc.id)}
                        onChange={(e) => setLicScope(e.target.checked ? [...licScope, sc.id] : licScope.filter((x) => x !== sc.id))}
                      />
                      {sc.label}
                      {sc.id === "pdf" ? <span className="cd-text-faint">(필수)</span> : null}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1 text-xs">
                  증빙 메모{licType === "purchased" ? "(구매 서체는 필수 — 구입처·계약 번호·허용 범위)" : ""}
                  <textarea className="cd-textarea" rows={2} value={licNote} maxLength={1000} onChange={(e) => setLicNote(e.target.value)} />
                </label>
                <p className="text-xs cd-text-muted">CFF(OTF) 서체는 PDF 부분 포함을 위해 TrueType 윤곽으로 바꿔 저장합니다. 라이선스가 형식 변환을 허용하는지도 확인하세요.</p>
                <label className="inline-flex items-start gap-1.5 text-xs cd-text">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                  위 라이선스로 이 서체를 회사소개서(PDF 포함·인쇄)에 써도 됨을 확인했습니다.
                </label>
              </section>
            ) : (
              <p className="text-xs cd-error-text">등록할 수 있는 파일이 없습니다. 거부 사유를 확인하고 다른 파일을 고르세요.</p>
            )}
          </>
        ) : !analyzing ? (
          <p className="text-xs cd-text-faint">파일을 고르면 바로 분석합니다(아직 저장하지 않습니다).</p>
        ) : null}
      </div>
    </CdModal>
  );
}
