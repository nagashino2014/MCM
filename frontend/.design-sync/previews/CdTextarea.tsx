import { CdTextarea } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Basic = () => (
  <div className="cd-card p-4">
    <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
      <CdTextarea
        label="추진 내역"
        required
        rows={4}
        defaultValue={"- 배출영향분석 보완자료 제출(9/12)\n- 지자체 협의 결과 회신 대기"}
        hint="회의에서 보고할 항목을 줄 단위로 적습니다."
      />
      <CdTextarea label="반려 사유" rows={3} placeholder="반려 사유를 입력하세요." error="반려 시 사유는 필수입니다." />
    </div>
  </div>
);
