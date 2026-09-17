import { CdAvatar } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Sizes = () => (
  <div className="cd-card p-4">
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <CdAvatar name="김민준" size="xs" />
      <CdAvatar name="이서연" size="sm" />
      <CdAvatar name="박지훈" size="md" />
      <CdAvatar name="최수아" size="lg" />
    </div>
  </div>
);

export const Names = () => (
  <div className="cd-card p-4">
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <CdAvatar name="정하윤" />
      <CdAvatar name="강도현" />
      <CdAvatar name="Kim Minsu" />
      <CdAvatar name="윤서준" />
      <CdAvatar name="한지민" />
    </div>
  </div>
);
