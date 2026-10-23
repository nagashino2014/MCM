"use client";

// 서체 세트 만들기·고치기(블루프린트 §5-2·5-4) — 제목·본문·숫자 서체 + 굵기 대응(디자인 시스템 굵기 400·500·600·700 → 파일 굵기).
// 고르기 규칙은 서버와 같은 함수(checkFontSetChoice): 본문에 '제목 전용' 서체·가는(Light) 본문은 막고, 명조 본문·tnum 없음은 알린다.
// 아래 미리보기는 저장될 세트와 같은 @font-face(역할 별칭·크기 보정)로 그린다. 적용은 스튜디오 서체 탭에서 한다.

import { useEffect, useMemo, useState } from "react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { buildCustomFontSet, checkFontSetChoice, defaultRoleWeights } from "@/lib/catalog/fonts";
import { CSS_WEIGHTS, FONT_ROLES, FONT_ROLE_LABEL, type CatalogFont, type CatalogFontSet, type FontRole, type WeightMap } from "@/lib/catalog/font-types";
import { Paper, SPECIMEN, useLoadedFaces } from "./specimen";

const PREVIEW_ID = "u-preview0";

export function FontSetEditor({
  open,
  initial,
  fonts,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  /** 고칠 세트(없으면 새 세트) */
  initial: CatalogFontSet | null;
  fonts: CatalogFont[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: { setId: string | null; name: string; displayFontId: string; bodyFontId: string; figureFontId: string; weightMap: WeightMap }) => Promise<boolean>;
}) {
  const byId = useMemo(() => new Map(fonts.map((f) => [f.fontId, f])), [fonts]);
  const [name, setName] = useState("");
  const [ids, setIds] = useState<Record<FontRole, string>>({ display: "b-pretendard", body: "b-pretendard", figure: "b-pretendard" });
  const [weightMap, setWeightMap] = useState<WeightMap>({ display: {}, body: {}, figure: {} });

  const weightsOf = (f: CatalogFont | undefined) => (f?.files ?? []).filter((x) => x.style === "normal").map((x) => x.weight);
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setIds({ display: initial.displayFontId, body: initial.bodyFontId, figure: initial.figureFontId });
      setWeightMap(initial.weightMap);
    } else {
      setName("");
      setIds({ display: "b-pretendard", body: "b-pretendard", figure: "b-pretendard" });
      const w = defaultRoleWeights(weightsOf(byId.get("b-pretendard")));
      setWeightMap({ display: { ...w }, body: { ...w }, figure: { ...w } });
    }
    // 열 때만 초기화한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const chosen = { display: byId.get(ids.display), body: byId.get(ids.body), figure: byId.get(ids.figure) } as Record<FontRole, CatalogFont | undefined>;
  const check = checkFontSetChoice(chosen, weightMap);
  const preview = useMemo(
    () =>
      buildCustomFontSet({ setId: PREVIEW_ID, name: "미리보기", displayFontId: ids.display, bodyFontId: ids.body, figureFontId: ids.figure, weightMap, orderNo: 0, updatedAt: "" }, byId),
    [ids, weightMap, byId]
  );
  const faces = useMemo(() => preview.faces.filter((f) => f.family.startsWith(`kcs-${PREVIEW_ID}`)), [preview]);
  const { css } = useLoadedFaces(faces);

  const pickFont = (role: FontRole, id: string) => {
    setIds({ ...ids, [role]: id });
    setWeightMap({ ...weightMap, [role]: defaultRoleWeights(weightsOf(byId.get(id))) });
  };
  // 고를 수 있는 서체 — 비활성 서체는 이미 이 세트에 있던 것만 보인다
  const options = (role: FontRole) =>
    fonts.filter((f) => f.isActive || (initial && [initial.displayFontId, initial.bodyFontId, initial.figureFontId][FONT_ROLES.indexOf(role)] === f.fontId));
  const reasonFor = (role: FontRole, f: CatalogFont) => {
    if (f.roles.includes(role)) return "";
    if (role === "body") return " (제목 전용)";
    if (role === "figure") return " (숫자 없음)";
    return " (쓸 수 없음)";
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title={initial ? `서체 세트 고치기 — ${initial.name}` : "새 서체 세트"}
      size="xl"
      footer={
        <>
          {check.errors.length ? (
            <span className="text-xs cd-error-text mr-auto">{check.errors[0]}</span>
          ) : !name.trim() ? (
            <span className="text-xs cd-text-muted mr-auto">세트 이름을 적으세요.</span>
          ) : null}
          <button type="button" className="cd-btn cd-btn-ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary"
            disabled={busy || !name.trim() || check.errors.length > 0}
            onClick={async () => {
              if (await onSave({ setId: initial?.setId ?? null, name: name.trim(), displayFontId: ids.display, bodyFontId: ids.body, figureFontId: ids.figure, weightMap })) onClose();
            }}
          >
            저장
          </button>
        </>
      }
    >
      <style>{`${css}\n${preview.css ?? ""}`}</style>
      <div className="p-4 flex flex-col gap-4 text-sm">
        <label className="flex items-center gap-2 text-xs">
          세트 이름
          <input className="cd-input" style={{ maxWidth: 280 }} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="예: 나눔고딕 본문 + 명조 제목" />
        </label>

        <section className="flex flex-col gap-2">
          <h3 className="cd-text font-semibold text-base flex items-center gap-1">
            역할별 서체와 굵기 대응 <CdHelp topic="catalog.fonts-sets" />
          </h3>
          <div className="overflow-x-auto">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>역할</th>
                  <th>서체</th>
                  {CSS_WEIGHTS.map((w) => (
                    <th key={w} className="text-right">
                      굵기 {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FONT_ROLES.map((role) => {
                  const f = chosen[role];
                  const ws = weightsOf(f);
                  return (
                    <tr key={role}>
                      <td className="cd-text">{FONT_ROLE_LABEL[role]}</td>
                      <td>
                        <select className="cd-select" style={{ minWidth: 200 }} value={ids[role]} onChange={(e) => pickFont(role, e.target.value)} aria-label={`${FONT_ROLE_LABEL[role]} 서체`}>
                          {options(role).map((x) => (
                            <option key={x.fontId} value={x.fontId} disabled={!x.roles.includes(role)}>
                              {x.displayName}
                              {x.source === "bundled" ? " (기본)" : ""}
                              {reasonFor(role, x)}
                              {x.isActive ? "" : " (비활성)"}
                            </option>
                          ))}
                        </select>
                      </td>
                      {CSS_WEIGHTS.map((w) => (
                        <td key={w} className="text-right">
                          <select
                            className="cd-select tabular-nums"
                            style={{ width: 84 }}
                            value={String(weightMap[role]?.[String(w)] ?? "")}
                            onChange={(e) => setWeightMap({ ...weightMap, [role]: { ...weightMap[role], [String(w)]: Number(e.target.value) } })}
                            aria-label={`${FONT_ROLE_LABEL[role]} 굵기 ${w} 에 쓸 파일`}
                          >
                            {ws.map((x) => (
                              <option key={x} value={x}>
                                {x}
                              </option>
                            ))}
                          </select>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {check.errors.length ? (
            <ul className="text-xs cd-error-text list-disc pl-4" role="alert">
              {check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {check.warnings.length ? (
            <ul className="text-xs cd-text-muted list-disc pl-4">
              {check.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="cd-text font-semibold text-base">미리보기</h3>
          <Paper className={`p-4 kc-fontset--${PREVIEW_ID}`}>
            <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
              <div className="flex flex-col gap-2">
                <span style={{ fontFamily: "var(--kc-font-display)", fontSize: 24, lineHeight: "32px", fontWeight: 700, letterSpacing: "-0.4px" }}>{SPECIMEN.title}</span>
                <span style={{ fontFamily: "var(--kc-font-display)", fontSize: 15, lineHeight: "22px", fontWeight: 700 }}>수행 절차와 사후관리</span>
                <p style={{ fontFamily: "var(--kc-font-body)", fontSize: 12, lineHeight: "19px", fontWeight: 400, margin: 0 }}>{SPECIMEN.body}</p>
                <span style={{ fontFamily: "var(--kc-font-body)", fontSize: 11, lineHeight: "16px", fontWeight: 600, color: "#5b6475" }}>라벨 · 굵기 600</span>
              </div>
              <div className="flex flex-col gap-1">
                <span style={{ fontFamily: "var(--kc-font-figure)", fontSize: 36, lineHeight: "40px", fontWeight: 700, letterSpacing: "-0.8px", fontVariantNumeric: "tabular-nums" }}>{SPECIMEN.figure}</span>
                <span style={{ fontFamily: "var(--kc-font-body)", fontSize: 11, color: "#5b6475" }}>허가 사업장 수(큰 숫자 · 숫자 서체)</span>
                <table style={{ fontSize: 11, lineHeight: "16px", borderCollapse: "collapse", marginTop: 8 }}>
                  <tbody>
                    {SPECIMEN.table.slice(1).map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #d9dee8" }}>
                        <td style={{ fontFamily: "var(--kc-font-body)", padding: "4px 6px" }}>{row[0]}</td>
                        <td style={{ fontFamily: "var(--kc-font-figure)", padding: "4px 6px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row[1]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Paper>
          <p className="text-xs cd-text-muted">저장한 세트는 스튜디오 서체 탭에서 실제 쪽으로 비교하고 적용합니다(적용하면 전체 쪽 넘침·빠진 글자를 검사합니다).</p>
        </section>
      </div>
    </CdModal>
  );
}
