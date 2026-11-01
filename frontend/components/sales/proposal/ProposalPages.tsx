/*
 * 제안서 A4 미리보기 — HWPX 조판(lib/proposal/hwpx.ts)과 같은 디자인 토큰·지면 규격으로 그린다.
 * 편집 표식: data-block(블록 선택), data-edit="섹션|블록|경로"(더블클릭 글 고치기), data-page(쪽 넘침 검사).
 */
import type { CSSProperties, ReactNode } from "react";
import type { ProposalBlock, ProposalDocument, ProposalSection } from "@/lib/proposal/types";
import { optionsOf } from "@/lib/proposal/types";
import { BULLET, BULLET_HANG, BULLET_LEFT, FONT, LINE, NEUTRAL, PAGE, SPACE, TYPE, chaptersOf, mixWhite, paletteOf, parseRich, type ThemePalette } from "@/lib/proposal/design";
import { coverLines, dividerLines, physicalPages, tocEntries, type FlowLine } from "@/lib/proposal/layout";
import { materializeDocument } from "@/lib/proposal/materialize";
import { renderInfographic } from "@/lib/catalog/render/infographic/render";
import { renderDiagram } from "@/lib/proposal/diagrams/render";
import { CoverArt, DividerArt } from "@/lib/proposal/art";

const PT = 72 / 25.4;
const mm = (n: number) => n * PT;

