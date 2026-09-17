import { CdBadge } from "mcm-cdash";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

const row = { display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center" };

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Tones = () => (
  <div className="cd-card p-4">
    <div style={row}>
      <CdBadge tone="idle">임시저장</CdBadge>
      <CdBadge tone="info">결재 중</CdBadge>
      <CdBadge tone="success">승인</CdBadge>
      <CdBadge tone="warn">보류</CdBadge>
      <CdBadge tone="error">반려</CdBadge>
      <CdBadge tone="secondary">참조</CdBadge>
      <CdBadge tone="outline">통합허가</CdBadge>
    </div>
  </div>
);

export const WithIcon = () => (
  <div className="cd-card p-4">
    <div style={row}>
      <CdBadge tone="success" icon={<CheckCircle2 className="w-3 h-3" />}>발행 완료</CdBadge>
      <CdBadge tone="warn" icon={<Clock className="w-3 h-3" />}>미수금 2개월</CdBadge>
      <CdBadge tone="error" icon={<XCircle className="w-3 h-3" />}>전송 실패</CdBadge>
    </div>
  </div>
);
