import { CdSplitPane, CdBadge } from "mcm-cdash";

const list = ["통합환경허가 신청 대행", "사후환경영향조사 1차년도", "대기배출시설 변경신고", "배출영향분석 보완"];

export const ListDetail = () => (
  <div style={{ height: 320 }}>
    <CdSplitPane
      defaultSize={300}
      minSize={220}
      maxSize={420}
      first={
        <div className="cd-card" style={{ height: "100%", padding: 12, gap: 6 }}>
          {list.map((t, i) => (
            <div key={t} className="cd-listitem cd-text" data-active={i === 0} style={{ padding: "8px 10px", borderRadius: 8, fontSize: 13 }}>{t}</div>
          ))}
        </div>
      }
      second={
        <div className="cd-card" style={{ height: "100%", padding: 16, gap: 8 }}>
          <div className="cd-card-title">통합환경허가 신청 대행</div>
          <div style={{ fontSize: 13 }} className="cd-text-muted">한빛화학㈜ 울산공장 · 계약일 2026-03-12</div>
          <div><CdBadge tone="info">진행</CdBadge></div>
        </div>
      }
    />
  </div>
);