export function proposalFrameCss(pal: ThemePalette): string {
  // 2.1: 구조는 그래파이트(--gs)·회색 면(--gp, --gp2), 테마 주색(--p1)은 포인트(장 배지·강조·번호·핵심 막대)에만.
  const v = `--p1:${pal.primary};--p2:${pal.primary2};--ac:${pal.accent};--t1:${pal.tint};--t2:${pal.tint2};--ln:${pal.line};--ink:${NEUTRAL.ink};--ink2:${NEUTRAL.ink2};--mu:${NEUTRAL.muted};--ru:${NEUTRAL.rule};--gs:${NEUTRAL.graphite};--st:${NEUTRAL.steel};--gl:${NEUTRAL.line};--gp:${NEUTRAL.panel};--gp2:${NEUTRAL.panel2}`;
  return `
body.pk-doc.st-frame{overflow:auto;background:#e6e8eb;margin:0}#st-root{padding:22px 0 40px}
.pp-root{${v};font-family:${FONT.css};color:var(--ink);zoom:var(--pp-zoom,1)}
.pp-page{position:relative;width:595.28px;height:841.89px;margin:0 auto 22px;background:#fff;box-shadow:0 1px 6px #1a1d2114;overflow:hidden;box-sizing:border-box}
.pp-page[data-overflow=true]{outline:2px solid #d9480f;outline-offset:2px}
.pp-page[data-current=true]{box-shadow:0 0 0 2px var(--p2),0 1px 6px #1a1d2114}
.pp-art{position:absolute;inset:0}
.pp-head{position:absolute;left:${mm(PAGE.left)}px;right:${mm(PAGE.right)}px;top:${mm(PAGE.top)}px;display:flex;align-items:stretch;height:17px;font-size:${TYPE.header}px}
.pp-head .no{background:var(--p1);color:#fff;font-weight:700;width:22px;display:flex;align-items:center;justify-content:center;border-bottom:1.4px solid var(--p1)}
.pp-head .ch{flex:1;color:var(--ink);font-weight:700;padding:0 8px;display:flex;align-items:center;border-bottom:1.4px solid var(--gs)}
.pp-head .cr{color:var(--mu);display:flex;align-items:center;justify-content:flex-end;width:200px;border-bottom:.5px solid var(--gl);font-size:8.5px}
.pp-foot{position:absolute;left:${mm(PAGE.left)}px;right:${mm(PAGE.right)}px;bottom:${mm(PAGE.bottom)}px;display:flex;border-top:.5px solid var(--gl);padding-top:4px;font-size:${TYPE.footer}px;color:var(--mu)}
.pp-foot span{flex:1}.pp-foot .pg{text-align:center;color:var(--ink2);font-weight:600}.pp-foot .co{text-align:right;color:var(--ink);font-weight:700}
.pp-body{position:absolute;left:${mm(PAGE.left)}px;top:${mm(PAGE.top + PAGE.header)}px;width:${mm(PAGE.width - PAGE.left - PAGE.right)}px;height:${mm(PAGE.height - PAGE.top - PAGE.header - PAGE.bottom - PAGE.footer)}px}
.pp-flow{display:flow-root}
.pp-b{position:relative;border-radius:2px}
.pp-b[data-sel=true]{outline:1.5px solid var(--p2);outline-offset:2px;background:color-mix(in srgb,var(--t1) 35%,transparent)}
[data-edit]{cursor:text}[data-edit]:hover{box-shadow:inset 0 -1px 0 var(--gl)}[data-edit][contenteditable=true]{outline:1.5px dashed var(--ac);background:#fffbe6}
.pp-ptitle{font-size:${TYPE.pageTitle}px;font-weight:700;color:var(--ink);line-height:1.38;margin:2px 0 ${SPACE.titleAfter}px;word-break:keep-all;letter-spacing:-.2px}
.pp-lead{background:var(--gp);border-left:3px solid var(--p1);padding:9px 12px;margin:0 0 ${SPACE.leadAfter}px;font-size:${TYPE.lead}px;font-weight:700;color:var(--ink);line-height:1.55;word-break:keep-all}
.pp-lead .lb{display:inline-block;font-size:8px;font-weight:700;color:#fff;background:var(--p1);padding:1px 5px;margin-right:6px;vertical-align:2px}
.pp-h1{font-size:${TYPE.h1}px;font-weight:700;color:var(--ink);margin:${SPACE.h1[0]}px 0 ${SPACE.h1[1]}px;padding-bottom:4px;border-bottom:1.2px solid var(--gs);word-break:keep-all}
.pp-h2{font-size:${TYPE.h2}px;font-weight:700;color:var(--ink);margin:${SPACE.h2[0]}px 0 ${SPACE.h2[1]}px;padding-left:8px;border-left:3px solid var(--p1);line-height:1.3;word-break:keep-all}
.pp-h3{font-size:${TYPE.h3}px;font-weight:700;color:var(--ink);margin:${SPACE.h3[0]}px 0 ${SPACE.h3[1]}px;word-break:keep-all}.pp-h3::before{content:"□";color:var(--p1);margin-right:4px}
.pp-p{font-size:${TYPE.body}px;line-height:${LINE.body / 100};margin:0 0 ${SPACE.text}px;text-align:justify;word-break:keep-all;white-space:pre-wrap}
.pp-em{color:var(--p1);font-weight:700}
.pp-ul{margin:0 0 ${SPACE.text}px}
.pp-li{line-height:${LINE.body / 100};margin:0 0 ${SPACE.bullet}px;word-break:keep-all;text-align:justify;white-space:pre-wrap}
.pp-li .mk{white-space:pre}
.pp-li.l1{font-size:${TYPE.body}px}.pp-li.l1 .mk{color:var(--p1);font-weight:700}
.pp-li.l2{font-size:${TYPE.bullet2}px;color:var(--ink2)}.pp-li.l3{font-size:${TYPE.bullet3}px;color:var(--ink2)}
.pp-li.note{font-size:${TYPE.note}px;color:var(--mu)}
.pp-li.result{color:var(--ink);font-weight:700}.pp-li.result .mk{color:var(--p1)}
.pp-li.check .mk{color:var(--p1);font-weight:700}
.pp-call{padding:10px 12px;margin:4px 0 ${SPACE.block}px;font-size:${TYPE.callout}px;line-height:1.65;word-break:keep-all}
.pp-call.note{background:var(--gp2);border:.5px solid var(--gl)}.pp-call.point{background:var(--gp2);border-top:1.6px solid var(--p1)}
.pp-call .tt{display:block;font-weight:700;font-size:${TYPE.callout - 1}px;margin-bottom:3px;color:var(--ink2)}.pp-call.point .tt{color:var(--p1)}
.pp-stage{display:flex;margin:10px 0 11px;font-size:${TYPE.stage}px;font-weight:700}.pp-stage .lb{background:var(--p1);color:#fff;padding:7px 11px;white-space:nowrap}.pp-stage .tx{flex:1;background:var(--gp);color:var(--ink);padding:7px 11px}
.pp-cards{display:grid;gap:8px;margin:4px 0 ${SPACE.block - 2}px}
.pp-card{background:var(--gp2);border-top:1.8px solid var(--gs);padding:${SPACE.cardPad - 1}px ${SPACE.cardPad}px ${SPACE.cardPad}px}.pp-card.key{border-top-color:var(--p1)}
.pp-card .no{font-size:9px;font-weight:700;color:var(--p1)}.pp-card .ti{font-size:${TYPE.cardTitle}px;font-weight:700;color:var(--ink);margin:2px 0 4px;line-height:1.35;word-break:keep-all}
.pp-card .bd{font-size:${TYPE.cardBody}px;line-height:1.62;color:var(--ink2);white-space:pre-wrap;word-break:keep-all}
.pp-steps{display:flex;align-items:stretch;margin:4px 0 ${SPACE.block}px}
.pp-step{flex:1;display:flex;flex-direction:column;min-width:0}.pp-step .hd{background:var(--gs);color:#fff;font-weight:700;font-size:${TYPE.stepTitle}px;padding:${SPACE.stepPad}px ${SPACE.stepPad + 1}px;line-height:1.35;word-break:keep-all}
.pp-step .hd b{color:#B9BEC5;margin-right:4px;font-size:${TYPE.stepTitle - 1}px}.pp-step .bd{flex:1;background:var(--gp2);font-size:${TYPE.stepBody}px;line-height:1.62;color:var(--ink2);padding:${SPACE.stepPad}px ${SPACE.stepPad + 1}px;white-space:pre-wrap;word-break:keep-all}
.pp-arrow{width:14px;display:flex;align-items:flex-start;justify-content:center;color:var(--st);font-size:9px;padding-top:7px}
.pp-kpis{display:flex;gap:9px;margin:4px 0 ${SPACE.block - 2}px}.pp-kpi{flex:1;border-top:1.8px solid var(--gs);padding:6px 4px 3px;text-align:center}
.pp-kpi .v{font-size:${TYPE.kpi}px;font-weight:700;color:var(--p1);line-height:1.15}.pp-kpi .u{font-size:10px;font-weight:600;margin-left:2px;color:var(--ink2)}.pp-kpi .l{font-size:${TYPE.kpiLabel}px;color:var(--mu);margin-top:2px}
.pp-ttl{font-size:${TYPE.tableTitle}px;font-weight:700;color:var(--ink);margin:11px 0 5px}.pp-ttl::before{content:"■";color:var(--p1);font-size:7px;margin-right:4px;vertical-align:1px}
.pp-t{width:100%;border-collapse:collapse;table-layout:fixed;font-size:${TYPE.table}px;line-height:${LINE.table / 100};margin:0 0 3px}
.pp-t th,.pp-t td{padding:${SPACE.cellY}px ${SPACE.cellX}px;vertical-align:middle;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;text-align:left}
.pp-t th{font-weight:700;text-align:center}
.pp-t--grid th{background:var(--gs);color:#fff;border:.5px solid var(--gs)}.pp-t--grid td{border:.5px solid var(--ru)}
.pp-t--clean{border-top:1.2px solid var(--gs);border-bottom:1.2px solid var(--gs)}.pp-t--clean th{background:var(--gp);color:var(--ink);border-bottom:.5px solid var(--gl)}.pp-t--clean td{border-bottom:.4px solid var(--ru)}
.pp-t--form{border-top:1.2px solid var(--gs)}.pp-t--form th,.pp-t--form td{border:.5px solid var(--ru)}.pp-t--form th{background:var(--gp);color:var(--ink)}
.pp-t td.fc{background:var(--gp);font-weight:700;color:var(--ink);text-align:center}
.pp-tnote{font-size:8.8px;color:var(--mu);margin:3px 0 ${SPACE.block}px}
.pp-gantt{width:100%;border-collapse:collapse;table-layout:fixed;font-size:${TYPE.gantt}px;line-height:1.35;margin:0 0 3px}
.pp-gantt th{background:var(--gs);color:#fff;font-weight:700;border:.5px solid #fff;padding:4px 1px;text-align:center}
.pp-gantt td{border:.4px solid var(--ru);padding:3px 4px;height:13px;word-break:keep-all}.pp-gantt td.gr{background:var(--gp);color:var(--ink);font-weight:700;border-top-color:var(--ru)}.pp-gantt td.gr.cont{border-top-color:transparent;color:transparent}
.pp-gantt td.c{padding:0;text-align:center;color:#fff;font-size:7px}.pp-gantt td.work{background:var(--st)}.pp-gantt td.report{background:var(--ac)}.pp-gantt td.key{background:var(--p1)}
.pp-gantt td.mk{color:var(--p1);font-size:8px}
.pp-legend{display:flex;gap:10px;font-size:8px;color:var(--mu);margin:2px 0 10px}.pp-legend i{display:inline-block;width:9px;height:7px;margin-right:3px;vertical-align:-1px}
.pp-fig{margin:10px auto 4px;display:flex;justify-content:center}
.pp-fig .box{overflow:hidden;background:#fff}
.pp-cap{text-align:center;font-size:${TYPE.caption}px;color:var(--mu);margin:4px 0 ${SPACE.block}px}
.pp-img{display:block;object-fit:contain}
.pp-toc{padding-top:6px}.pp-toc .eb{font-size:9px;letter-spacing:3px;color:var(--p1);font-weight:700}.pp-toc h2{font-size:22px;color:var(--ink);margin:2px 0 20px;letter-spacing:6px}
.pp-toc .ch{display:flex;align-items:center;margin:16px 0 5px;border-bottom:1.2px solid var(--gs);padding-bottom:5px}
.pp-toc .ch .no{background:var(--p1);color:#fff;font-weight:700;font-size:11px;width:24px;height:20px;display:flex;align-items:center;justify-content:center;margin-right:8px}
.pp-toc .ch .lb{flex:1;font-size:12.5px;font-weight:700;color:var(--ink)}.pp-toc .pg{font-size:10.5px;font-weight:700;color:var(--ink);width:30px;text-align:right}
.pp-toc .se{display:flex;margin-left:32px;padding:5px 0;border-bottom:.4px dotted var(--gl);font-size:10.5px;color:var(--ink2)}.pp-toc .se .lb{flex:1}.pp-toc .se .pg{color:var(--mu);font-weight:400}
`;
}

