"use client";

// 서체 상세(오른쪽 드로어) — 굵기별 견본(한글·영문·숫자) · 본문 단락·표·큰 숫자 · 분석 결과(용도·포함 허용·글자 범위·수치·크기 보정)
// · 라이선스 · 파일(원본·변환본) · 쓰는 곳. 업로드 서체는 이름·분류를 고치고, 지우는 대신 비활성화한다(지난 PDF 재현).

import { useEffect, useMemo, useState } from "react";
import { CdDrawer } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  DOC_SYMBOLS,
  EMBED_LABEL,
  FONT_CLASS_LABEL,
  LICENSE_SCOPES,
  LICENSE_TYPES,
  type CatalogFont,
  type FontClass,
  type FontUsage,
} from "@/lib/catalog/font-types";
import { Paper, SPECIMEN, fontPreviewFaces, useLoadedFaces } from "./specimen";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
const WEIGHT_NAME: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };

export function FontDetailDrawer({
  font,
  usage,
  setNames,
  busy,
  onClose,
  onPatch,
}: {
  font: CatalogFont | null;
  usage: FontUsage | null;
  /** 세트 id → 이름 */
  setNames: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onPatch: (patch: { displayName?: string; classification?: FontClass; isActive?: boolean }) => Promise<boolean>;
}) {
  const faces = useMemo(() => (font ? fontPreviewFaces(font) : []), [font]);
  const { css, status } = useLoadedFaces(faces);
  const [name, setName] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  useEffect(() => {
    setName(font?.displayName ?? "");
    setConfirmOff(false);
  }, [font]);

  if (!font) return null;
  const family = `kcf-${font.fontId}`;
  const ff = `"${family}", "Pretendard", sans-serif`;
  const weights = font.files.filter((f) => f.style === "normal").map((f) => f.weight);
  const regular = weights.slice().sort((a, b) => Math.abs(a - 400) - Math.abs(b - 400))[0] ?? 400;
  const bold = weights.filter((w) => w >= 600).sort((a, b) => Math.abs(a - 700) - Math.abs(b - 700))[0] ?? weights[weights.length - 1] ?? 700;
  const failed = Object.entries(status).filter(([, v]) => v === "error").map(([k]) => k.split(":")[1]);
  const sets = usage?.setsByFont[font.fontId] ?? [];
  const docs = Array.from(new Map(sets.flatMap((id) => usage?.documentsBySet[id] ?? []).map((d) => [d.docId, d])).values());
  const pdfs = usage?.editionsByFont[font.fontId] ?? 0;
  const upload = font.source === "upload";
  const cov = font.coverage;
  const lic = font.license;

  return (
    <CdDrawer
      open
      onClose={onClose}
      title={`${font.displayName} — 견본·분석`}
      widthClass="max-w-3xl"
      footer={
        upload ? (
          confirmOff ? (
            <>
              <span className="text-xs cd-text-muted mr-auto">새 세트에서 고를 수 없게 됩니다. 이미 쓰는 세트와 지난 PDF 는 그대로 그립니다.</span>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setConfirmOff(false)}>
                취소
              </button>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={async () => (await onPatch({ isActive: false })) && setConfirmOff(false)}>
                비활성화 확인
              </button>
            </>
          ) : font.isActive ? (
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => setConfirmOff(true)}>
              비활성화
            </button>
          ) : (
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => void onPatch({ isActive: true })}>
              다시 쓰기
            </button>
          )
        ) : (
          <span className="text-xs cd-text-muted mr-auto">기본 서체는 앱에 들어 있어 고치거나 끌 수 없습니다.</span>
        )
      }
    >
      <style>{css}</style>
      <div className="flex flex-col gap-4 text-sm">
        {failed.length ? (
          <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs" role="alert">
            브라우저가 굵기 {failed.join("·")} 파일을 읽지 못했습니다 — 견본이 대체 서체로 보입니다. 서체 파일을 다시 올려 주세요.
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="cd-text font-semibold text-base flex items-center gap-1">
            견본 <CdHelp topic="catalog.fonts-specimen" />
          </h3>
          <Paper className="p-4 flex flex-col gap-4">
            {weights.map((w) => (
              <div key={w} className="flex flex-col gap-1" style={{ fontFamily: ff, fontWeight: w }}>
                <span style={{ fontFamily: "Pretendard, sans-serif", fontSize: 11, fontWeight: 600, color: "#5b6475" }}>
                  {w} · {WEIGHT_NAME[w] ?? ""}
                  {status[`${family}:${w}`] === "error" ? " — 읽지 못함" : ""}
                </span>
                <span style={{ fontSize: 24, lineHeight: "32px" }}>{SPECIMEN.title}</span>
                <span style={{ fontSize: 15, lineHeight: "22px" }}>{SPECIMEN.latin}</span>
                <span style={{ fontSize: 15, lineHeight: "22px", fontVariantNumeric: "tabular-nums" }}>{SPECIMEN.digits}</span>
              </div>
            ))}
            <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", fontFamily: ff }}>
              <div className="flex flex-col gap-2">
                <span style={{ fontSize: 15, lineHeight: "22px", fontWeight: bold }}>본문 단락 · 12pt</span>
                <p style={{ fontSize: 12, lineHeight: "19px", fontWeight: regular, margin: 0 }}>{SPECIMEN.body}</p>
                <table style={{ fontSize: 11, lineHeight: "16px", borderCollapse: "collapse", width: "100%" }}>
                  <tbody>
                    {SPECIMEN.table.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #d9dee8", fontWeight: i === 0 ? bold : regular }}>
                        {row.map((c, j) => (
                          <td key={j} style={{ padding: "4px 6px", textAlign: j ? "right" : "left", fontVariantNumeric: "tabular-nums" }}>
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-1">
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5b6475" }}>큰 숫자 · 36pt</span>
                <span style={{ fontSize: 36, lineHeight: "40px", fontWeight: bold, letterSpacing: "-0.8px", fontVariantNumeric: "tabular-nums" }}>{SPECIMEN.figure}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5b6475", marginTop: 8 }}>문서 기호</span>
                <span style={{ fontSize: 18, letterSpacing: 2 }}>
                  {Array.from(DOC_SYMBOLS).map((c) => (
                    <span key={c} style={cov.symbolsMissing.includes(c) ? { color: "#b42318", textDecoration: "line-through" } : undefined}>
                      {c}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </Paper>
          <p className="text-xs cd-text-muted">문서와 같은 크기 보정(size-adjust {font.sizeAdjust.sizeAdjust}%)으로 그립니다. 빨간 줄 기호는 이 서체에 없어 대체 서체(프리텐다드 등)로 채웁니다.</p>
        </section>

        <section className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <dl className="rounded-lg border cd-border-c p-3 grid gap-x-3 gap-y-1.5 text-xs" style={{ gridTemplateColumns: "auto 1fr" }}>
            <dt className="cd-text-muted">용도</dt>
            <dd className="cd-text">
              {font.bodyCapable ? <span className="cd-pill cd-pill-success">본문 가능</span> : <span className="cd-pill cd-pill-warn">제목 전용</span>}
              {font.reasons.length ? <span className="block cd-text-muted mt-1">{font.reasons.join(" · ")}</span> : null}
            </dd>
            <dt className="cd-text-muted">쓸 수 있는 역할</dt>
            <dd className="cd-text">{font.roles.map((r) => ({ display: "제목", body: "본문", figure: "숫자" })[r]).join(" · ")}</dd>
            <dt className="cd-text-muted">분류</dt>
            <dd className="cd-text">
              {upload ? (
                <select
                  className="cd-select"
                  style={{ width: 140 }}
                  value={font.classification}
                  disabled={busy}
                  aria-label="서체 분류"
                  onChange={(e) => void onPatch({ classification: e.target.value as FontClass })}
                >
                  {(Object.keys(FONT_CLASS_LABEL) as FontClass[]).map((c) => (
                    <option key={c} value={c}>
                      {FONT_CLASS_LABEL[c]}
                    </option>
                  ))}
                </select>
              ) : (
                FONT_CLASS_LABEL[font.classification]
              )}
            </dd>
            <dt className="cd-text-muted">포함 허용</dt>
            <dd className="cd-text">
              <span className={`cd-pill ${font.embed === "print" ? "cd-pill-warn" : "cd-pill-idle"}`}>{EMBED_LABEL[font.embed]}</span>
              {font.noSubsetting ? <span className="block cd-text-muted mt-1">부분 포함 금지 — PDF 에 서체 전체가 들어갑니다</span> : null}
            </dd>
            <dt className="cd-text-muted">크기 보정</dt>
            <dd className="cd-text tabular-nums">
              size {font.sizeAdjust.sizeAdjust}% · 위 {font.sizeAdjust.ascentOverride}% · 아래 {font.sizeAdjust.descentOverride}%
              <span className="block cd-text-muted">기준 {font.sizeAdjust.basis === "hangul" ? "한글 평균 폭" : font.sizeAdjust.basis === "x-height" ? "x높이" : "없음"} — 프리텐다드와 맞춤</span>
            </dd>
            <dt className="cd-text-muted">글자 꼴 수치</dt>
            <dd className="cd-text tabular-nums">
              em {font.metrics.unitsPerEm} · x높이 {font.metrics.xHeight} · 한글 폭 {font.metrics.hangulAdvance ?? "—"}
            </dd>
          </dl>
          <dl className="rounded-lg border cd-border-c p-3 grid gap-x-3 gap-y-1.5 text-xs" style={{ gridTemplateColumns: "auto 1fr" }}>
            <dt className="cd-text-muted">한글 완성형</dt>
            <dd className="cd-text tabular-nums">
              {cov.hangul2350.toLocaleString()} / 2,350자 {cov.hangul2350 < 2350 ? <span className="cd-error-text">({(2350 - cov.hangul2350).toLocaleString()}자 없음)</span> : null}
            </dd>
            {cov.hangulMissing ? (
              <>
                <dt className="cd-text-muted">빠진 글자</dt>
                <dd className="cd-text break-all" lang="ko">
                  {cov.hangulMissing.slice(0, 120)}
                  {cov.hangulMissing.length > 120 ? " …" : ""}
                </dd>
              </>
            ) : null}
            <dt className="cd-text-muted">현대 한글</dt>
            <dd className="cd-text tabular-nums">{cov.hangulAll.toLocaleString()} / 11,172자</dd>
            <dt className="cd-text-muted">영문·숫자</dt>
            <dd className="cd-text">
              {cov.latin ? "영문 있음" : "영문 없음"} · {cov.digits ? "숫자 있음" : "숫자 없음"} · {cov.tnum ? "고정폭 숫자" : "고정폭 숫자 없음"}
            </dd>
            <dt className="cd-text-muted">없는 문서 기호</dt>
            <dd className="cd-text">{cov.symbolsMissing || "없음(모두 있음)"}</dd>
          </dl>
        </section>

        {upload ? (
          <section className="flex flex-col gap-2">
            <h3 className="cd-text font-semibold text-base">표시 이름</h3>
            <div className="flex items-center gap-2">
              <input className="cd-input" style={{ maxWidth: 280 }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="표시 이름" />
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy || !name.trim() || name.trim() === font.displayName} onClick={() => void onPatch({ displayName: name.trim() })}>
                이름 저장
              </button>
              <span className="text-xs cd-text-faint">패밀리 {font.family}</span>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="cd-text font-semibold text-base">라이선스</h3>
          {lic ? (
            <dl className="rounded-lg border cd-border-c p-3 grid gap-x-3 gap-y-1.5 text-xs" style={{ gridTemplateColumns: "auto 1fr" }}>
              <dt className="cd-text-muted">종류</dt>
              <dd className="cd-text">{LICENSE_TYPES.find((t) => t.id === lic.type)?.label ?? lic.type}</dd>
              <dt className="cd-text-muted">출처</dt>
              <dd className="cd-text break-all">{lic.source || "—"}</dd>
              <dt className="cd-text-muted">허용 범위</dt>
              <dd className="cd-text">{lic.scope.map((x) => LICENSE_SCOPES.find((s) => s.id === x)?.label ?? x).join(" · ") || "—"}</dd>
              {lic.note ? (
                <>
                  <dt className="cd-text-muted">메모</dt>
                  <dd className="cd-text whitespace-pre-wrap">{lic.note}</dd>
                </>
              ) : null}
              {lic.confirmedAt ? (
                <>
                  <dt className="cd-text-muted">확인</dt>
                  <dd className="cd-text">
                    {font.uploadedByName || "—"} · {lic.confirmedAt.slice(0, 10)}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="text-xs cd-text-muted">라이선스 기록이 없습니다.</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="cd-text font-semibold text-base">파일</h3>
          <div className="overflow-x-auto">
            <table className="cd-table">
              <thead>
                <tr>
                  <th className="text-right">굵기</th>
                  <th>원본</th>
                  <th>PDF 용 파일</th>
                  <th className="text-right">한글 완성형</th>
                </tr>
              </thead>
              <tbody>
                {font.files.map((f) => (
                  <tr key={`${f.weight}-${f.style}`}>
                    <td className="text-right tabular-nums">
                      {f.weight}
                      {f.style === "italic" ? " 기울임" : ""}
                    </td>
                    <td className="cd-text">
                      {f.fileName}
                      <span className="block text-[11px] cd-text-faint">
                        {f.format.toUpperCase()} · {f.outline === "truetype" ? "TrueType 윤곽" : "CFF 윤곽"} · {mb(f.bytes)}
                      </span>
                    </td>
                    <td className="cd-text text-xs">
                      {upload ? `TrueType 윤곽 WOFF · ${mb(f.woffBytes)}` : `기본 서체 WOFF · ${mb(f.woffBytes)}`}
                      {f.converted ? <span className="block text-[11px] cd-text-faint">CFF → TrueType 로 바꿈</span> : null}
                      {f.fromVariable ? <span className="block text-[11px] cd-text-faint">가변 서체에서 굵기 고정</span> : null}
                    </td>
                    <td className="text-right tabular-nums">{f.hangul2350 != null ? f.hangul2350.toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <h3 className="cd-text font-semibold text-base">쓰는 곳</h3>
          <p className="text-xs cd-text">
            세트 {sets.length ? sets.map((id) => setNames[id] ?? id).join(", ") : "없음"} · 문서 {docs.length ? docs.map((d) => d.title).join(", ") : "없음"} · 이 서체로 만든 PDF {pdfs}건
          </p>
        </section>
      </div>
    </CdDrawer>
  );
}
