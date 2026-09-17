import { useState } from "react";
import { CdTabs } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Underline = () => {
  const [active, setActive] = useState("pending");
  return (
    <div className="cd-card p-4">
      <CdTabs
        variant="underline"
        active={active}
        onChange={setActive}
        items={[
          { key: "pending", label: "결재 대기", count: 3 },
          { key: "progress", label: "진행 중", count: 12 },
          { key: "done", label: "완료" },
          { key: "rejected", label: "반려", count: 1 },
        ]}
      />
    </div>
  );
};

export const Pill = () => {
  const [active, setActive] = useState("month");
  return (
    <div className="cd-card p-4">
      <CdTabs
        variant="pill"
        active={active}
        onChange={setActive}
        items={[
          { key: "week", label: "이번 주" },
          { key: "month", label: "이번 달" },
          { key: "year", label: "올해" },
          { key: "custom", label: "기간 지정", disabled: true },
        ]}
      />
    </div>
  );
};
