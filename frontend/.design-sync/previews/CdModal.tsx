import { CdModal, CdButton, CdInput, CdTextarea } from "mcm-cdash";

export const Form = () => (
  <CdModal
    open
    onClose={() => {}}
    title="변경계약 등록"
    size="lg"
    footer={
      <>
        <CdButton>취소</CdButton>
        <CdButton variant="primary">저장</CdButton>
      </>
    }
  >
    <div style={{ display: "grid", gap: 16 }}>
      <CdInput label="변경 계약금액(원)" required defaultValue="52,800,000" />
      <CdTextarea label="변경 사유" rows={3} defaultValue="보완 요청에 따른 배출영향분석 범위 확대" />
    </div>
  </CdModal>
);
