"use client";

// 내부 규정 문서 보기 — 일람 화면 우측 표시창과 작성 화면 [미리보기] 탭이 같이 쓴다(2026-09-22).
// 첨부 양식 3번 구성: 규정 제목 → 머리 표(규정번호·제정일 / 주관부서·승인) → 제N장 → 제N조(제목) → 항·호·목 → 부칙.
// 호·목은 기호 수준(1. / 가. / 1) / 가))에 따라 들여쓰기를 한 단계씩 준다.

import type { RuleArticle, RuleBody, RuleTable } from "@/lib/rules/types";
import { formatRegNo } from "@/lib/rules/types";
import { itemHead } from "@/lib/rules/normalize";

export interface InternalRuleHeader {
  title: string;
  regNo: number | null;
  ownerDept: string | null;
  approver: string | null;
  enactedDate: string | null;
  effectiveDate?: string | null;
}

/** 'YYYY-MM-DD' → '2026. 8. 3.' */
function dotDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${y}. ${m}. ${d}.` : iso;
}

function TableView({ table }: { table: RuleTable }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  className="border px-2 py-1 align-top"
                  style={{ borderColor: "var(--cd-border)", background: ri === 0 ? "var(--cd-hover)" : undefined }}
                >
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemLine({ text }: { text: string }) {
  const level = itemHead(text)?.level ?? 1;
  return (
    <div className="text-sm leading-relaxed mt-1" style={{ paddingLeft: 20 + (level - 1) * 18, color: "var(--cd-body)" }}>
      {text}
    </div>
  );
}

export function InternalArticleView({ article, addendum = false }: { article: RuleArticle; addendum?: boolean }) {
  return (
    <div className="mb-5" id={article.key}>
      {article.no > 0 && (
        <div className="text-sm font-bold mb-1.5">
          제{article.no}조{article.title ? `(${article.title})` : ""}
        </div>
      )}
      {article.clauses.map((c, i) => (
        <div key={i} className="mb-1.5">
          {(c.text || c.label) && (
            <div className="text-sm leading-relaxed" style={{ color: "var(--cd-body)", paddingLeft: addendum && !article.no ? 0 : 12 }}>
              {c.label ? `${c.label} ` : ""}
              {c.text}
            </div>
          )}
          {c.items.map((it, j) => (
            <ItemLine key={j} text={it} />
          ))}
        </div>
      ))}
      {article.tables?.map((t, i) => (
        <TableView key={i} table={t} />
      ))}
    </div>
  );
}

export function InternalRuleView({ header, body }: { header: InternalRuleHeader; body: RuleBody }) {
  const hasChapters = body.chapters.some((c) => c.no > 0);
  const labelCell = "border px-3 py-2 text-center text-[13px] font-bold w-[16%] whitespace-nowrap";
  const valueCell = "border px-3 py-2 text-[13px] w-[34%]";
  const cellStyle = { borderColor: "var(--cd-border)" };
  const labelStyle = { ...cellStyle, background: "var(--cd-hover)" };
  return (
    <article className="max-w-[860px] mx-auto">
      <h1 className="text-xl font-extrabold text-center mb-4 break-keep">{header.title || "(제목 없음)"}</h1>
      <table className="w-full border-collapse mb-6">
        <tbody>
          <tr>
            <th className={labelCell} style={labelStyle}>규정번호</th>
            <td className={valueCell} style={cellStyle}>{formatRegNo(header.regNo)}</td>
            <th className={labelCell} style={labelStyle}>제정일</th>
            <td className={valueCell} style={cellStyle}>{dotDate(header.enactedDate) || "-"}</td>
          </tr>
          <tr>
            <th className={labelCell} style={labelStyle}>주관부서</th>
            <td className={valueCell} style={cellStyle}>{header.ownerDept || "-"}</td>
            <th className={labelCell} style={labelStyle}>승인</th>
            <td className={valueCell} style={cellStyle}>{header.approver || "-"}</td>
          </tr>
        </tbody>
      </table>

      {body.chapters.map((ch, ci) => (
        <section key={`ch-${ci}`} id={`chapter-${ch.no}`} className="mb-6">
          {hasChapters && ch.no > 0 && (
            <h2 className="text-base font-extrabold mb-3">
              제 {ch.no} 장&nbsp;&nbsp;{ch.title}
            </h2>
          )}
          {ch.articles.map((a) => (
            <InternalArticleView key={a.key} article={a} />
          ))}
        </section>
      ))}

      {body.addendum.length > 0 && (
        <section id="addendum" className="mb-6">
          <h2 className="text-base font-extrabold mb-3">부&nbsp;&nbsp;칙</h2>
          {body.addendum.map((a) => (
            <InternalArticleView key={a.key} article={a} addendum />
          ))}
        </section>
      )}

      {body.appendices.length > 0 && (
        <section id="appendices">
          {body.appendices.map((ap) => (
            <div key={ap.key} id={ap.key} className="mb-6">
              <div className="text-sm font-bold mb-2">
                {/^별지/.test(ap.title) ? `[${ap.title}]` : `[별표 ${ap.no}] ${ap.title}`}
              </div>
              {ap.paras.map((p, i) => (
                <div key={i} className="text-sm leading-relaxed" style={{ color: "var(--cd-body)" }}>
                  {p}
                </div>
              ))}
              {ap.tables.map((t, i) => (
                <TableView key={i} table={t} />
              ))}
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
