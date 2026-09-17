import { CdInput } from "mcm-cdash";

const col = { display: "grid", gap: 16, maxWidth: 360 };

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Basic = () => (
  <div className="cd-card p-4">
    <div style={col}>
      <CdInput label="사업장명" required placeholder="예: 한빛화학㈜ 울산공장" />
      <CdInput label="담당자 이메일" type="email" defaultValue="kim.mj@hanbitchem.co.kr" hint="계산서 발행 알림을 받을 주소입니다." />
    </div>
  </div>
);

export const States = () => (
  <div className="cd-card p-4">
    <div style={col}>
      <CdInput label="사업자등록번호" defaultValue="123-45-678" error="10자리 숫자를 입력하세요." />
      <CdInput label="계약번호" defaultValue="C-2026-041" disabled />
    </div>
  </div>
);
