/*
 * 회사소개서 부록 — A01 수행실적 총괄(분야 × 기간 × 권역) · A02 분야별 수행실적 목록(표시 범위 규칙 적용, 자동 분쪽).
 * A02 는 분야마다 흐름 쪽 하나 — paginate 가 행 단위로 쪽을 나누고 머리 행·연도 띠를 반복하며 '(계속)'을 붙인다.
 */
import { canonicalServiceSubtype } from "@/lib/ieps/integrated-permit";
import { PERMIT_COHORTS, REGION_UNKNOWN } from "@/lib/catalog/regions";
import type { AppendixListRow, AppendixSection } from "@/lib/catalog/appendix";
import type { AreaInfo, CatalogRenderData, RenderCtx } from "../types";
import { KoreaMap } from "./infographics";
import { AreaTag, Foot, Head, Notes, Sheet, asOfNote, cx, fmt, mval } from "./parts";

// ── A01 수행실적 총괄 ──
export function SummaryPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const hasUnknown = data.matrix.some((sec) => sec.rows.some((r) => (r.byRegion[REGION_UNKNOWN.id] ?? 0) > 0));
  const cols = [...data.regionColumns, ...(hasUnknown ? [{ id: REGION_UNKNOWN.id, label: REGION_UNKNOWN.label }] : [])];
  const permitTotal = data.matrix[0]?.rows.find((r) => r.isTotal)?.total ?? 0;
  const ip = data.initialPermit;
  const totalDenom = data.figures["permit.sites.total"];
  const cohorts = [
    ...PERMIT_COHORTS.map((c) => ({ label: c.label.replace("차년도 ", "차 "), sites: ip.byCohort.find((b) => b.id === c.id)?.sites ?? 0, denom: data.figures[`permit.sites.${c.id}`] })),
    ...(ip.byCohort.find((b) => b.id === "unknown")?.sites ? [{ label: "업종 미판정", sites: ip.byCohort.find((b) => b.id === "unknown")!.sites, denom: undefined as number | undefined }] : []),
  ];
  const pct = (a: number, b?: number) => (b ? `${fmt(Math.round((a / b) * 1000) / 10)}%` : "-");
  return (
    <Sheet ctx={ctx} anchors={["sec-app", "a01"]} section="부록 수행실적·인력" outline="부록 A 수행실적 총괄" style={{ gap: 12 }}>
      <Head ctx={ctx} num="부록 A" name="수행실적 총괄" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <p className="kc-page-title" style={{ fontSize: 20, lineHeight: "28px" }}>
          수행실적 총괄 · 분야 × 기간 × 권역
        </p>
        <span className="kc-unit">
          단위: 건(계약 기준), {data.asOf.slice(0, 4)}.{Number(data.asOf.slice(5, 7))} 기준
        </span>
      </div>
      <div className="kc-grid" style={{ flex: 1, minHeight: 0 }}>
        <div className="kc-span-8" data-widget="table">
          <table className="kc-table kc-table--dense">
            <thead>
              <tr>
                <th>구분</th>
                <th>기간</th>
                <th className="n is-key">계</th>
                {cols.map((c) => (
                  <th key={c.id} className="n">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((sec) => (
                <MatrixRows key={sec.category} sec={sec} cols={cols.map((c) => c.id)} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="kc-span-4 kc-area-1" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="kc-blockhead" style={{ marginBottom: 0 }}>
            {data.areas[0].name} 권역별 분포<span className="kc-blockhead__aside">{fmt(permitTotal)}건</span>
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <KoreaMap mode="regions" area={1} values={data.permitByRegion} zoom={0.6} frame={{ width: 100, height: 179 }} root={{ "data-widget": "map" }} />
            <div className="kc-maplegend" style={{ flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
              <span>많음</span>
              <i style={{ opacity: 1 }}></i>
              <i style={{ opacity: 0.6 }}></i>
              <i style={{ opacity: 0.3 }}></i>
              <span>적음</span>
            </div>
          </div>
          <p className="kc-blockhead" style={{ margin: "2px 0 0" }}>
            <span>
              최초허가 <span data-metric="permit.initial.completed">{fmt(mval(data, "permit.initial.completed"))}</span>건 · 적용 차년도별
            </span>
            <span className="kc-blockhead__aside">업종군 기준</span>
          </p>
          <table className="kc-table kc-table--dense" data-widget="table">
            <thead>
              <tr>
                <th>차년도(업종군)</th>
                <th className="n">허가 사업장</th>
                <th className="n is-key">KESI</th>
                <th className="n">비율</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td className="n">{c.denom ? fmt(c.denom) : "-"}</td>
                  <td className="n is-key">{fmt(c.sites)}</td>
                  <td className="n">{pct(c.sites, c.denom)}</td>
                </tr>
              ))}
              <tr className="is-total">
                <td>계</td>
                <td className="n">{totalDenom ? fmt(totalDenom) : "-"}</td>
                <td className="n is-key" data-metric="permit.initial.completed">
                  {fmt(ip.sites)}
                </td>
                <td className="n">{pct(ip.sites, totalDenom)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <Foot
        items={[
          `* 총괄표는 부록 B 의 표시 범위(금액 하한 등)와 ${data.rules.summaryBasis === "all" ? "무관하게 전체 계약을" : "같이 표시한 계약만"} 셉니다(수행 중 포함). 최초허가 = 완료한 사업장 수, 허가 사업장 = 환경부 공개 수치(외부). '-' 미집계 · 0 실적 없음.`,
        ]}
      />
    </Sheet>
  );
}

/** 분야 묶음 — 소계 행을 분야 색 띠로 쓰고(띠 행을 따로 두지 않아 한 쪽에 들어가게) 아래에 기간 행 */
function MatrixRows({ sec, cols }: { sec: CatalogRenderData["matrix"][number]; cols: string[] }) {
  return (
    <>
      {sec.rows.map((r, i) => (
        <tr key={i} className={cx(r.isTotal && "kc-group is-total", r.isTotal && `kc-area-${sec.index}`)}>
          <td className={r.isTotal ? "nw" : undefined}>{r.isTotal ? sec.name : ""}</td>
          <td className="nw">{r.period}</td>
          <td className="n is-key">{fmt(r.total)}</td>
          {cols.map((c) => (
            <td key={c} className="n">
              {fmt(r.byRegion[c] ?? 0)}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── A02 분야별 수행실적 목록 ──
const SUBTYPE_SHORT: Record<string, string> = { 최초허가: "최초", 시범사업: "시범", 변경허가: "변경허가", 변경신고: "변경신고" };

/** 'YYYY.MM. ~ YYYY.MM.' → 'YYYY.MM–YYYY.MM'(디자인 시스템 숫자 표기) */
function periodDash(p: string): string {
  const m = p.match(/(\d{4})\.(\d{2})\.?\s*~\s*(?:(\d{4})\.(\d{2})\.?)?/);
  return m ? `${m[1]}.${m[2]}–${m[3] ? `${m[3]}.${m[4]}` : ""}` : p;
}

function stripPermitTail(title: string): string {
  return title.replace(/\s*준공\s*\([^)]*\)\s*$/, "").replace(/\s*준공\s*$/, "").replace(/\s*수행 중\s*$/, "").trim();
}

function fmtWon(n: number): string {
  if (n >= 100_000_000 && n % 100_000_000 === 0) return `${n / 100_000_000}억 원`;
  if (n >= 10_000 && n % 10_000 === 0) return `${(n / 10_000).toLocaleString("ko-KR")}만 원`;
  return `${n.toLocaleString("ko-KR")}원`;
}

export function rulesSummary(data: CatalogRenderData, category: string): string[] {
  const r = data.rules;
  const min = r.minAmountByCategory[category] ?? 0;
  return [
    min > 0 ? `표시 범위: ${fmtWon(min)} 이하 미표시` : "표시 범위: 이 분야 전부(금액 하한 0원)",
    r.periodMode === "all" ? "기간 전체" : r.periodMode === "from" ? `기간 ${r.fromYear}–` : `최근 ${r.recentYears}년`,
    r.includeOngoing ? "수행 중 포함" : "준공만",
  ];
}

export function ProjectListPage({ ctx, data, area, sec }: { ctx: RenderCtx; data: CatalogRenderData; area: AreaInfo; sec: AppendixSection }) {
  const isPermit = area.index === 1;
  const ncol = isPermit ? 6 : 5;
  const status = (row: AppendixListRow) =>
    row.status === "completed" ? <span className="kc-status kc-status--done">준공</span> : <span className="kc-status kc-status--active">수행 중</span>;
  return (
    <Sheet ctx={ctx} flow area={area.index} anchors={[`a02-${area.index}`]} outline={`부록 B ${area.name}`} style={{ gap: 10 }}>
      <Head ctx={ctx} num="부록 B" name="분야별 수행실적" sub={area.name} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <p className="kc-page-title" data-continued-title="" style={{ fontSize: 20, lineHeight: "28px" }}>
          <AreaTag name={area.name} style={{ fontSize: 20, gap: 10 }} />
        </p>
        <div className="kc-screen-only" style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {rulesSummary(data, area.category).map((t) => (
            <span key={t} className="kc-badge kc-badge--line">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="pk-col" data-widget="table">
        <div data-split="rows">
          <table className="kc-table kc-table--dense">
            <thead>
              {isPermit ? (
                <tr>
                  <th style={{ width: 86 }}>업종</th>
                  <th>사업장 · 용역(대외 표기)</th>
                  <th style={{ width: 44 }}>구분</th>
                  <th style={{ width: 128 }}>허가일 · 결정번호</th>
                  <th style={{ width: 92 }}>수행 기간</th>
                  <th className="c" style={{ width: 46 }}>
                    상태
                  </th>
                </tr>
              ) : (
                <tr>
                  <th>용역(대외 표기)</th>
                  <th style={{ width: 96 }}>업종</th>
                  <th style={{ width: 92 }}>권역</th>
                  <th style={{ width: 92 }}>수행 기간</th>
                  <th className="c" style={{ width: 46 }}>
                    상태
                  </th>
                </tr>
              )}
            </thead>
            <tbody data-split-box="">
              {sec.years.flatMap((y) => {
                if (y.rows.length === 0 && !y.hiddenSummary) return [];
                const rows = [
                  <tr key={`b${y.year}`} className="kc-group" data-band="">
                    <td colSpan={ncol} data-band-label="">
                      {y.year} · {fmt(y.rows.reduce((a, r) => a + r.contractIds.length, 0))}건
                    </td>
                  </tr>,
                  ...y.rows.map((row) => {
                    const extra = data.projectIndex[row.contractIds[0]];
                    const subtype = canonicalServiceSubtype(extra?.subtype?.trim() || null);
                    const title = isPermit && !row.grouped ? stripPermitTail(row.title) : row.title;
                    return isPermit ? (
                      <tr key={row.key}>
                        <td>{row.industry || "-"}</td>
                        <td>
                          {title}
                          {row.detail ? <span className="kc-table__sub">{row.detail}</span> : null}
                        </td>
                        <td>{SUBTYPE_SHORT[subtype] ?? (subtype || "-")}</td>
                        <td className="n">
                          {extra?.permitIssuedAt || row.permitNo ? [extra?.permitIssuedAt?.slice(0, 10), row.permitNo].filter(Boolean).join(" · ") : "-"}
                        </td>
                        <td className="n">{periodDash(row.period) || "-"}</td>
                        <td className="c">{status(row)}</td>
                      </tr>
                    ) : (
                      <tr key={row.key}>
                        <td>
                          {title}
                          {row.detail ? <span className="kc-table__sub">{row.detail}</span> : null}
                        </td>
                        <td>{row.industry || "-"}</td>
                        <td>{row.region}</td>
                        <td className="n">{periodDash(row.period) || "-"}</td>
                        <td className="c">{status(row)}</td>
                      </tr>
                    );
                  }),
                ];
                if (y.hiddenSummary) {
                  rows.push(
                    <tr key={`h${y.year}`} className="kc-table__more">
                      <td colSpan={ncol} className="kc-muted">
                        {y.hiddenSummary}
                      </td>
                    </tr>
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Foot
        items={[
          `* ${asOfNote(data)}. ${rulesSummary(data, area.category).join(" · ")}. 표시 ${fmt(sec.shownContracts)}건${sec.hiddenContracts ? ` · 표시하지 않은 계약 ${fmt(sec.hiddenContracts)}건(총괄표에는 포함)` : ""}. 비공개 고객은 “○○사”로 표기합니다.`,
        ]}
      />
      <Notes items={["* 계약이 등록되면 이 목록에 바로 반영됩니다. 사업장명은 대외 표기 규칙으로 자동 작성하고, 실적 노출 관리에서 고칠 수 있습니다."]} />
    </Sheet>
  );
}