const Rich = ({ text }: { text: string }) => <>{parseRich(text).map((r, i) => (r.strong ? <b key={i} className="pp-em">{r.text}</b> : <span key={i}>{r.text}</span>))}</>;

function colWidths(b: Extract<ProposalBlock, { kind: "table" }>): number[] {
  if (b.widths?.length === b.columns.length && b.widths.every((x) => x > 0)) {
    const s = b.widths.reduce((a, c) => a + c, 0);
    return b.widths.map((x) => (x / s) * 100);
  }
  const weights = b.columns.map((c, i) => {
    const lens = b.rows.map((r) => (r[i] || "").length);
    const mean = lens.reduce((a, c2) => a + c2, 0) / Math.max(1, lens.length);
    return Math.max(6, Math.min(30, Math.max(c.length * 1.2, mean)));
  });
  const s = weights.reduce((a, c) => a + c, 0);
  return weights.map((x) => (x / s) * 100);
}
export { colWidths as proposalColWidths };

/** 카드·단계 항목 색 — 직접 지정 > 다색 팔레트 > 없음(회색 기본) */
const stepColor = (b: { multi?: boolean }, it: { color?: string }, i: number, pal: ThemePalette) => it.color ?? (b.multi ? pal.series?.[i % 6] : undefined);

interface Ctx { sid: string; pal: ThemePalette; figNo: Map<string, number>; selected?: string }
const ed = (ctx: Ctx, bid: string, path: string) => ({ "data-edit": `${ctx.sid}|${bid}|${path}` });

