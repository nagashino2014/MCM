import { CdCount } from "mcm-cdash";

const item = { display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 };

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Counts = () => (
  <div className="cd-card p-4">
    <div style={{ display: "flex", gap: 20, alignItems: "center" }} className="cd-text">
      <span style={item}>미결재 <CdCount count={3} /></span>
      <span style={item}>안읽은 메일 <CdCount count={128} /></span>
      <span style={item}>반려 <CdCount count={2} tone="error" /></span>
    </div>
  </div>
);
