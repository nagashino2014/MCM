import { CdSelect } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Basic = () => (
  <div className="cd-card p-4">
    <div style={{ display: "grid", gap: 16, maxWidth: 360 }}>
      <CdSelect label="계약 분류" required defaultValue="permit">
        <option value="permit">통합환경허가</option>
        <option value="survey">사후환경영향조사</option>
        <option value="report">변경신고</option>
      </CdSelect>
      <CdSelect label="결재 상태" defaultValue="" error="결재 상태를 선택하세요.">
        <option value="">선택</option>
        <option value="draft">임시저장</option>
        <option value="pending">결재 중</option>
      </CdSelect>
    </div>
  </div>
);
