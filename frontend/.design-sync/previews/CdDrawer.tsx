import { CdDrawer, CdButton, CdBadge } from "mcm-cdash";

const kv = { display: "grid", gridTemplateColumns: "96px 1fr", gap: "8px 12px", fontSize: 13 };

export const Detail = () => (
  <CdDrawer
    open
    onClose={() => {}}
    title="사업장 정보"
    footer={<CdButton variant="primary">상세 화면 열기</CdButton>}
  >
    <div style={kv}>
      <span className="cd-text-muted">사업장명</span><span className="cd-text">한빛화학㈜ 울산공장</span>
      <span className="cd-text-muted">업종</span><span className="cd-text">기초 유기화학물질 제조업</span>
      <span className="cd-text-muted">허가 상태</span><span><CdBadge tone="info">심사 중</CdBadge></span>
      <span className="cd-text-muted">담당자</span><span className="cd-text">김민준 과장</span>
    </div>
  </CdDrawer>
);
