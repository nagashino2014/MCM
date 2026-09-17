import { CdButton } from "mcm-cdash";
import { Download, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

const row = { display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center" };

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Variants = () => (
  <div className="cd-card p-4">
    <div style={row}>
      <CdButton variant="primary" icon={<Plus className="w-4 h-4" />}>새 계약 등록</CdButton>
      <CdButton variant="ghost" icon={<RefreshCw className="w-4 h-4" />}>새로고침</CdButton>
      <CdButton variant="soft" icon={<Download className="w-4 h-4" />}>엑셀 다운로드</CdButton>
      <CdButton variant="danger" icon={<Trash2 className="w-4 h-4" />}>삭제</CdButton>
    </div>
  </div>
);

export const Small = () => (
  <div className="cd-card p-4">
    <div style={row}>
      <CdButton size="sm" variant="primary">결재 상신</CdButton>
      <CdButton size="sm">임시 저장</CdButton>
      <CdButton size="sm" variant="soft">미리보기</CdButton>
    </div>
  </div>
);

export const States = () => (
  <div className="cd-card p-4">
    <div style={row}>
      <CdButton variant="primary" loading>저장 중…</CdButton>
      <CdButton variant="primary" disabled icon={<Save className="w-4 h-4" />}>저장</CdButton>
      <CdButton disabled>취소</CdButton>
    </div>
  </div>
);

export const Block = () => (
  <div className="cd-card p-4" style={{ maxWidth: 360 }}>
    <CdButton variant="primary" block>로그인</CdButton>
  </div>
);
