import { useState } from "react";
import { CdDateInput } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Basic = () => {
  const [start, setStart] = useState("2026-09-14");
  const [end, setEnd] = useState("2026-09-18");
  return (
    <div className="cd-card p-4">
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 480 }}>
        <CdDateInput label="보고 기간 시작" required value={start} onChange={setStart} />
        <CdDateInput label="보고 기간 종료" required value={end} onChange={setEnd} />
      </div>
    </div>
  );
};

export const Invalid = () => {
  const [v, setV] = useState("2026-13-40");
  return (
    <div className="cd-card p-4">
      <div style={{ maxWidth: 240 }}>
        <CdDateInput label="계약일" value={v} onChange={setV} error="올바른 날짜가 아닙니다." />
      </div>
    </div>
  );
};
