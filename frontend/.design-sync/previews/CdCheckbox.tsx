import { CdCheckbox } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Options = () => (
  <div className="cd-card p-4">
    <div style={{ display: "grid", gap: 10 }}>
      <CdCheckbox label="로그인 유지 (30일)" defaultChecked />
      <CdCheckbox label="부가세 포함 금액으로 표시" />
      <CdCheckbox label="완료된 계약 숨기기" disabled />
    </div>
  </div>
);