function Block({ b, ctx }: { b: ProposalBlock; ctx: Ctx }): ReactNode {
  const E = (path: string) => ed(ctx, b.id, path);
  switch (b.kind) {
    case "heading": {
      const C = b.level === 1 ? "pp-h1" : b.level === 2 ? "pp-h2" : "pp-h3";
      return <div className={C} {...E("text")}>{b.text}</div>;
    }
    case "text":
      return <p className="pp-p" {...E("text")}><Rich text={b.text} /></p>;
    case "bullets":
      return (
        <div className="pp-ul">
          {b.items.map((it, i) => {
            const mk = it.mark ? BULLET[it.mark] : BULLET[it.level];
            return (
              <div key={i} className={`pp-li l${it.level} ${it.mark ?? ""}`} style={{ paddingLeft: BULLET_LEFT[it.level], textIndent: -(BULLET_HANG[mk] ?? 10) }}>
                <span className="mk">{mk} </span><span {...E(`items.${i}.text`)}><Rich text={it.text} /></span>
              </div>
            );
          })}
        </div>
      );
    case "lead":
      return <div className="pp-lead">{b.label ? <span className="lb" {...E("label")}>{b.label}</span> : null}<span {...E("text")}><Rich text={b.text} /></span></div>;
    case "callout":
      return <div className={`pp-call ${b.variant}`}><span className="tt" {...E("title")}>{b.title}</span><span {...E("text")} style={{ whiteSpace: "pre-wrap" }}><Rich text={b.text} /></span></div>;
    case "stage":
      return <div className="pp-stage"><span className="lb" {...E("label")}>{b.label}</span><span className="tx" {...E("text")}>{b.text}</span></div>;
    case "cards":
      return (
        <div className="pp-cards" style={{ gridTemplateColumns: `repeat(${b.columns},minmax(0,1fr))` }}>
          {b.items.map((it, i) => {
            const c = stepColor(b, it, i, ctx.pal);
            return (
            <div key={i} className={`pp-card${it.key ? " key" : ""}`} style={c ? { borderTopColor: c, background: mixWhite(c, 0.93) } : undefined}>
              {b.numbered ? <div className="no" style={c ? { color: c } : undefined}>{String(i + 1).padStart(2, "0")}</div> : null}
              <div className="ti" {...E(`items.${i}.title`)}>{it.title}</div>
              <div className="bd" {...E(`items.${i}.body`)}><Rich text={it.body} /></div>
            </div>
            );
          })}
        </div>
      );
    case "steps":
      return (
        <div className="pp-steps">
          {b.items.flatMap((it, i) => {
            const c = stepColor(b, it, i, ctx.pal);
            return [
              ...(i ? [<div key={`a${i}`} className="pp-arrow">▶</div>] : []),
              <div key={i} className="pp-step">
                <div className="hd" style={c ? { background: c } : undefined}><b>{String(i + 1).padStart(2, "0")}</b><span {...E(`items.${i}.title`)}>{it.title}</span></div>
                <div className="bd" style={c ? { background: mixWhite(c, 0.93) } : undefined} {...E(`items.${i}.body`)}><Rich text={it.body} /></div>
              </div>,
            ];
          })}
        </div>
      );
    case "kpis":
      return (
        <div className="pp-kpis">
          {b.items.map((it, i) => (
            <div key={i} className="pp-kpi">
              <div><span className="v" {...E(`items.${i}.value`)}>{it.value}</span>{it.unit ? <span className="u" {...E(`items.${i}.unit`)}>{it.unit}</span> : null}</div>
              <div className="l" {...E(`items.${i}.label`)}>{it.label}</div>
            </div>
          ))}
        </div>
      );
    case "table": {
      const widths = colWidths(b);
      return (
        <div>
          {b.title ? <div className="pp-ttl" {...E("title")}>{b.title}</div> : null}
          <table className={`pp-t pp-t--${b.style}`}>
            <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
            <thead><tr>{b.columns.map((c, i) => <th key={i} {...E(`columns.${i}`)}>{c}</th>)}</tr></thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{b.columns.map((_, ci) => <td key={ci} className={ci === 0 && (b.firstCol || b.style === "form") ? "fc" : undefined} {...E(`rows.${ri}.${ci}`)}><Rich text={r[ci] || ""} /></td>)}</tr>
              ))}
            </tbody>
          </table>
          {b.note ? <div className="pp-tnote" {...E("note")}>{b.note}</div> : <div style={{ height: SPACE.block }} />}
        </div>
      );
    }
    case "gantt": {
      const hasGroup = b.tasks.some((t) => t.group);
      const n = b.periods.length;
      const restW = 100 - (hasGroup ? 15 : 0) - 27;
      return (
        <div>
          {b.title ? <div className="pp-ttl" {...E("title")}>{b.title}</div> : null}
          <table className="pp-gantt">
            <colgroup>{hasGroup ? <col style={{ width: "15%" }} /> : null}<col style={{ width: "27%" }} />{b.periods.map((_, i) => <col key={i} style={{ width: `${restW / n}%` }} />)}</colgroup>
            <thead><tr>{hasGroup ? <th>구분</th> : null}<th>세부 과업</th>{b.periods.map((p, i) => <th key={i} {...E(`periods.${i}`)}>{p}</th>)}</tr></thead>
            <tbody>
              {b.tasks.map((t, ri) => {
                const cont = ri > 0 && (t.group || "") === (b.tasks[ri - 1].group || "");
                return (
                  <tr key={ri}>
                    {hasGroup ? <td className={`gr${cont ? " cont" : ""}`} {...E(`tasks.${ri}.group`)}>{t.group}</td> : null}
                    <td {...E(`tasks.${ri}.label`)}>{t.label}</td>
                    {b.periods.map((_, pi) => {
                      const on = pi >= t.start && pi <= t.end;
                      const mark = t.marks?.includes(pi);
                      return <td key={pi} className={`c${on ? ` ${t.tone ?? "work"}` : ""}${mark && !on ? " mk" : ""}`}>{mark ? "●" : ""}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="pp-legend"><span><i style={{ background: "var(--st)" }} />수행</span><span><i style={{ background: "var(--p1)" }} />핵심 과업</span><span><i style={{ background: "var(--ac)" }} />보고·제출</span><span style={{ color: "var(--p1)" }}>● 보고회·협의</span>{b.note ? <span {...E("note")}>{b.note}</span> : null}</div>
        </div>
      );
    }
    case "figure":
    case "diagram":
    case "image": {
      const w = mm(b.widthMm), h = mm(b.heightMm);
      const no = ctx.figNo.get(b.id);
      const brandVars = { "--brand": ctx.pal.primary, "--brand-tint": ctx.pal.tint, "--area": ctx.pal.primary2, "--area-mid": ctx.pal.line, "--area-tint": ctx.pal.tint2, "--accent-2": ctx.pal.primary2 } as CSSProperties;
      return (
        <div>
          <div className="pp-fig">
            {b.kind === "image" ? <img className="pp-img" src={b.dataUrl} alt={b.title} style={{ width: w, height: h }} />
              : <div className={`box${b.kind === "figure" ? " kc-board" : ""}`} data-proposal-figure={b.id} style={{ width: w, height: h, padding: b.kind === "figure" ? 8 : 0, boxSizing: "border-box", ...brandVars }}>
                {b.kind === "figure" ? renderInfographic(b.spec, { w: w - 16, h: h - 16 }) : renderDiagram(b.spec, { w, h }, ctx.pal)}
              </div>}
          </div>
          {b.title ? <div className="pp-cap">{no ? `그림 ${no}. ` : ""}<span {...E("title")}>{b.title}</span></div> : null}
        </div>
      );
    }
  }
}

/** 표지·간지 글줄 — HWPX 의 문단(앞 간격·줄 간격 130%)과 같은 흐름 배치 */
function FlowLines({ lines, pal }: { lines: FlowLine[]; pal: ThemePalette }) {
  const color = { p1: pal.primary, ink: NEUTRAL.ink, ink2: NEUTRAL.ink2, mu: NEUTRAL.muted, white: "#FFFFFF", tint: pal.tint } as const;
  return <>{lines.map((l) => <div key={l.key} style={{ marginTop: l.before, fontSize: l.size, fontWeight: l.bold ? 700 : 400, color: color[l.tone], lineHeight: 1.3, textAlign: l.align ?? "left", paddingRight: l.inset ?? 0, paddingLeft: l.align === "center" ? l.inset ?? 0 : 0, wordBreak: "keep-all", whiteSpace: "pre-wrap" }}>{l.text}</div>)}</>;
}

function Head({ roman, chapter, crumb }: { roman?: string; chapter?: string; crumb?: string }) {
  return <div className="pp-head"><span className="no">{roman ?? ""}</span><span className="ch">{chapter ?? ""}</span><span className="cr">{crumb ?? ""}</span></div>;
}
function Foot({ doc, pageNo }: { doc: ProposalDocument; pageNo: number }) {
  return <div className="pp-foot"><span>{doc.projectName}</span><span className="pg">- {pageNo} -</span><span className="co">{doc.variables?.companyName || ""}</span></div>;
}

export function ProposalPages({ document: source, selectedBlock, currentSection }: { document: ProposalDocument; selectedBlock?: string; currentSection?: string }) {
  const doc = materializeDocument(source);
  const pal = paletteOf(doc);
  const opts = optionsOf(doc);
  const chapters = chaptersOf(doc);
  const figNo = new Map<string, number>();
  doc.sections.flatMap((s) => s.blocks).filter((b) => (b.kind === "figure" || b.kind === "diagram" || b.kind === "image") && b.title).forEach((b, i) => figNo.set(b.id, i + 1));
  const toc = tocEntries(doc);
  return (
    <div className="pp-root">
      {physicalPages(doc).map((p, idx) => {
        if (p.kind === "cover") {
          return (
            <article key="cover" className="pp-page" data-page="cover">
              <div className="pp-art"><CoverArt pal={pal} variant={opts.cover} /></div>
              <div className="pp-body"><FlowLines lines={coverLines(doc)} pal={pal} /></div>
            </article>
          );
        }
        if (p.kind === "toc") {
          return (
            <article key="toc" className="pp-page" data-page="toc">
              <div className="pp-body pp-toc">
                <div className="eb">CONTENTS</div>
                <h2>목 차</h2>
                {toc.map((e, i) => e.level === 1
                  ? <div key={i} className="ch"><span className="no">{e.roman}</span><span className="lb">{e.label}</span><span className="pg">{e.pageNo}</span></div>
                  : <div key={i} className="se"><span className="lb">{e.label}</span><span className="pg">{e.pageNo}</span></div>)}
              </div>
            </article>
          );
        }
        if (p.kind === "divider") {
          const c = chapters[p.chapter];
          const crumbs = [...new Set(doc.sections.filter((s) => s.chapter?.trim() === c.name).map((s) => s.crumb?.trim()).filter(Boolean))];
          return (
            <article key={`d${idx}`} className="pp-page" data-page={`divider-${p.chapter}`}>
              <div className="pp-art"><DividerArt pal={pal} /></div>
              <div className="pp-body"><FlowLines lines={dividerLines(c.roman, c.name, crumbs as string[])} pal={pal} /></div>
            </article>
          );
        }
        const s: ProposalSection = doc.sections[p.section];
        const ctx: Ctx = { sid: s.id, pal, figNo, selected: selectedBlock };
        return (
          <article key={s.id} className="pp-page" data-page={s.id} data-section={s.id} data-current={currentSection === s.id ? "true" : undefined}>
            <Head roman={p.chapter >= 0 ? chapters[p.chapter].roman : undefined} chapter={s.chapter} crumb={s.crumb} />
            <div className="pp-body"><div className="pp-flow" data-flow={s.id}>
              {s.title ? <div className="pp-ptitle" {...ed(ctx, "_page", "title")}>{s.title}</div> : null}
              {s.summary ? <div className="pp-lead" {...ed(ctx, "_page", "summary")}><Rich text={s.summary} /></div> : null}
              {s.blocks.map((b) => <div key={b.id} className="pp-b" data-block={b.id} data-sel={selectedBlock === b.id ? "true" : undefined}><Block b={b} ctx={ctx} /></div>)}
            </div></div>
            <Foot doc={doc} pageNo={p.pageNo} />
          </article>
        );
      })}
    </div>
  );
}
